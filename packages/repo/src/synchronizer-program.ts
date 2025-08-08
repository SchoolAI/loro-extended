import type { PermissionAdapter } from "./auth/permission-adapter.js"
import type { UnsentRepoMessage } from "./network/network-messages.js"
import type { DocumentId, PeerId, RequestId } from "./types.js"

// STATE

/** The pure-functional state of the synchronizer. */
export interface Model {
  /** The set of peers we are currently connected to. */
  peers: Set<PeerId>

  /** A map of which documents are available from which peers. */
  docAvailability: Map<DocumentId, Set<PeerId>>

  /** A map of which documents we have locally. */
  localDocs: Set<DocumentId>

  /** Documents we are actively trying to fetch and their current status. */
  syncStates: Map<DocumentId, SyncState>

  /** The permission adapter for the repo. */
  permissions: PermissionAdapter
}

/** The state for a single document sync process. */
export type SyncState =
  /** We've broadcasted a request and are waiting for any peer to announce the doc. */
  | {
      state: "searching"
      /** The number of times we have retried the search. */
      retryCount: number
      requestId?: RequestId
    }
  /** We've identified a peer with the doc and are waiting for them to send it. */
  | {
      state: "syncing"
      peerId: PeerId
      /** The number of times we have retried this specific peer. */
      retryCount: number
      requestId?: RequestId
    }

// MESSAGES (inputs to the update function)

export type Message =
  // Events from the Repo
  | { type: "msg-peer-added"; peerId: PeerId }
  | { type: "msg-peer-removed"; peerId: PeerId }
  | { type: "msg-document-added"; documentId: DocumentId }
  | { type: "msg-document-removed"; documentId: DocumentId }
  | { type: "msg-sync-started"; documentId: DocumentId; requestId?: RequestId }
  | { type: "msg-local-change"; documentId: DocumentId; data: Uint8Array }

  // Events from the Network
  | {
      type: "msg-received-doc-announced"
      from: PeerId
      documentIds: DocumentId[]
    }
  | { type: "msg-received-doc-request"; from: PeerId; documentId: DocumentId }
  | {
      type: "msg-received-sync"
      from: PeerId
      documentId: DocumentId
      data: Uint8Array
    }

  // Internal Events
  | { type: "msg-sync-timeout-fired"; documentId: DocumentId }

// COMMANDS (outputs of the update function)

export type Command =
  // Network
  | { type: "cmd-send-message"; message: UnsentRepoMessage }

  // Storage
  | { type: "cmd-load-and-send-sync"; documentId: DocumentId; to: PeerId }

  // Timers
  | { type: "cmd-set-timeout"; documentId: DocumentId; duration: number }
  | { type: "cmd-clear-timeout"; documentId: DocumentId }

  // Repo
  | {
      type: "cmd-sync-succeeded"
      documentId: DocumentId
      data: Uint8Array
      requestId?: RequestId
    }
  | { type: "cmd-sync-failed"; documentId: DocumentId; requestId?: RequestId }
  | { type: "cmd-batch"; commands: Command[] }
  | { type: "cmd-notify-docs-available"; documentIds: DocumentId[] }

// PROGRAM DEFINITION

// CONSTANTS
const MAX_RETRIES = 3
const BASE_TIMEOUT = 5000 // 5 seconds

export type Program = {
  update(message: Message, model: Model): [Model, Command?]
}

export function init(permissions: PermissionAdapter): [Model, Command?] {
  return [
    {
      peers: new Set(),
      docAvailability: new Map(),
      localDocs: new Set(),
      syncStates: new Map(),
      permissions,
    },
  ]
}

