import Emittery from "emittery"

import type { DocHandle } from "../doc-handle.js"
import type {
  AnnounceMessage,
  RepoMessage,
  RequestSyncMessage,
  SyncMessage,
} from "../network/network-adapter.js"
import type { Repo } from "../repo.js"
import type { DocumentId, PeerId } from "../types.js"

interface CollectionSynchronizerEvents {
  message: RepoMessage
}

export class CollectionSynchronizer extends Emittery<CollectionSynchronizerEvents> {
  #repo: Repo
  #peers = new Set<PeerId>()
  #requestedDocs = new Set<DocumentId>()

  constructor(repo: Repo) {
    super()
    this.#repo = repo
  }

  addPeer(peerId: PeerId) {
    this.#peers.add(peerId)
    const documentIds = [
      ...Array.from(this.#repo.handles.values())
        .filter(handle => handle.state === "ready")
        .map(handle => handle.documentId),
    ]

    if (documentIds.length > 0) {
      this.emit("message", {
        type: "announce",
        senderId: this.#repo.peerId,
        targetId: peerId,
        documentIds,
      })
    }
  }

  removePeer(peerId: PeerId) {
    this.#peers.delete(peerId)
  }

  addDocument(handle: DocHandle<any>) {
    // When the document is ready, announce it to all peers
    handle.whenReady().then(() => {
      this.#peers.forEach(peerId => {
        this.emit("message", {
          type: "announce",
          senderId: this.#repo.peerId,
          targetId: peerId,
          documentIds: [handle.documentId],
        })
      })
    })

    // When the document changes locally, send a sync message to all peers
    handle.on("sync-message", (data: Uint8Array) => {
      this.#peers.forEach(peerId => {
        this.emit("message", {
          type: "sync",
          senderId: this.#repo.peerId,
          targetId: peerId,
          documentId: handle.documentId,
          data,
        })
      })
    })
  }

  removeDocument(documentId: DocumentId) {
    this.#requestedDocs.delete(documentId)
  }

  async receiveMessage(message: RepoMessage) {
    switch (message.type) {
      case "announce":
        this.#handleAnnounce(message)
        break
      case "request-sync":
        this.#handleRequestSync(message)
        break
      case "sync":
        this.#handleSync(message)
        break
    }
  }

  async #handleAnnounce({ senderId, documentIds }: AnnounceMessage) {
    for (const documentId of documentIds) {
      const handle = this.#repo.find<any>(documentId)

      // If we're already tracking this doc, or have requested it, don't do it again.
      if (handle.state !== "idle" || this.#requestedDocs.has(documentId)) {
        continue
      }

      // We've decided we want the doc. Mark it as requested and send the message.
      this.#requestedDocs.add(documentId)
      this.emit("message", {
        type: "request-sync",
        senderId: this.#repo.peerId,
        targetId: senderId,
        documentId,
      })
    }
  }

  async #handleRequestSync({ senderId, documentId }: RequestSyncMessage) {
    const handle = this.#repo.find<any>(documentId)
    try {
      await handle.whenReady()
      // Send the full document state to the requesting peer.
      this.emit("message", {
        type: "sync",
        senderId: this.#repo.peerId,
        targetId: senderId,
        documentId,
        data: handle.doc().exportSnapshot(),
      })
    } catch (e: any) {
      // It's possible we don't have the doc, or it's in a bad state.
      // We should probably let the other peer know.
    }
  }

  async #handleSync({ documentId, data }: SyncMessage) {
    if (!data) return

    const handle = this.#repo.find<any>(documentId)
    handle.applySyncMessage(data)
  }
}
