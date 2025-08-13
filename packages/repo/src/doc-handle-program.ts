import type { LoroDoc, LoroEventBatch } from "loro-crdt"
import type { Effect as RajEffect } from "raj-ts"
import type { RequestId } from "./request-tracker.js"
import type { DocContent, DocumentId, LoroDocMutator } from "./types.js"

export const FIND_OR_CREATE_DEFAULT_TIMEOUT = 1000

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
//  STATE
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

export type IdleState = {
  state: "idle"
}

export type StorageLoadingState = {
  state: "storage-loading"
  requestId: RequestId
  /** The original operation that triggered this load */
  operation: "find" | "find-in-storage" | "find-or-create"
  /** For find-or-create, the timeout to use for network query */
  timeout?: number
}

export type CreatingState = {
  state: "creating"
  requestId: RequestId
}

export type NetworkLoadingState = {
  state: "network-loading"
  requestId: RequestId
  /** Milliseconds until we give up on the network */
  timeout: number
  /** If true, create the doc if the network times out */
  createOnTimeout: boolean
}

export type ReadyState<T extends DocContent> = {
  state: "ready"
  doc: LoroDoc<T>
}

export type UnavailableState = {
  state: "unavailable"
}

export type DeletedState = {
  state: "deleted"
}

export type HandleState<T extends DocContent> =
  | IdleState
  | StorageLoadingState
  | CreatingState
  | NetworkLoadingState
  | ReadyState<T>
  | UnavailableState
  | DeletedState

// biome-ignore lint/suspicious/noExplicitAny: just need state
export type DocHandleState = HandleState<any>["state"]

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
//  MESSAGE
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=--=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

/** Ask the system to find a document, starting with storage and then the network. */
export type FindMessage = {
  type: "msg-find"
  requestId: RequestId
}

/** Ask the system to find a document in storage only, without checking the network. */
export type FindInStorageMessage = {
  type: "msg-find-in-storage"
  requestId: RequestId
}

/**
 * Ask the system to find a document, but if it cannot be found on the network
 * within a given timeout, create it.
 */
export type FindOrCreateMessage = {
  type: "msg-find-or-create"
  requestId: RequestId
  timeout: number
}

/** Ask the system to create a document immediately. */
export type CreateMessage<T extends DocContent> = {
  type: "msg-create"
  requestId: RequestId
  initialize?: LoroDocMutator<T>
}

/** A message indicating the document was successfully loaded from storage. */
export type StorageLoadSuccessMessage<T extends DocContent> = {
  type: "msg-storage-load-success"
  doc: LoroDoc<T>
}

/** A message indicating the document could not be found in storage. */
export type StorageLoadFailureMessage = {
  type: "msg-storage-load-failure"
}

/** A message indicating the document was successfully loaded from the network. */
export type NetworkLoadSuccessMessage<T extends DocContent> = {
  type: "msg-network-load-success"
  doc: LoroDoc<T>
}

/** A message indicating the network search timed out. */
export type NetworkTimeoutMessage = {
  type: "msg-network-timeout"
}

/** A message to apply a local mutation to the document. */
export type LocalChangeMessage<T extends DocContent> = {
  type: "msg-local-change"
  mutator: LoroDocMutator<T>
}

/** A message to apply a remote sync message to the document. */
export type RemoteChangeMessage<T extends DocContent> = {
  type: "msg-remote-change"
  message: Uint8Array
  // The doc is needed to create a proxy if the handle is currently idle
  doc?: LoroDoc<T>
}

/** A message to mark the document as deleted. */
export type DeleteMessage = {
  type: "msg-delete"
}

export type Message<T extends DocContent> =
  | FindMessage
  | FindInStorageMessage
  | FindOrCreateMessage
  | CreateMessage<T>
  | StorageLoadSuccessMessage<T>
  | StorageLoadFailureMessage
  | NetworkLoadSuccessMessage<T>
  | NetworkTimeoutMessage
  | LocalChangeMessage<T>
  | RemoteChangeMessage<T>
  | DeleteMessage

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
//  COMMANDS (Side Effects)
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

