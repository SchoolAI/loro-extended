import type { AsLoro, LoroProxyDoc } from "@loro-extended/change"
import { v4 as uuid } from "uuid"

import type { PermissionAdapter } from "src/auth/permission-adapter.js"
import type { DocHandle } from "./doc-handle.js"
import type {
  RepoMessage,
  UnsentRepoMessage,
} from "./network/network-messages.js"
import type { DocumentId, PeerId, RequestId } from "./types.js"
import {
  type Command,
  type Message,
  type Model,
  init as programInit,
  update as programUpdate,
} from "./synchronizer-program.js"

export interface SynchronizerServices {
  sendMessage: (message: UnsentRepoMessage) => void
  getDoc: (documentId: DocumentId) => DocHandle<any>
  permissions: PermissionAdapter
  onDocAvailable: (documentId: DocumentId) => void
}

export class Synchronizer {
  #services: SynchronizerServices
  #model: Model
  #timeouts = new Map<DocumentId, NodeJS.Timeout>()
  #pendingRequests = new Map<
    RequestId,
    {
      resolve: (value: LoroProxyDoc<any> | null) => void
      reject: (reason?: any) => void
    }
  >()

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

  /**
   * @deprecated This method is intended for internal use by the Repo and
   * may be removed in a future version.
   */
  public beginSync(documentId: DocumentId) {
    this.#dispatch({ type: "msg-sync-started", documentId })
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
        })
        break
      }
    }
  }
  public queryNetwork<T extends Record<string, any>>(
    documentId: DocumentId,
    _timeout = 5000,
  ): Promise<LoroProxyDoc<AsLoro<T>> | null> {
    const requestId = uuid()
    const promise = new Promise<LoroProxyDoc<AsLoro<T>> | null>(
      (resolve, reject) => {
        this.#pendingRequests.set(requestId, {
          resolve: resolve as (value: LoroProxyDoc<any> | null) => void,
          reject,
        })
      },
    )

    this.#dispatch({ type: "msg-sync-started", documentId, requestId })
    return promise
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

        if (command.requestId) {
          const request = this.#pendingRequests.get(command.requestId)
          if (request) {
            request.resolve(handle.doc())
            this.#pendingRequests.delete(command.requestId)
          }
        }
        break
      }
      case "cmd-sync-failed": {
        if (command.requestId) {
          const request = this.#pendingRequests.get(command.requestId)
          if (request) {
            request.resolve(null) // Resolve with null on failure
            this.#pendingRequests.delete(command.requestId)
          }
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
    if (this.#timeouts.has(documentId)) {
      clearTimeout(this.#timeouts.get(documentId)!)
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
