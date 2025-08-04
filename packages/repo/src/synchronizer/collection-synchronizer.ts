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

// Constants for timeouts
const DISCOVERY_TIMEOUT = 5000 // 5 seconds
const SYNC_TIMEOUT = 5000 // 5 seconds

interface CollectionSynchronizerEvents {
  message: RepoMessage
}

export class CollectionSynchronizer extends Emittery<CollectionSynchronizerEvents> {
  #repo: Repo
  #peers = new Set<PeerId>()

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
    // No-op. This method is kept for API compatibility but might be removed later.
    // We no longer need to track requested documents here.
  }

  /**
   * Kicks off the synchronization process for a document handle.
   * This is called by the repo when a handle transitions to the "searching" state.
   */
  beginSync(handle: DocHandle<any>) {
    if (handle.state !== "searching") {
      return
    }

    // Set a timeout to transition to "unavailable" if no peer announces the doc.
    handle._stateTimeoutId = setTimeout(() => {
      handle._setState("unavailable")
    }, DISCOVERY_TIMEOUT)
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

      // If we are searching for this document, we can now request it.
      if (handle.state === "searching") {
        // We found a peer, so clear the discovery timeout.
        if (handle._stateTimeoutId) {
          clearTimeout(handle._stateTimeoutId)
        }

        // Now we're in the "syncing" state, waiting for the actual data.
        handle._setState("syncing")

        // Set a new timeout for the sync process itself.
        handle._stateTimeoutId = setTimeout(() => {
          // If the peer doesn't deliver in time, go back to searching.
          handle._setState("searching")
          this.beginSync(handle) // Restart the discovery process.
        }, SYNC_TIMEOUT)

        // Request the document from the peer that has it.
        this.emit("message", {
          type: "request-sync",
          senderId: this.#repo.peerId,
          targetId: senderId,
          documentId,
        })
      }
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

    // If we were waiting for this sync message, clear the timeout.
    if (handle.state === "syncing") {
      if (handle._stateTimeoutId) {
        clearTimeout(handle._stateTimeoutId)
        handle._stateTimeoutId = undefined
      }
    }

    handle.applySyncMessage(data)
  }
}