export type LoadFromStorageCommand = {
  type: "cmd-load-from-storage"
  documentId: DocumentId
}

export type QueryNetworkCommand = {
  type: "cmd-query-network"
  documentId: DocumentId
  timeout: number
}

export type CreateDocCommand<T extends DocContent> = {
  type: "cmd-create-doc"
  documentId: DocumentId
  initialize?: LoroDocMutator<T>
}

export type ApplyRemoteChangeCommand<T extends DocContent> = {
  type: "cmd-apply-remote-change"
  doc: LoroDoc<T>
  message: Uint8Array
}

export type SubscribeToDocCommand<T extends DocContent> = {
  type: "cmd-subscribe-to-doc"
  doc: LoroDoc<T>
}

export type SaveToStorageCommand<T extends DocContent> = {
  type: "cmd-save-to-storage"
  documentId: DocumentId
  doc: LoroDoc<T>
  event: LoroEventBatch
}

export type ReportSuccessCommand<T extends DocContent> = {
  type: "cmd-report-success"
  requestId: RequestId
  payload: LoroDoc<T>
}

export type ReportFailureCommand = {
  type: "cmd-report-failure"
  requestId: RequestId
  error: Error
}

export type BatchCommand<T extends DocContent> = {
  type: "cmd-batch"
  commands: Command<T>[]
}

export type Command<T extends DocContent> =
  | LoadFromStorageCommand
  | QueryNetworkCommand
  | CreateDocCommand<T>
  | ApplyRemoteChangeCommand<T>
  | SubscribeToDocCommand<T>
  | SaveToStorageCommand<T>
  | ReportSuccessCommand<T>
  | ReportFailureCommand
  | BatchCommand<T>

/** A raj-ts effect is a function that takes dispatch. Our "commands" are just data.
 *  This `Effect` type wraps our command data in a raj-ts effect. */
export type Effect<T extends DocContent> = RajEffect<Message<T>>
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
//  PROGRAM
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

export const init = <T extends DocContent>(): [HandleState<T>, Command<T>?] => [
  {
    state: "idle",
  },
]

