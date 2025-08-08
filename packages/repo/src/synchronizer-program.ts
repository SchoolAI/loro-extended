import type { UnsentRepoMessage } from "./network/network-messages.js"
import type { PermissionAdapter } from "./permission-adapter.js"
import type { DocumentId, PeerId, RequestId } from "./types.js"

// STATE

/** The pure-functional state of the synchronizer. */
export interface Model {
  /** The set of peers we are currently connected to. */
  peers: Set<PeerId>

  /**
   * Peers that HAVE each document (they announced it to us).
   * Used when we need to fetch/sync a document from the network.
   */
  peersWithDoc: Map<DocumentId, Set<PeerId>>

  /**
   * Peers that KNOW ABOUT each document (we announced to them or they requested it).
   * Used when broadcasting local changes to interested peers.
   */
  peersAwareOfDoc: Map<DocumentId, Set<PeerId>>

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
      /** User-specified timeout (if any) - no retries if this is set */
      userTimeout?: number
      requestId?: RequestId
    }
  /** We've identified a peer with the doc and are waiting for them to send it. */
  | {
      state: "syncing"
      peerId: PeerId
      /** User-specified timeout (if any) - no retries if this is set */
      userTimeout?: number
      requestId?: RequestId
    }

// MESSAGES (inputs to the update function)

export type Message =
  // Events from the Repo
  | { type: "msg-peer-added"; peerId: PeerId }
  | { type: "msg-peer-removed"; peerId: PeerId }
  | { type: "msg-document-added"; documentId: DocumentId }
  | { type: "msg-document-removed"; documentId: DocumentId }
  | { type: "msg-sync-started"; documentId: DocumentId; requestId?: RequestId; timeout?: number }
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
      hopCount: number
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
const DEFAULT_SYNC_TIMEOUT = 5000 // 5 seconds for peer-to-peer sync

export type Program = {
  update(message: Message, model: Model): [Model, Command?]
}

export function init(permissions: PermissionAdapter): [Model, Command?] {
  return [
    {
      peers: new Set(),
      peersWithDoc: new Map(),
      peersAwareOfDoc: new Map(),
      localDocs: new Set(),
      syncStates: new Map(),
      permissions,
    },
  ]
}

