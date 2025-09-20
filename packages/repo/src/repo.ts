import type { LoroDoc, LoroEventBatch, OpId } from "loro-crdt"
import { DocHandle } from "./doc-handle.js"
import {
  InProcessBridge,
  InProcessNetworkAdapter,
} from "./network/in-process-network-adapter.js"
import type { NetworkAdapter } from "./network/network-adapter.js"
import { NetworkSubsystem } from "./network/network-subsystem.js"
import {
  createPermissions,
  type PermissionAdapter,
} from "./permission-adapter.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"
import type { StorageAdapter } from "./storage/storage-adapter.js"
import { Synchronizer } from "./synchronizer.js"
import type { DocContent, DocumentId, PeerId } from "./types.js"

/**
 * Creates a function that loads a document from storage by reconstructing it
 * from stored snapshots and/or incremental updates.
 *
 * @param storageAdapter The storage adapter to load from
 * @returns A function that loads a document by its ID into an existing doc
 */
function createStorageLoader<T extends DocContent>(
  storageAdapter: StorageAdapter,
): (documentId: DocumentId, doc: LoroDoc<T>) => Promise<void> {
  return async (documentId: DocumentId, doc: LoroDoc<T>) => {
    // Load all data for this document using loadRange
    const chunks = await storageAdapter.loadRange([documentId])

    if (chunks.length === 0) {
      throw new Error(`Document ${documentId} not found in storage`)
    }

    // Get all updates and sort them by version key
    const updateChunks = chunks
      .filter(chunk => chunk.key.length === 3 && chunk.key[1] === "update")
      .sort((a, b) => {
        // Sort by version key (third element)
        const versionA = a.key[2] as string
        const versionB = b.key[2] as string
        return versionA.localeCompare(versionB)
      })

    if (updateChunks.length === 0) {
      throw new Error(`No updates found for document ${documentId}`)
    }

    // Apply all updates in order to the existing doc
    for (const updateChunk of updateChunks) {
      doc.import(updateChunk.data)
    }
  }
}

export interface RepoConfig {
  storage?: StorageAdapter
  network?: NetworkAdapter | NetworkAdapter[]
  peerId?: PeerId
  permissions?: Partial<PermissionAdapter>
}

function randomPeerId(): PeerId {
  return `peer-${Math.random().toString(36).slice(2)}`
}

const defaultBridge = new InProcessBridge()

/**
 * The Repo class is the central orchestrator for the Loro state synchronization system.
 * It manages the lifecycle of documents, coordinates subsystems, and provides the main
 * public API for document operations.
 *
 * With the simplified DocHandle architecture, Repo becomes a simpler orchestrator
 * that wires together the various subsystems without complex state management.
 */
export class Repo {
  readonly peerId: PeerId

  // Subsystems
  private readonly networkSubsystem: NetworkSubsystem
  private readonly synchronizer: Synchronizer

  // Services
  private readonly permissionAdapter: PermissionAdapter
  private readonly storageAdapter: StorageAdapter

  // Handle management
  private readonly handleCache = new Map<DocumentId, DocHandle<DocContent>>()

  get permissions(): PermissionAdapter {
    return this.permissionAdapter
  }

  get handles(): Map<DocumentId, DocHandle<DocContent>> {
    return this.handleCache
  }

  get networks(): NetworkSubsystem {
    return this.networkSubsystem
  }

  constructor({
    peerId = randomPeerId(),
    storage,
    network,
    permissions,
  }: RepoConfig) {
    this.peerId = peerId
    this.storageAdapter = storage ?? new InMemoryStorageAdapter()

    // Create the permissions manager
    this.permissionAdapter = createPermissions(permissions)

    // Instantiate synchronizer
    this.synchronizer = new Synchronizer(
      {
        send: message => this.networkSubsystem.send(message),
        getDoc: documentId => this.getOrCreateDocHandle(documentId),
      },
      { permissions: this.permissionAdapter },
    )

    this.networkSubsystem = this.#initializeNetworkSubsystem(network)
  }