export function update<T extends DocContent>(
  msg: Message<T>,
  state: HandleState<T>,
  documentId: DocumentId,
): [HandleState<T>, Command<T>?] {
  // All states can be deleted
  if (msg.type === "msg-delete") {
    // TODO: Should this report failure on any pending requests?
    return [{ state: "deleted" }]
  }

  switch (state.state) {
    case "idle":
      switch (msg.type) {
        case "msg-find":
          return [
            {
              state: "storage-loading",
              operation: "find",
              requestId: msg.requestId,
            },
            { type: "cmd-load-from-storage", documentId },
          ]
        case "msg-find-in-storage":
          return [
            {
              state: "storage-loading",
              operation: "find-in-storage",
              requestId: msg.requestId,
            },
            { type: "cmd-load-from-storage", documentId },
          ]
        case "msg-find-or-create":
          return [
            {
              state: "storage-loading",
              operation: "find-or-create",
              requestId: msg.requestId,
              timeout: msg.timeout,
            },
            { type: "cmd-load-from-storage", documentId },
          ]
        case "msg-create":
          return [
            { state: "creating", requestId: msg.requestId },
            {
              type: "cmd-create-doc",
              documentId,
              initialize: msg.initialize,
            },
          ]
        case "msg-remote-change":
          // A remote sync message arrived for a document we don't have yet.
          // This implicitly creates it and marks it as ready. This does not
          // correspond to a specific request, so it doesn't need to report success.
          if (!msg.doc) return [state]
          return [
            { state: "ready", doc: msg.doc },
            // We need to subscribe to the newly created doc to generate sync messages
            { type: "cmd-subscribe-to-doc", doc: msg.doc },
          ]
        default:
          return [state]
      }

    case "storage-loading":
      switch (msg.type) {
        case "msg-storage-load-success": {
          const command: Command<T> = {
            type: "cmd-batch",
            commands: [
              { type: "cmd-subscribe-to-doc", doc: msg.doc },
              {
                type: "cmd-report-success",
                requestId: state.requestId,
                payload: msg.doc,
              },
            ],
          }
          return [{ state: "ready", doc: msg.doc }, command]
        }
        case "msg-storage-load-failure":
          // Determine next step based on the original operation
          if (state.operation === "find") {
            // For find: try network, but don't create if not found
            return [
              {
                state: "network-loading",
                requestId: state.requestId,
                timeout: 5000,
                createOnTimeout: false,
              },
              { type: "cmd-query-network", documentId, timeout: 5000 },
            ]
          } else if (state.operation === "find-or-create") {
            // For find-or-create: try network, create if not found
            const timeout = state.timeout || FIND_OR_CREATE_DEFAULT_TIMEOUT
            return [
              {
                state: "network-loading",
                requestId: state.requestId,
                timeout: timeout,
                createOnTimeout: true,
              },
              { type: "cmd-query-network", documentId, timeout: timeout },
            ]
          } else {
            // For find-in-storage: go directly to unavailable (don't try network)
            return [{ state: "unavailable" }]
          }
        default:
          return [state]
      }

    case "creating":
      switch (msg.type) {
        // Successful creation is modeled as a successful storage load
        case "msg-storage-load-success": {
          const command: Command<T> = {
            type: "cmd-batch",
            commands: [
              { type: "cmd-subscribe-to-doc", doc: msg.doc },
              {
                type: "cmd-report-success",
                requestId: state.requestId,
                payload: msg.doc,
              },
            ],
          }
          return [{ state: "ready", doc: msg.doc }, command]
        }
        default:
          return [state]
      }

    case "network-loading":
      switch (msg.type) {
        case "msg-network-load-success": {
          const command: Command<T> = {
            type: "cmd-batch",
            commands: [
              { type: "cmd-subscribe-to-doc", doc: msg.doc },
              {
                type: "cmd-report-success",
                requestId: state.requestId,
                payload: msg.doc,
              },
            ],
          }
          return [{ state: "ready", doc: msg.doc }, command]
        }
        case "msg-network-timeout":
          if (state.createOnTimeout) {
            return [
              { state: "creating", requestId: state.requestId },
              { type: "cmd-create-doc", documentId },
            ]
          } else {
            return [{ state: "unavailable" }]
          }
        case "msg-remote-change": {
          if (!msg.doc) return [state]

          // If we get the document from a peer while we're waiting for the network,
          // we can move to the ready state.
          const command: Command<T> = {
            type: "cmd-batch",
            commands: [
              { type: "cmd-subscribe-to-doc", doc: msg.doc },
              {
                type: "cmd-report-success",
                requestId: state.requestId,
                payload: msg.doc,
              },
            ],
          }
          return [{ state: "ready", doc: msg.doc }, command]
        }
        default:
          return [state]
      }

    case "ready":
      switch (msg.type) {
        // If we get a request for a doc that's already ready, just report success immediately.
        case "msg-find":
        case "msg-find-in-storage":
        case "msg-find-or-create":
        case "msg-create":
          return [
            state,
            {
              type: "cmd-report-success",
              requestId: msg.requestId,
              payload: state.doc,
            },
          ]
        case "msg-local-change":
          // Apply the mutation directly to the document
          msg.mutator(state.doc)
          // Commit the changes to trigger subscriptions
          state.doc.commit()
          // The doc subscriptions set up via cmd-subscribe-to-doc will handle emitting events
          return [state]
        case "msg-remote-change":
          return [
            state,
            {
              type: "cmd-apply-remote-change",
              doc: state.doc,
              message: msg.message,
            },
          ]
        default:
          return [state]
      }

    case "unavailable":
    case "deleted":
      // These are terminal states, no messages should change them, except for 'delete' which is handled at the top.
      return [state]
  }
}