export function update(msg: Message, model: Model): [Model, Command?] {
  switch (msg.type) {
    case "msg-peer-added": {
      const newModel = {
        ...model,
        peers: new Set([...model.peers, msg.peerId]),
        peersAwareOfDoc: new Map(model.peersAwareOfDoc),
      }

      const docIds = [...newModel.localDocs].filter(docId => {
        const canList = newModel.permissions.canList
        if (canList && !canList(msg.peerId, docId)) {
          return false
        }
        return true
      })

      // Track that this peer is now aware of our documents
      for (const docId of docIds) {
        if (!newModel.peersAwareOfDoc.has(docId)) {
          newModel.peersAwareOfDoc.set(docId, new Set())
        }
        newModel.peersAwareOfDoc.get(docId)!.add(msg.peerId)
      }

      // Announce our existing documents to the new peer
      const command: Command = {
        type: "cmd-send-message",
        message: {
          type: "announce-document",
          documentIds: docIds,
          targetIds: [msg.peerId],
        },
      }

      console.log("msg-peer-added model", newModel)
      return [newModel, command]
    }

    case "msg-peer-removed": {
      const newModel = {
        ...model,
        peersWithDoc: new Map(model.peersWithDoc),
        peersAwareOfDoc: new Map(model.peersAwareOfDoc),
      }
      newModel.peers.delete(msg.peerId)

      // Remove the peer from both tracking maps
      for (const peers of newModel.peersWithDoc.values()) {
        peers.delete(msg.peerId)
      }
      for (const peers of newModel.peersAwareOfDoc.values()) {
        peers.delete(msg.peerId)
      }

      return [newModel]
    }

    case "msg-document-added": {
      const newModel = {
        ...model,
        peersAwareOfDoc: new Map(model.peersAwareOfDoc),
      }
      newModel.localDocs.add(msg.documentId)

      const announceTargetIds = []
      for (const peerId of model.peers) {
        const canList = model.permissions.canList
        if (canList && !canList(peerId, msg.documentId)) {
          continue
        }
        announceTargetIds.push(peerId)
      }

      // Track which peers are now aware of this document
      if (announceTargetIds.length > 0) {
        newModel.peersAwareOfDoc.set(msg.documentId, new Set(announceTargetIds))
      }

      // Announce the new document to peers that are permitted to know
      const command: Command = {
        type: "cmd-send-message",
        message: {
          type: "announce-document",
          documentIds: [msg.documentId],
          targetIds: announceTargetIds,
        },
      }

      return [newModel, command]
    }

    case "msg-document-removed": {
      const newModel = {
        ...model,
        peersWithDoc: new Map(model.peersWithDoc),
        peersAwareOfDoc: new Map(model.peersAwareOfDoc),
      }
      newModel.localDocs.delete(msg.documentId)
      newModel.peersWithDoc.delete(msg.documentId)
      newModel.peersAwareOfDoc.delete(msg.documentId)

      // Inform peers that the document is deleted
      const command: Command = {
        type: "cmd-send-message",
        message: {
          type: "delete-document",
          documentId: msg.documentId,
          targetIds: [...model.peers],
        },
      }

      return [newModel, command]
    }

    case "msg-received-doc-announced": {
      const { from: fromPeerId, documentIds } = msg
      const newModel = {
        ...model,
        peersWithDoc: new Map(model.peersWithDoc),
        peersAwareOfDoc: new Map(model.peersAwareOfDoc),
      }
      const commands: Command[] = []
      const newlyDiscoveredDocs: DocumentId[] = []

      for (const documentId of documentIds) {
        const isAlreadyKnown =
          newModel.localDocs.has(documentId) ||
          newModel.syncStates.has(documentId)

        // Record that this peer HAS this document
        if (!newModel.peersWithDoc.has(documentId)) {
          newModel.peersWithDoc.set(documentId, new Set())
        }
        newModel.peersWithDoc.get(documentId)!.add(fromPeerId)

        // Also record that this peer KNOWS ABOUT this document
        if (!newModel.peersAwareOfDoc.has(documentId)) {
          newModel.peersAwareOfDoc.set(documentId, new Set())
        }
        newModel.peersAwareOfDoc.get(documentId)!.add(fromPeerId)

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
            userTimeout: syncState.userTimeout,
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
          // Use user timeout if specified, otherwise default
          commands.push({
            type: "cmd-set-timeout",
            documentId,
            duration: syncState.userTimeout || DEFAULT_SYNC_TIMEOUT,
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
      const { from, documentId } = msg
      if (model.localDocs.has(documentId)) {
        // Track that this peer is now aware of this document
        const newModel = {
          ...model,
          peersAwareOfDoc: new Map(model.peersAwareOfDoc),
        }
        if (!newModel.peersAwareOfDoc.has(documentId)) {
          newModel.peersAwareOfDoc.set(documentId, new Set())
        }
        newModel.peersAwareOfDoc.get(documentId)!.add(from)

        const command: Command = {
          type: "cmd-load-and-send-sync",
          documentId,
          to: from,
        }
        return [newModel, command]
      }
      return [model]
    }

    case "msg-received-sync": {
      const { from, documentId, data, hopCount } = msg
      const syncState = model.syncStates.get(documentId)

      if (!model.permissions.canWrite(from, documentId)) {
        return [model]
      }

      const commands: Command[] = []

      // We received a sync message. If we were waiting for it, this resolves the find() promise.
      // If we weren't, it's just a regular sync message. In either case, we want to apply it.
      commands.push({
        type: "cmd-sync-succeeded",
        documentId,
        data,
        requestId: syncState?.requestId,
      })

      // Forward the sync to other aware peers only if this hasn't been forwarded yet
      // (hopCount = 0 means this is the original message)
      if (hopCount === 0) {
        const awarePeers = model.peersAwareOfDoc.get(documentId)
        if (awarePeers && awarePeers.size > 0) {
          const forwardTargets = [...awarePeers].filter(peerId => peerId !== from)
          if (forwardTargets.length > 0) {
            commands.push({
              type: "cmd-send-message",
              message: {
                type: "sync",
                targetIds: forwardTargets,
                documentId,
                data,
                hopCount: 1, // Increment hop count when forwarding
              },
            })
          }
        }
      }
      // If hopCount >= 1, we don't forward to prevent cascades

      // If we were syncing, we can stop now.
      if (syncState) {
        const newModel = { ...model }
        newModel.syncStates.delete(documentId)
        commands.unshift({ type: "cmd-clear-timeout", documentId })
        const batchCommand: Command = {
          type: "cmd-batch",
          commands,
        }
        return [newModel, batchCommand]
      }

      const command: Command =
        commands.length === 1
          ? commands[0]
          : { type: "cmd-batch", commands }
      
      return [model, command]
    }

    case "msg-local-change": {
      const { documentId, data } = msg

      // Use peersAwareOfDoc to determine who should receive updates
      const peers = model.peersAwareOfDoc.get(documentId)
      if (!peers || peers.size === 0) return [model]

      const command: Command = {
        type: "cmd-send-message",
        message: {
          type: "sync",
          targetIds: [...peers],
          documentId,
          data,
          hopCount: 0, // Original message for local changes
        },
      }
      return [model, command]
    }

    case "msg-sync-started": {
      const { documentId, requestId, timeout } = msg
      // Use peersWithDoc to find who has the document
      const knownPeers = model.peersWithDoc.get(documentId)

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
      const timeoutDuration = timeout || DEFAULT_SYNC_TIMEOUT

      if (knownPeers && knownPeers.size > 0) {
        // We know who has the doc, request it from one of them.
        const peerId = knownPeers.values().next().value as PeerId
        newModel.syncStates.set(documentId, {
          state: "syncing",
          peerId,
          userTimeout: timeout,
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
          duration: timeoutDuration,
        })
      } else {
        // We don't know who has the doc, ask everyone.
        newModel.syncStates.set(documentId, {
          state: "searching",
          userTimeout: timeout,
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
          duration: timeoutDuration,
        })
      }

      const command: Command = { type: "cmd-batch", commands }
      return [newModel, command]
    }

    case "msg-sync-timeout-fired": {
      const { documentId } = msg
      const syncState = model.syncStates.get(documentId)
      if (!syncState) return [model]

      // If this was a user-specified timeout (from findOrCreate), fail immediately
      // Otherwise, this is a regular sync that can be retried when peers connect
      const newSyncStates = new Map(model.syncStates)
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

    default:
      return [model]
  }
}