  #initializeNetworkSubsystem(
    network: RepoConfig["network"],
  ): NetworkSubsystem {
    // Instantiate network subsystem
    const adapters: NetworkAdapter[] = []
    if (network && !Array.isArray(network)) {
      adapters.push(network)
    } else if (network && Array.isArray(network)) {
      adapters.push(...network)
    } else {
      adapters.push(new InProcessNetworkAdapter(defaultBridge))
    }

    const networkSubsystem = new NetworkSubsystem({
      peerId: this.peerId,
      adapters,
      services: {
        isPeerConnected: (peerId: PeerId) =>
          this.synchronizer.isPeerConnected(peerId),
      },
    })

    // Wire up subsystems - Network events to Synchronizer
    networkSubsystem.on("peer-available", ({ peerId }) => {
      this.synchronizer.addPeer(peerId)
    })
    networkSubsystem.on("peer-disconnected", ({ peerId }) =>
      this.synchronizer.removePeer(peerId),
    )
    networkSubsystem.on("message-received", async ({ message }) => {
      this.synchronizer.handleRepoMessage(message)
    })

    networkSubsystem.startAdapters()

    return networkSubsystem
  }

  //
  // PUBLIC API - Simplified with always-available documents
  //

  /**
   * Gets or creates a new document with an optional documentId.
   * The document is immediately available for use.
   * @param options Configuration options for document creation
   * @returns The DocHandle with an immediately available document
   */
  get<T extends DocContent>(
    documentId: DocumentId = crypto.randomUUID(),
  ): DocHandle<T> {
    if (this.handleCache.has(documentId)) {
      throw new Error(`A document with id ${documentId} already exists.`)
    }

    const handle = this.getOrCreateDocHandle<T>(documentId)

    // Notify synchronizer that we have this document
    this.synchronizer.addDocument(documentId)

    return handle
  }

  /**
   * Deletes a document from the repo.
   * @param documentId The ID of the document to delete
   */
  async delete(documentId: DocumentId): Promise<void> {
    const handle = this.handleCache.get(documentId)

    if (handle) {
      this.handleCache.delete(documentId)
      await this.storageAdapter.remove([documentId])
      this.synchronizer.removeDocument(documentId)
    }
  }

  /**
   * Disconnects all network adapters and cleans up resources.
   * This should be called when the Repo is no longer needed.
   */
  disconnect(): void {
    // Disconnect all network adapters
    this.networkSubsystem.stopAll()

    // Clear synchronizer model
    this.synchronizer.reset()

    // Clear all document handles
    this.handleCache.clear()
  }

  /**
   * Starts the network subsystem.
   * This should be called when the Repo is ready to participate in the network.
   */
  startNetwork(): void {
    this.networkSubsystem.startAdapters()
  }

  /**
   * Stops the network subsystem.
   * This should be called when the Repo needs to temporarily disconnect from the network.
   */
  stopNetwork(): void {
    this.networkSubsystem.stopAll()
  }

  //
  // PRIVATE METHODS
  //

  /**
   * Converts frontiers to a string key for storage.
   * Frontiers are an array of OpIds, we'll stringify them for a unique key.
   */
  private frontiersToKey(frontiers: OpId[]): string {
    // Convert frontiers to a JSON string then base64 encode for compactness
    const jsonStr = JSON.stringify(frontiers)
    // Use browser-compatible base64 encoding instead of Node.js Buffer
    const base64 = btoa(jsonStr)
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "") // Remove padding
  }

  /**
   * Creates a saveToStorage service function for a specific document.
   * This encapsulates the storage logic that was previously in event listeners.
   */
  private createSaveToStorage<T extends DocContent>(
    documentId: DocumentId,
  ): (
    documentId: DocumentId,
    doc: LoroDoc<T>,
    event: LoroEventBatch,
  ) => Promise<void> {
    return async (_, doc, event) => {
      // Only save actual changes, not checkouts
      if (event.by === "local" || event.by === "import") {
        // Use the 'to' frontiers as the unique key for this update
        const frontiersKey = this.frontiersToKey(event.to)

        // Convert frontiers to version vectors for the export
        // This gives us the incremental update between the two states
        const fromVersion = doc.frontiersToVV(event.from)
        const update = doc.export({
          mode: "update",
          from: fromVersion,
        })

        try {
          // Store with unique key based on frontiers
          await this.storageAdapter.save(
            [documentId, "update", frontiersKey],
            update,
          )
        } catch (error) {
          console.error(
            `[Repo] Failed to save update for document ${documentId}:`,
            error,
          )
          throw error // Re-throw to let DocHandle handle it
        }
      }
    }
  }

  /**
   * Creates a requestFromNetwork service function that adapts the Synchronizer's queryNetwork
   * to the DocHandle's expected interface.
   */
  private createRequestFromNetwork<T extends DocContent>(): (
    documentId: DocumentId,
    doc: LoroDoc<T>,
    timeout: number,
  ) => Promise<void> {
    return async (documentId: DocumentId, doc: LoroDoc<T>, timeout: number) => {
      const result = await this.synchronizer.queryNetwork<T>(
        documentId,
        timeout,
      )
      if (result) {
        // Import the result into the provided doc
        const exported = result.export({ mode: "snapshot" })
        doc.import(exported)
      } else {
        throw new Error(`Failed to load document ${documentId} from network`)
      }
    }
  }

  private getCachedDocHandle(
    documentId: DocumentId,
  ): DocHandle<DocContent> | undefined {
    const cached = this.handleCache.get(documentId)
    if (cached) {
      return cached
    }
  }

  private createDocHandle(documentId: DocumentId): DocHandle<DocContent> {
    const handle = new DocHandle<DocContent>(
      documentId,
      {
        loadFromStorage: createStorageLoader(this.storageAdapter),
        saveToStorage: this.createSaveToStorage(documentId),
        requestFromNetwork: this.createRequestFromNetwork(),
      },
      { autoLoad: true }, // Enable auto-loading by default
    )

    // Listen for local changes to broadcast to peers (network synchronization)
    handle.on("doc-local-change", message => {
      this.synchronizer.onLocalChange(documentId, message)
    })

    return handle
  }

  /**
   * Gets an existing handle or creates a new one for the given document ID.
   * This method ensures proper service injection and event wiring for each handle.
   */
  private getOrCreateDocHandle<T extends DocContent>(
    documentId: DocumentId,
  ): DocHandle<T> {
    let handle = this.getCachedDocHandle(documentId)

    // Create a new handle with injected services
    if (!handle) {
      handle = this.createDocHandle(documentId)
      this.handleCache.set(documentId, handle)
    }

    return handle as unknown as DocHandle<T>
  }
}
