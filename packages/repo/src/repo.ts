import {
  createPermissions,
  type PermissionAdapter,
} from "./auth/permission-adapter.js"
import { DocHandle } from "./doc-handle.js"
import { InProcessNetworkAdapter } from "./network/in-process-network-adapter.js"
import type { NetworkAdapter, PeerMetadata } from "./network/network-adapter.js"
import { NetworkSubsystem } from "./network/network-subsystem.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"
import type { StorageAdapter } from "./storage/storage-adapter.js"
import { StorageSubsystem } from "./storage/storage-subsystem.js"
import {
  Synchronizer,
  type SynchronizerServices,
} from "./synchronizer.js"
import type { DocumentId, PeerId } from "./types.js"

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
  private readonly storageSubsystem: StorageSubsystem
  private readonly synchronizer: Synchronizer

  // Services
  private readonly permissionAdapter: PermissionAdapter

  // Handle management
  private readonly handleCache = new Map<DocumentId, DocHandle<any>>()

  get permissions(): PermissionAdapter {
    return this.permissionAdapter
  }

  get handles(): Map<DocumentId, DocHandle<any>> {
    return this.handleCache
  }

  constructor({ storage, network, peerId, permissions }: RepoConfig) {
    this.peerId = peerId ?? randomPeerId()
    this.permissionAdapter = createPermissions(permissions)

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

    // Instantiate subsystems
    this.storageSubsystem = new StorageSubsystem(
      storage ?? new InMemoryStorageAdapter(),
    )
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
  async create<T extends Record<string, any> = Record<string, any>>(
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
  async find<T extends Record<string, any> = Record<string, any>>(
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
  async findOrCreate<T extends Record<string, any> = Record<string, any>>(
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
      await this.storageSubsystem.removeDoc(documentId)
      this.synchronizer.removeDocument(documentId)
    }
  }

  //
  // PRIVATE METHODS
  //

  /**
   * Gets an existing handle or creates a new one for the given document ID.
   * This method ensures proper service injection and event wiring for each handle.
   */
  private getOrCreateHandle<T extends Record<string, any>>(
    documentId: DocumentId,
  ): DocHandle<T> {
    if (this.handleCache.has(documentId)) {
      return this.handleCache.get(documentId) as DocHandle<T>
    }

    // Create a new handle with injected services
    const handle = new DocHandle<T>(documentId, {
      loadFromStorage: async (id: DocumentId) => {
        const data = await this.storageSubsystem.loadDoc(id)
        return data || null
      },
      queryNetwork: this.synchronizer.queryNetwork.bind(this.synchronizer),
    })

    // Listen for state changes to coordinate with synchronizer
    handle.on("doc-handle-state-transition", ({ oldState, newState }) => {
      // When a handle finds a document, announce it to peers.
      if (newState.state === "ready" && oldState.state !== "ready") {
        this.synchronizer.addDocument(documentId)
      }
    })

    // Listen for sync messages from the handle to broadcast to peers
    handle.on("doc-handle-local-change", message => {
      this.synchronizer.onLocalChange(documentId, message)
    })

    this.handleCache.set(documentId, handle)
    return handle
  }
}
