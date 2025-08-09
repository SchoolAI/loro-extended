import { LoroDoc, type OpId, type LoroEventBatch } from "loro-crdt"
import { DocHandle } from "./doc-handle.js"
import { InProcessNetworkAdapter } from "./network/in-process-network-adapter.js"
import type { NetworkAdapter, PeerMetadata } from "./network/network-adapter.js"
import { NetworkSubsystem } from "./network/network-subsystem.js"
import {
  createPermissions,
  type PermissionAdapter,
} from "./permission-adapter.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"
import type { StorageAdapter } from "./storage/storage-adapter.js"
import { Synchronizer, type SynchronizerServices } from "./synchronizer.js"
import type { DocContent, DocumentId, PeerId } from "./types.js"

/**
 * Creates a function that loads a document from storage by reconstructing it
 * from stored snapshots and/or incremental updates.
 *
 * @param storageAdapter The storage adapter to load from
 * @returns A function that loads a document by its ID
 */
function createStorageLoader<T extends DocContent>(
  storageAdapter: StorageAdapter,
): (id: DocumentId) => Promise<LoroDoc<T> | null> {
  return async (id: DocumentId) => {
    // Load all data for this document using loadRange
    const chunks = await storageAdapter.loadRange([id])

    if (chunks.length === 0) return null

    // Get all updates and sort them by version key
    const updateChunks = chunks
      .filter(chunk => chunk.key.length === 3 && chunk.key[1] === "update")
      .sort((a, b) => {
        // Sort by version key (third element)
        const versionA = a.key[2] as string
        const versionB = b.key[2] as string
        return versionA.localeCompare(versionB)
      })

    if (updateChunks.length === 0) return null

    // Create new doc and apply all updates in order
    const doc = new LoroDoc<T>()

    for (const updateChunk of updateChunks) {
      doc.import(updateChunk.data)
    }

    return doc
  }
}

export interface RepoConfig {
  storage?: StorageAdapter
  network?: NetworkAdapter[]
  peerId?: PeerId
  permissions?: Partial<PermissionAdapter>
}

function randomPeerId(): PeerId {
  return `peer-${Math.random().toString(36).slice(2)}`
}

/**
 * The Repo class is the central orchestrator for the Loro state synchronization system.
 * It manages the lifecycle of documents, coordinates subsystems, and provides the main
 * public API for document operations.
 *
 * Unlike DocHandle and Synchronizer which use TEA for complex state management,
 * Repo is a simple orchestrator that wires together the various subsystems.
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

  get network(): NetworkSubsystem {
    return this.networkSubsystem
  }

  constructor({ storage, network, peerId, permissions }: RepoConfig) {
    this.peerId = peerId ?? randomPeerId()
    this.permissionAdapter = createPermissions(permissions)
    this.storageAdapter = storage ?? new InMemoryStorageAdapter()

    // Create services object for the synchronizer
    const services: SynchronizerServices = {
      sendMessage: message => this.networkSubsystem.send(message),
      getDoc: documentId => this.getOrCreateHandle(documentId),
      permissions: this.permissionAdapter,
      onDocAvailable: documentId => {
        if (!this.handleCache.has(documentId)) {
          this.getOrCreateHandle(documentId)
        }
      },
    }

    // Instantiate synchronizer
    this.synchronizer = new Synchronizer(services)

    const peerMetadata: PeerMetadata = {} // In the future, this could contain the storageId
    this.networkSubsystem = new NetworkSubsystem(
      network ?? [new InProcessNetworkAdapter()],
      this.peerId,
      peerMetadata,
    )

    // Wire up subsystems - Network events to Synchronizer
    this.networkSubsystem.on("peer", ({ peerId }) =>
      this.synchronizer.addPeer(peerId),
    )
    this.networkSubsystem.on("peer-disconnected", ({ peerId }) =>
      this.synchronizer.removePeer(peerId),
    )
    this.networkSubsystem.on("message", async message => {
      this.synchronizer.handleRepoMessage(message)
    })
  }

  //
  // PUBLIC API - Now returns Promises
  //

  /**
   * Creates a new document with an optional documentId.
   * @param options Configuration options for document creation
   * @returns A promise that resolves to the DocHandle when the document is ready
   */
  async create<T extends DocContent>(
    options: { documentId?: DocumentId } = {},
  ): Promise<DocHandle<T>> {
    const documentId = options.documentId ?? crypto.randomUUID()

    if (this.handleCache.has(documentId)) {
      throw new Error(`A document with id ${documentId} already exists.`)
    }

    const handle = this.getOrCreateHandle<T>(documentId)
    return await handle.create()
  }

  /**
   * Finds an existing document by its ID.
   * @param documentId The ID of the document to find
   * @returns A promise that resolves to the DocHandle when found, or rejects if unavailable
   */
  async find<T extends DocContent>(
    documentId: DocumentId,
  ): Promise<DocHandle<T>> {
    const handle = this.getOrCreateHandle<T>(documentId)
    return await handle.find()
  }

  /**
   * Finds a document or creates it if not found.
   * @param documentId The ID of the document to find or create
   * @param options Configuration options
   * @returns A promise that resolves to the DocHandle when ready
   */
  async findOrCreate<T extends DocContent>(
    documentId: DocumentId,
    options: {
      timeout?: number
      initialValue?: () => T
    } = {},
  ): Promise<DocHandle<T>> {
    const handle = this.getOrCreateHandle<T>(documentId)
    return await handle.findOrCreate(options)
  }

  /**
   * Deletes a document from the repo.
   * @param documentId The ID of the document to delete
   */
  async delete(documentId: DocumentId): Promise<void> {
    const handle = this.handleCache.get(documentId)

    if (handle) {
      handle.delete()
      this.handleCache.delete(documentId)
      await this.storageAdapter.remove([documentId])
      this.synchronizer.removeDocument(documentId)
    }
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
    return Buffer.from(jsonStr)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "") // Remove padding
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
   * Gets an existing handle or creates a new one for the given document ID.
   * This method ensures proper service injection and event wiring for each handle.
   */
  private getOrCreateHandle<T extends DocContent>(
    documentId: DocumentId,
  ): DocHandle<T> {
    const cached = this.handleCache.get(documentId)
    if (cached) {
      return cached as unknown as DocHandle<T>
    }

    // Create a new handle with injected services including saveToStorage
    const handle = new DocHandle<T>(documentId, {
      loadFromStorage: createStorageLoader<T>(this.storageAdapter),
      saveToStorage: this.createSaveToStorage<T>(documentId),
      queryNetwork: this.synchronizer.queryNetwork.bind(this.synchronizer),
    })

    // Listen for state changes to coordinate with synchronizer
    handle.on("doc-handle-state-transition", ({ oldState, newState }) => {
      if (newState.state === "ready" && oldState.state !== "ready") {
        this.synchronizer.addDocument(documentId)
      }
    })

    // Note: Storage is now handled by the saveToStorage service, not event listeners

    // Listen for local changes to broadcast to peers (network synchronization)
    handle.on("doc-handle-local-change", message => {
      this.synchronizer.onLocalChange(documentId, message)
    })

    this.handleCache.set(documentId, handle as unknown as DocHandle<DocContent>)
    return handle
  }
}
