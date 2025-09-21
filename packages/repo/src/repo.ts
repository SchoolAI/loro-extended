import type { LoroDoc } from "loro-crdt"
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

  //
  // PRIVATE METHODS
  //

  private getCachedDocHandle(
    documentId: DocumentId,
  ): DocHandle<DocContent> | undefined {
    const cached = this.handleCache.get(documentId)
    if (cached) {
      return cached
    }
  }

  /**
   * Creates a DocHandle, with an optional LoroDoc.
   * This method ensures proper event wiring for each handle.
   */
  private createDocHandle(
    documentId: DocumentId,
    doc?: LoroDoc,
  ): DocHandle<DocContent> {
    const handle = new DocHandle<DocContent>(documentId, doc)

    // Listen for local changes to broadcast to peers (network synchronization)
    handle.doc.subscribeLocalUpdates(message => {
      this.synchronizer.onLocalChange(documentId, message)
    })

    return handle
  }

  /**
   * Gets an existing handle or creates a new one for the given document ID.
   */
  private getOrCreateDocHandle<T extends DocContent>(
    documentId: DocumentId,
    doc?: LoroDoc,
  ): DocHandle<T> {
    let handle = this.getCachedDocHandle(documentId)

    // Create a new doc handle
    if (!handle) {
      handle = this.createDocHandle(documentId, doc)
      this.handleCache.set(documentId, handle)
    }

    return handle as unknown as DocHandle<T>
  }
}