export function update(message: Message, model: Model): [Model, Command?] {
  switch (message.type) {
    case "msg-peer-added": {
      const newModel = { ...model }
      newModel.peers.add(message.peerId)

      const docIds = [...newModel.localDocs].filter(docId => {
        const canList = newModel.permissions.canList
        if (canList && !canList(message.peerId, docId)) {
          return false
        }
        return true
      })
      // Announce our existing documents to the new peer
      const command: Command = {
        type: "cmd-send-message",
        message: {
          type: "announce-document",
          documentIds: docIds,
          targetIds: [message.peerId],
        },
      }

      return [newModel, command]
    }

    case "msg-peer-removed": {
      const newModel = { ...model }
      newModel.peers.delete(message.peerId)

      // Remove the peer from all availability records
      for (const peers of newModel.docAvailability.values()) {
        peers.delete(message.peerId)
      }

      return [newModel]
    }

    case "msg-document-added": {
      const newModel = { ...model }
      newModel.localDocs.add(message.documentId)

      const announceTargetIds = []
      for (const peerId of model.peers) {
        const canList = model.permissions.canList
        if (canList && !canList(peerId, message.documentId)) {
          continue
        }
        announceTargetIds.push(peerId)
      }

      // Announce the new document to peers that are permitted to know
      const command: Command = {
        type: "cmd-send-message",
        message: {
          type: "announce-document",
          documentIds: [message.documentId],
          targetIds: announceTargetIds,
        },
      }

      return [newModel, command]
    }

    case "msg-document-removed": {
      const newModel = { ...model }
      newModel.localDocs.delete(message.documentId)
      newModel.docAvailability.delete(message.documentId)

      // Inform peers that the document is deleted
      const command: Command = {
        type: "cmd-send-message",
        message: {
          type: "delete-document",
          documentId: message.documentId,
          targetIds: [...model.peers],
        },
      }

      return [newModel, command]
    }

    case "msg-received-doc-announced": {
      const { from: fromPeerId, documentIds } = message
      const newModel = { ...model }
      const commands: Command[] = []
      const newlyDiscoveredDocs: DocumentId[] = []

      for (const documentId of documentIds) {
        const isAlreadyKnown =
          newModel.localDocs.has(documentId) ||
          newModel.syncStates.has(documentId)

        // Record that this peer has this document
        if (!newModel.docAvailability.has(documentId)) {
          newModel.docAvailability.set(documentId, new Set())
        }
        const availableDoc = newModel.docAvailability.get(documentId)
        if (!availableDoc) {
          throw new Error("Impossible state: docAvailability not set")
        }
        availableDoc.add(fromPeerId)

        // If we are not already tracking this document, we need to
        if (!isAlreadyKnown) {
          newlyDiscoveredDocs.push(documentId)
        }

        // If we are searching for this document, we can now request it
        const syncState = newModel.syncStates.get(documentId)
        if (syncState?.state === "searching") {
          newModel.syncStates.set(documentId, {
            state: "syncing",
            peerId: fromPeerId,
            retryCount: 0,
            requestId: syncState.requestId,
          })

          commands.push({ type: "cmd-clear-timeout", documentId })
          commands.push({
            type: "cmd-send-message",
            message: {
              type: "request-sync",
              documentId,
              targetIds: [fromPeerId],
            },
          })
          // TODO: Use a real timeout value
          commands.push({
            type: "cmd-set-timeout",
            documentId,
            duration: 25000,
          })
        }
      }

      // Tell the repo about any new documents we discovered
      if (newlyDiscoveredDocs.length > 0) {
        commands.push({
          type: "cmd-notify-docs-available",
          documentIds: newlyDiscoveredDocs,
        })
      }

      const command: Command | undefined =
        commands.length === 0
          ? undefined
          : commands.length === 1
            ? commands[0]
            : { type: "cmd-batch", commands }

      return [newModel, command]
    }

    case "msg-received-doc-request": {
      const { from, documentId } = message
      if (model.localDocs.has(documentId)) {
        const command: Command = {
          type: "cmd-load-and-send-sync",
          documentId,
          to: from,
        }
        return [model, command]
      }
      return [model]
    }

    case "msg-received-sync": {
      const { from, documentId, data } = message
      const syncState = model.syncStates.get(documentId)

      if (!model.permissions.canWrite(from, documentId)) {
        return [model]
      }

      // We received a sync message. If we were waiting for it, this resolves the find() promise.
      // If we weren't, it's just a regular sync message. In either case, we want to apply it.
      const command: Command = {
        type: "cmd-sync-succeeded",
        documentId,
        data,
        requestId: syncState?.requestId,
      }

      // If we were syncing, we can stop now.
      if (syncState) {
        const newModel = { ...model }
        newModel.syncStates.delete(documentId)
        const batchCommand: Command = {
          type: "cmd-batch",
          commands: [{ type: "cmd-clear-timeout", documentId }, command],
        }
        return [newModel, batchCommand]
      }

      return [model, command]
    }

    case "msg-local-change": {
      const { documentId, data } = message
      const peers = model.docAvailability.get(documentId)
      if (!peers) return [model]

      if (peers.size === 0) return [model]

      const command: Command = {
        type: "cmd-send-message",
        message: {
          type: "sync",
          targetIds: [...peers],
          documentId,
          data,
        },
      }
      return [model, command]
    }

    case "msg-sync-started": {
      const { documentId, requestId } = message
      const knownPeers = model.docAvailability.get(documentId)

      // If we already have the doc or are already syncing it, do nothing.
      if (model.localDocs.has(documentId) || model.syncStates.has(documentId)) {
        // If there's a request, we should probably respond to it successfully
        if (requestId) {
          // This path is not well-defined. What data should we return?
          // For now, we'll assume the caller of `queryNetwork` which calls this
          // will get the document from the handle directly.
        }
        return [model]
      }

      const newModel = { ...model }
      const commands: Command[] = []

      if (knownPeers && knownPeers.size > 0) {
        // We know who has the doc, request it from one of them.
        const peerId = knownPeers.values().next().value as PeerId
        newModel.syncStates.set(documentId, {
          state: "syncing",
          peerId,
          retryCount: 0,
          requestId,
        })
        commands.push({
          type: "cmd-send-message",
          message: {
            type: "request-sync",
            documentId,
            targetIds: [peerId],
          },
        })
        commands.push({
          type: "cmd-set-timeout",
          documentId,
          duration: BASE_TIMEOUT,
        })
      } else {
        // We don't know who has the doc, ask everyone.
        newModel.syncStates.set(documentId, {
          state: "searching",
          retryCount: 0,
          requestId,
        })
        commands.push({
          type: "cmd-send-message",
          message: {
            type: "request-sync",
            documentId,
            targetIds: [...model.peers],
          },
        })
        commands.push({
          type: "cmd-set-timeout",
          documentId,
          duration: BASE_TIMEOUT,
        })
      }

      const command: Command = { type: "cmd-batch", commands }
      return [newModel, command]
    }

    case "msg-sync-timeout-fired": {
      const { documentId } = message
      const syncState = model.syncStates.get(documentId)
      if (!syncState) return [model]

      const newSyncStates = new Map(model.syncStates)
      const newRetryCount = syncState.retryCount + 1

      if (newRetryCount > MAX_RETRIES) {
        // We've retried enough, give up.
        newSyncStates.delete(documentId)
        const newModel = { ...model, syncStates: newSyncStates }
        const command: Command = {
          type: "cmd-batch",
          commands: [
            { type: "cmd-clear-timeout", documentId },
            {
              type: "cmd-sync-failed",
              documentId,
              requestId: syncState.requestId,
            },
          ],
        }
        return [newModel, command]
      }

      // We're going to retry, so update the state and set a new timeout.
      const backoff_duration = BASE_TIMEOUT * 2 ** newRetryCount

      // If we were syncing with a specific peer, go back to searching everyone.
      newSyncStates.set(documentId, {
        state: "searching",
        retryCount: newRetryCount,
        requestId: syncState.requestId,
      })
      const newModel = { ...model, syncStates: newSyncStates }

      const command: Command = {
        type: "cmd-batch",
        commands: [
          {
            type: "cmd-send-message",
            message: {
              type: "request-sync",
              documentId,
              targetIds: [...model.peers],
            },
          },
          { type: "cmd-set-timeout", documentId, duration: backoff_duration },
        ],
      }
      return [newModel, command]
    }

    default:
      return [model]
  }
}
