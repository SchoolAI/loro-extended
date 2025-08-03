import Emittery from "emittery"
import { LoroDoc } from "loro-crdt"

import type { PermissionAdapter } from "./auth/PermissionAdapter.js"
import { DocHandle } from "./doc-handle.js"
import { InProcessNetworkAdapter } from "./network/in-process-network-adapter.js"
import type { NetworkAdapter, PeerMetadata } from "./network/network-adapter.js"
import { NetworkSubsystem } from "./network/network-subsystem.js"
import { InMemoryStorageAdapter } from "./storage/in-memory-storage-adapter.js"
import type { StorageAdapter } from "./storage/storage-adapter.js"
import { StorageSubsystem } from "./storage/storage-subsystem.js"
import { CollectionSynchronizer } from "./synchronizer/collection-synchronizer.js"
import type { DocumentId, PeerId } from "./types.js"

export interface RepoConfig {
  storage?: StorageAdapter
  network?: NetworkAdapter[]
  peerId?: PeerId
  permissions?: PermissionAdapter
}

function randomPeerId(): PeerId {
  return `peer-${Math.random().toString(36).slice(2)}`
}

export class Repo extends Emittery {
  peerId: PeerId
  networkSubsystem: NetworkSubsystem
  storageSubsystem: StorageSubsystem
  synchronizer: CollectionSynchronizer
  #permissionAdapter?: PermissionAdapter
  #handleCache = new Map<DocumentId, DocHandle<any>>()

  get handles(): Map<DocumentId, DocHandle<any>> {
    return this.#handleCache
  }

  constructor({ storage, network, peerId, permissions }: RepoConfig = {}) {
    super()
    this.peerId = peerId ?? randomPeerId()
    this.#permissionAdapter = permissions

    // Instantiate subsystems
    this.storageSubsystem = new StorageSubsystem(
      storage ?? new InMemoryStorageAdapter(),
    )
    this.synchronizer = new CollectionSynchronizer(this)

    const peerMetadata: PeerMetadata = {} // In the future, this could contain the storageId
    this.networkSubsystem = new NetworkSubsystem(
      network ?? [new InProcessNetworkAdapter()],
      this.peerId,
      peerMetadata,
    )

    // Wire up subsystems
    this.networkSubsystem.on("peer", ({ peerId }) =>
      this.synchronizer.addPeer(peerId),
    )
    this.networkSubsystem.on("peer-disconnected", ({ peerId }) =>
      this.synchronizer.removePeer(peerId),
    )
    this.networkSubsystem.on("message", message =>
      this.synchronizer.receiveMessage(message),
    )

    this.synchronizer.on("message", message => {
      // Add the senderId before sending the message over the network
      message.senderId = this.peerId
      this.networkSubsystem.send(message)
    })
  }

  //
  // PUBLIC API
  //

  create<T extends Record<string, any>>(): DocHandle<T> {
    const documentId = crypto.randomUUID()
    const handle = this.#getHandle<T>(documentId)
    // A new document is ready immediately with an empty LoroDoc.
    handle.load(() => Promise.resolve(new LoroDoc()))
    this.synchronizer.addDocument(handle)
    return handle
  }

  find<T extends Record<string, any>>(documentId: DocumentId): DocHandle<T> {
    const handle = this.#getHandle<T>(documentId)
    if (handle.state === "idle") {
      // The synchronizer needs to know about the document immediately.
      this.synchronizer.addDocument(handle)
      // loadDoc will either return a LoroDoc or null.
      handle.load(() => this.storageSubsystem.loadDoc(documentId))
    }
    return handle
  }

  delete(documentId: DocumentId) {
    const handle = this.#handleCache.get(documentId)
    if (handle) {
      handle.delete()
      this.#handleCache.delete(documentId)
      this.storageSubsystem.removeDoc(documentId)
      this.synchronizer.removeDocument(documentId)
    }
  }

  //
  // PRIVATE METHODS
  //

  #getHandle<T extends Record<string, any>>(
    documentId: DocumentId,
  ): DocHandle<T> {
    if (this.#handleCache.has(documentId)) {
      return this.#handleCache.get(documentId) as DocHandle<T>
    }
    const handle = new DocHandle<T>(documentId)
    this.#handleCache.set(documentId, handle)
    return handle
  }
}
