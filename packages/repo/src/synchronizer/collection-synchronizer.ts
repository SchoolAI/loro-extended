import Emittery from "emittery"

import type { DocHandle } from "../doc-handle.js"
import type {
  AnnounceDocumentMessage,
  DeleteDocumentMessage,
  RepoMessage,
  RequestSyncMessage,
  SyncMessage,
} from "../network/network-adapter.js"
import type { Repo } from "../repo.js"
import type { DocumentId, PeerId } from "../types.js"

// Constants for timeouts
const DISCOVERY_TIMEOUT = 5000 // 5 seconds
const SYNC_TIMEOUT = 25000 // 25 seconds

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

  async addPeer(peerId: PeerId) {
    this.#peers.add(peerId)
    const permissions = this.#repo.permissions

    const handles = [
      ...this.#repo.handles.values(),
    ].filter(handle => handle.state === "ready")

    if (handles.length === 0) {
      return
    }

    let documentIds: DocumentId[]
    if (permissions) {
      const results = await Promise.all(
        handles.map(handle =>
          permissions.canRevealDocumentId(this.#repo.peerId, handle.documentId),
        ),
      )
      documentIds = handles
        .filter((_, i) => results[i])
        .map(handle => handle.documentId)
    } else {
      documentIds = handles.map(handle => handle.documentId)
    }

    if (documentIds.length > 0) {
      this.emit("message", {
        type: "announce-document",
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
    const permissions = this.#repo.permissions
    // When the document is ready, announce it to all peers
    handle.whenReady().then(async ({ status }) => {
      if (status === "ready") {
        const canRevealDocumentId = permissions
          ? await permissions.canRevealDocumentId(this.#repo.peerId, handle.documentId)
          : true
        if (canRevealDocumentId) {
          this.#peers.forEach(peerId => {
            this.emit("message", {
              type: "announce-document",
              senderId: this.#repo.peerId,
              targetId: peerId,
              documentIds: [handle.documentId],
            })
          })
        }
      }
    })

    // When the document changes locally, send a sync message to all peers
    handle.on("sync-message", async (data: Uint8Array) => {
      if (!permissions) {
        this.#peers.forEach(peerId =>
          this.#sendSyncMessage(peerId, handle.documentId, data),
        )
        return
      }

      for (const peerId of this.#peers) {
        const canWrite = await permissions.canWrite(peerId, handle.documentId)
        if (canWrite) {
          this.#sendSyncMessage(peerId, handle.documentId, data)
        }
      }
    })
  }

  removeDocument(documentId: DocumentId) {
    this.#peers.forEach(peerId => {
      this.emit("message", {
        type: "delete-document",
        senderId: this.#repo.peerId,
        targetId: peerId,
        documentId,
      })
    })
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
      case "announce-document":
        this.#handleAnnounceDocument(message)
        break
      case "request-sync":
        this.#handleRequestSync(message)
        break
      case "sync":
        this.#handleSync(message)
        break
      case "delete-document":
        this.#handleDeleteDocument(message)
        break
    }
  }

  async #handleAnnounceDocument({
    senderId,
    documentIds,
  }: AnnounceDocumentMessage) {
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
    const { status } = await handle.whenReady()

    if (status === "ready") {
      // Send the full document state to the requesting peer.
      this.emit("message", {
        type: "sync",
        senderId: this.#repo.peerId,
        targetId: senderId,
        documentId,
        data: handle.doc().exportSnapshot(),
      })
    }
    // If the document is not ready, we just don't respond.
    // The requesting peer will time out and re-request if necessary.
  }

  async #handleSync({ senderId, documentId, data }: SyncMessage) {
    if (!data) return

    const handle = this.#repo.find<any>(documentId)
    const permissions = this.#repo.permissions
    if (permissions) {
      const canWrite = await permissions.canWrite(senderId, documentId)
      if (!canWrite) {
        return
      }
    }

    // If we were waiting for this sync message, clear the timeout.
    if (handle.state === "syncing") {
      if (handle._stateTimeoutId) {
        clearTimeout(handle._stateTimeoutId)
        handle._stateTimeoutId = undefined
      }
    }

    handle.applySyncMessage(data)
  }

  async #handleDeleteDocument({
    senderId,
    documentId,
  }: DeleteDocumentMessage) {
    const permissions = this.#repo.permissions
    if (permissions) {
      const canDelete = await permissions.canDelete(senderId, documentId)
      if (!canDelete) {
        return
      }
    }
    this.#repo.delete(documentId)
  }

  #sendSyncMessage(
    targetId: PeerId,
    documentId: DocumentId,
    data: Uint8Array,
  ) {
    this.emit("message", {
      type: "sync",
      senderId: this.#repo.peerId,
      targetId,
      documentId,
      data,
    })
  }
}
