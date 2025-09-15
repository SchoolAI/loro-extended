import type { LoroDoc } from "loro-crdt"
import { create, type Patch } from "mutative"
import type { DocHandle } from "./doc-handle.js"
import type { AddressedNetMsg, NetMsg } from "./network/network-messages.js"
import {
  createPermissions,
  type PermissionAdapter,
} from "./permission-adapter.js"
import { RequestTracker } from "./request-tracker.js"
import {
  type Command,
  createSynchronizerUpdate,
  init as programInit,
  type SynchronizerMessage,
  type SynchronizerModel,
} from "./synchronizer-program.js"
import type { DocContent, DocumentId, PeerId } from "./types.js"

export type SynchronizerServices = {
  send: (message: AddressedNetMsg) => void
  // biome-ignore lint/suspicious/noExplicitAny: many docs possible
  getDoc: (documentId: DocumentId) => DocHandle<any>
}

export type SynchronizerOptions = {
  permissions?: PermissionAdapter
  onPatch?: (patches: Patch[]) => void
}

export class Synchronizer {
  #services: SynchronizerServices
  #model: SynchronizerModel
  #timeouts = new Map<DocumentId, NodeJS.Timeout>()
  #networkRequestTracker = new RequestTracker<LoroDoc<DocContent> | null>()
  #updateFunction: (
    msg: SynchronizerMessage,
    model: SynchronizerModel,
  ) => [SynchronizerModel, Command?]

  constructor(
    services: SynchronizerServices,
    options: SynchronizerOptions = {},
  ) {
    this.#services = services

    this.#updateFunction = createSynchronizerUpdate(
      createPermissions(options.permissions),
      options.onPatch,
    )

    const [initialModel, initialCommand] = programInit()
    this.#model = initialModel
    if (initialCommand) {
      this.#executeCommand(initialCommand)
    }
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // PUBLIC API
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  public addPeer(peerId: PeerId) {
    this.#dispatch({ type: "msg-peer-added", peerId })
  }

  public removePeer(peerId: PeerId) {
    this.#dispatch({ type: "msg-peer-removed", peerId })
  }

  public addDocument(documentId: DocumentId) {
    this.#dispatch({ type: "msg-document-added", documentId })
  }

  public removeDocument(documentId: DocumentId) {
    this.#dispatch({ type: "msg-document-removed", documentId })
  }

  public onLocalChange(documentId: DocumentId, data: Uint8Array) {
    this.#dispatch({ type: "msg-local-change", documentId, data })
  }

  public isPeerConnected(peerId: PeerId): boolean {
    return this.#model.peers.has(peerId)
  }

  public handleRepoMessage(message: NetMsg) {
    switch (message.type) {
      case "directory-response": {
        this.#dispatch({
          type: "msg-received-doc-announced",
          from: message.senderId,
          documentIds: message.documentIds,
        })
        break
      }
      case "sync-request": {
        this.#dispatch({
          type: "msg-received-doc-request",
          from: message.senderId,
          documentId: message.documentId,
        })
        break
      }
      case "sync-response": {
        if (message.transmission.type === "up-to-date") return
        this.#dispatch({
          type: "msg-received-sync",
          from: message.senderId,
          documentId: message.documentId,
          transmission: message.transmission,
          hopCount: message.hopCount,
        })
        break
      }
    }
  }
  /**
   * Queries the network for a document with the given ID.
   *
   * @typeParam T - The specific document type extending DocContent
   * @param documentId - The ID of the document to find
   * @param timeout - Timeout in milliseconds for the network query
   * @returns A promise that resolves to the document if found, or null if not found
   *
   * @note The type cast here is a limitation of the current architecture. Since the
   * Synchronizer needs to handle documents of any type (T extends DocContent) but
   * can only use a single RequestTracker instance, we need to cast the promise type.
   * This is safe because:
   * 1. The actual LoroDoc object is the same regardless of the generic type parameter
   * 2. The type system only enforces the structure of the document content at compile time
   * 3. At runtime, all documents are handled the same way by the Loro library
   */
  public queryNetwork<T extends DocContent>(
    documentId: DocumentId,
    timeout = 5000,
  ): Promise<LoroDoc<T> | null> {
    const [requestId, promise] = this.#networkRequestTracker.createRequest()
    this.#dispatch({ type: "msg-sync-started", documentId, requestId, timeout })
    return promise as Promise<LoroDoc<T> | null>
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=- =-=-=-=-=-=-=-=
  // INTERNAL RUNTIME
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  #dispatch(message: SynchronizerMessage) {
    const [newModel, command] = this.#updateFunction(message, this.#model)
    this.#model = newModel

    if (command) {
      this.#executeCommand(command)
    }
  }

  #executeCommand(command: Command) {
    switch (command.type) {
      case "cmd-notify-docs-available":
        for (const documentId of command.documentIds) {
          // Get the handle and trigger a find operation if it's not already ready
          const handle = this.#services.getDoc(documentId)

          // If the handle is ready, nothing to do
          if (handle.fullState === "ready") {
            continue
          }

          // For any non-ready handle, try to start a find operation
          // Even if it's unavailable, we should try - the queryNetwork will work
          handle.find().catch(error => {
            console.log(`[Synchronizer] Find failed for ${documentId}:`, error)
          })
        }
        break
      case "cmd-send-message": {
        this.#services.send(command.message)
        break
      }
      case "cmd-load-and-send-sync": {
        const handle = this.#services.getDoc(command.documentId)
        if (handle.fullState === "ready") {
          this.#services.send({
            type: "sync-response",
            targetIds: [command.to],
            documentId: command.documentId,
            transmission: {
              type: "update",
              data: handle.doc().export({ mode: "snapshot" }),
            },
            hopCount: 0, // Original message from this peer
          })
        }
        break
      }
      case "cmd-check-storage-and-respond": {
        // First check if we already have the document in memory
        const handle = this.#services.getDoc(command.documentId)

        if (handle.fullState === "ready") {
          // Document is already loaded in memory, send it directly
          this.#services.send({
            type: "sync-response",
            targetIds: [command.to],
            documentId: command.documentId,
            transmission: {
              type: "update",
              data: handle.doc().export({ mode: "update" }),
            },
            hopCount: 0, // Original message from this peer
          })
        } else {
          // Document is not in memory, try to load it from storage only
          // Use findInStorageOnly which checks storage but doesn't wait for network
          handle
            .findInStorageOnly()
            .then(() => {
              // After findInStorageOnly completes, check if the document is now ready
              if (handle.fullState === "ready") {
                this.#services.send({
                  type: "sync-response",
                  targetIds: [command.to],
                  documentId: command.documentId,
                  transmission: {
                    type: "update",
                    data: handle.doc().export({ mode: "update" }),
                  },
                  hopCount: 0, // Original message from this peer
                })
              }
              // If the document couldn't be loaded from storage, findInStorageOnly will reject
              // and we won't send a response, maintaining the same behavior as before
            })
            .catch(error => {
              console.log("findInStorageOnly failed:", error)
              // If findInStorageOnly() rejects, the document doesn't exist in storage
              // We don't send a response, maintaining the same behavior as before
            })
        }
        break
      }
      case "cmd-set-timeout": {
        this.#clearTimeout(command.documentId)
        const timeoutId = setTimeout(() => {
          this.#dispatch({
            type: "msg-sync-timeout-fired",
            documentId: command.documentId,
          })
        }, command.duration)
        this.#timeouts.set(command.documentId, timeoutId)
        break
      }
      case "cmd-clear-timeout": {
        this.#clearTimeout(command.documentId)
        break
      }
      case "cmd-sync-succeeded": {
        const handle = this.#services.getDoc(command.documentId)

        switch (command.transmission.type) {
          case "snapshot":
          case "update":
          case "update-with-version":
            handle.applySyncMessage(command.transmission.data)
        }

        if (command.requestId !== undefined) {
          this.#networkRequestTracker.resolve(command.requestId, handle.doc())
        }
        break
      }
      case "cmd-sync-failed": {
        if (command.requestId !== undefined) {
          this.#networkRequestTracker.resolve(command.requestId, null) // Resolve with null on failure
        }
        break
      }
      case "cmd-batch": {
        for (const cmd of command.commands) {
          this.#executeCommand(cmd)
        }
        break
      }
    }
  }

  #clearTimeout(documentId: DocumentId) {
    const timeout = this.#timeouts.get(documentId)

    if (!timeout) return

    clearTimeout(timeout)
    this.#timeouts.delete(documentId)
  }

  public clearAllTimeouts() {
    for (const documentId of this.#timeouts.keys()) {
      this.#clearTimeout(documentId)
    }
  }

  public reset() {
    const [initialModel] = programInit()
    this.#model = initialModel
    this.clearAllTimeouts()
  }

  /**
   * Get the current model state (for debugging purposes).
   * Returns a deep copy to prevent accidental mutations.
   */
  public getModelSnapshot(): SynchronizerModel {
    return create(this.#model)[0]
  }
}
