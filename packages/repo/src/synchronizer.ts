import type { LoroDoc } from "loro-crdt"
import type { DocHandle } from "./doc-handle.js"
import type {
  RepoMessage,
  UnsentRepoMessage,
} from "./network/network-messages.js"
import type { PermissionAdapter } from "./permission-adapter.js"
import { RequestTracker } from "./request-tracker.js"
import {
  type Command,
  type Message,
  type Model,
  init as programInit,
  update as programUpdate,
} from "./synchronizer-program.js"
import type { DocContent, DocumentId, PeerId } from "./types.js"

export interface SynchronizerServices {
  sendMessage: (message: UnsentRepoMessage) => void
  // biome-ignore lint/suspicious/noExplicitAny: many docs possible
  getDoc: (documentId: DocumentId) => DocHandle<any>
  permissions: PermissionAdapter
  onDocAvailable: (documentId: DocumentId) => void
}

export class Synchronizer {
  #services: SynchronizerServices
  #model: Model
  #timeouts = new Map<DocumentId, NodeJS.Timeout>()
  #networkRequestTracker = new RequestTracker<LoroDoc<DocContent> | null>()

  constructor(services: SynchronizerServices) {
    this.#services = services

    const [initialModel, initialCommand] = programInit(
      this.#services.permissions,
    )
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

  public handleRepoMessage(message: RepoMessage) {
    switch (message.type) {
      case "announce-document": {
        this.#dispatch({
          type: "msg-received-doc-announced",
          from: message.senderId,
          documentIds: message.documentIds,
        })
        break
      }
      case "request-sync": {
        this.#dispatch({
          type: "msg-received-doc-request",
          from: message.senderId,
          documentId: message.documentId,
        })
        break
      }
      case "sync": {
        if (!message.data) return
        this.#dispatch({
          type: "msg-received-sync",
          from: message.senderId,
          documentId: message.documentId,
          data: message.data,
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

  #dispatch(message: Message) {
    const [newModel, command] = programUpdate(message, this.#model)
    this.#model = newModel

    if (command) {
      this.#executeCommand(command)
    }
  }

  #executeCommand(command: Command) {
    switch (command.type) {
      case "cmd-notify-docs-available":
        for (const documentId of command.documentIds) {
          this.#services.onDocAvailable(documentId)
        }
        break
      case "cmd-send-message": {
        this.#services.sendMessage(command.message)
        break
      }
      case "cmd-load-and-send-sync": {
        const handle = this.#services.getDoc(command.documentId)
        if (handle.state === "ready") {
          this.#services.sendMessage({
            type: "sync",
            targetIds: [command.to],
            documentId: command.documentId,
            data: handle.doc().exportSnapshot(),
            hopCount: 0, // Original message from this peer
          })
        }
        break
      }
      case "cmd-check-storage-and-respond": {
        // First check if we already have the document in memory
        const handle = this.#services.getDoc(command.documentId)

        if (handle.state === "ready") {
          // Document is already loaded in memory, send it directly
          this.#services.sendMessage({
            type: "sync",
            targetIds: [command.to],
            documentId: command.documentId,
            data: handle.doc().exportSnapshot(),
            hopCount: 0, // Original message from this peer
          })
        } else {
          // Document is not in memory, try to load it from storage only
          // Use findInStorageOnly which checks storage but doesn't wait for network
          handle
            .findInStorageOnly()
            .then(() => {
              // After findInStorageOnly completes, check if the document is now ready
              if (handle.state === "ready") {
                this.#services.sendMessage({
                  type: "sync",
                  targetIds: [command.to],
                  documentId: command.documentId,
                  data: handle.doc().exportSnapshot(),
                  hopCount: 0, // Original message from this peer
                })
              }
              // If the document couldn't be loaded from storage, findInStorageOnly will reject
              // and we won't send a response, maintaining the same behavior as before
            })
            .catch(() => {
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
        handle.applySyncMessage(command.data)

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

    if (timeout) {
      clearTimeout(timeout)
      this.#timeouts.delete(documentId)
    }
  }

  public _clearAllTimeouts() {
    for (const timeoutId of this.#timeouts.values()) {
      clearTimeout(timeoutId)
    }
    this.#timeouts.clear()
  }
}
