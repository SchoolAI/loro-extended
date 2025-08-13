import { create } from "mutative"
import {
  addPeersAwareOfDocuments,
  addPeersWithDocuments,
  createDocumentPeerRegistry,
  getPeersAwareOfDocument,
  getPeersWithDocument,
  removePeerFromAllDocuments,
  type DocumentPeerRegistry,
} from "./document-peer-registry.js"
import type { PeerMetadata } from "./network/network-adapter.js"
import type {
  AddressedNetMsg,
  SyncTransmission,
} from "./network/network-messages.js"
import type { PermissionAdapter } from "./permission-adapter.js"
import type { RequestId } from "./request-tracker.js"
import type { DocumentId, PeerId } from "./types.js"

// STATE

/** The pure-functional state of the synchronizer. */
export type Model = {
  /** A map of which documents we have locally. */
  localDocs: Set<DocumentId>

  /** A pair of maps that track what we know about peers & their remote docs. */
  remoteDocs: DocumentPeerRegistry

  /** Documents we are actively trying to fetch and their current status. */
  syncStates: Map<DocumentId, SyncState>

  /** The permission adapter for the repo. */
  permissions: PermissionAdapter

  /** The current state of peer connectivity, independent of docs. */
  peers: Map<PeerId, PeerMetadata>
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
  | {
      type: "msg-sync-started"
      documentId: DocumentId
      requestId?: RequestId
      timeout?: number
    }
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
      transmission: SyncTransmission
      hopCount: number
    }

  // Internal Events
  | { type: "msg-sync-timeout-fired"; documentId: DocumentId }

// COMMANDS (outputs of the update function)

export type Command =
  // Network
  | { type: "cmd-send-message"; message: AddressedNetMsg }

  // Storage
  | { type: "cmd-load-and-send-sync"; documentId: DocumentId; to: PeerId }
  | {
      type: "cmd-check-storage-and-respond"
      documentId: DocumentId
      to: PeerId
    }

  // Timers
  | { type: "cmd-set-timeout"; documentId: DocumentId; duration: number }
  | { type: "cmd-clear-timeout"; documentId: DocumentId }

  // Repo
  | {
      type: "cmd-sync-succeeded"
      requestId?: RequestId
      documentId: DocumentId
      transmission: SyncTransmission
    }
  | { type: "cmd-sync-failed"; documentId: DocumentId; requestId?: RequestId }
  | { type: "cmd-batch"; commands: Command[] }
  | { type: "cmd-notify-docs-available"; documentIds: DocumentId[] }

// PROGRAM DEFINITION

// CONSTANTS
const DEFAULT_SYNC_TIMEOUT = 5000 // 5 seconds for peer-to-peer sync

// HELPER FUNCTIONS

/**
 * Helper function to create a command or batch command from an array of commands.
 * Returns undefined if no commands, single command if one, or batch if multiple.
 */
function createCommand(commands: Command[]): Command | undefined {
  return commands.length === 0
    ? undefined
    : commands.length === 1
      ? commands[0]
      : { type: "cmd-batch", commands }
}

export type Program = {
  update(message: Message, model: Model): [Model, Command?]
}

export function init(permissions: PermissionAdapter): [Model, Command?] {
  return [
    {
      localDocs: new Set(),
      syncStates: new Map(),
      permissions,
      peers: new Map(),
      remoteDocs: createDocumentPeerRegistry(),
    },
  ]
}

export function update(msg: Message, model: Model): [Model, Command?] {
  switch (msg.type) {
    case "msg-peer-added": {
      const docIds: PeerId[] = [...model.localDocs].filter(docId =>
        model.permissions.canList(msg.peerId, docId),
      )

      // Track that this peer is now aware of our documents
      const newModel = create(model, (draft: Model) => {
        draft.peers.set(msg.peerId, { connected: true })
        draft.remoteDocs = addPeersAwareOfDocuments(
          draft.remoteDocs,
          [msg.peerId],
          docIds,
        )
      })

      // As an optimization, we respond to the new peer with a directory of our existing
      // documents, as permitted by the PermissionAdapter (canList)
      const command: Command = {
        type: "cmd-send-message",
        message: {
          type: "directory-response",
          documentIds: docIds,
          targetIds: [msg.peerId],
        },
      }

      return [newModel, command]
    }

    case "msg-peer-removed": {
      // Remove the peer from all document relationships
      const newModel = create(model, (draft: Model) => {
        draft.remoteDocs = removePeerFromAllDocuments(
          draft.remoteDocs,
          msg.peerId,
        )
      })

      return [newModel]
    }

    case "msg-document-added": {
      const announceTargetIds = [...model.peers.keys()].filter(peerId =>
        model.permissions.canList(peerId, msg.documentId),
      )

      const newModel = create(model, (draft: Model) => {
        draft.localDocs.add(msg.documentId)
        draft.remoteDocs = addPeersAwareOfDocuments(
          draft.remoteDocs,
          announceTargetIds,
          [msg.documentId],
        )
      })

      // Announce the new document to peers that are permitted to know
      const command: Command = {
        type: "cmd-send-message",
        message: {
          type: "directory-response",
          documentIds: [msg.documentId],
          targetIds: announceTargetIds,
        },
      }

      return [newModel, command]
    }

    case "msg-document-removed": {
      // Get all connected peers from model.peers
      const connectedPeers = [...model.peers.keys()]

      const newModel = create(model, (draft: Model) => {
        draft.localDocs.delete(msg.documentId)
        // Remove the document from remoteDocs registry
        draft.remoteDocs = removePeerFromAllDocuments(
          draft.remoteDocs,
          msg.documentId,
        )
      })

      // Inform peers that the document is deleted
      const command: Command = {
        type: "cmd-send-message",
        message: {
          type: "delete-response",
          status: "deleted",
          documentId: msg.documentId,
          targetIds: connectedPeers,
        },
      }

      return [newModel, command]
    }

    case "msg-received-doc-announced": {
      const { from: fromPeerId, documentIds } = msg
      const commands: Command[] = []
      const newlyDiscoveredDocs: DocumentId[] = []

      const newModel = create(model, (draft: Model) => {
        for (const documentId of documentIds) {
          const isAlreadyKnown =
            draft.localDocs.has(documentId) || draft.syncStates.has(documentId)

          // Record that this peer HAS this document
          draft.remoteDocs = addPeersWithDocuments(
            draft.remoteDocs,
            [fromPeerId],
            [documentId],
          )

          // Also record that this peer KNOWS ABOUT this document
          draft.remoteDocs = addPeersAwareOfDocuments(
            draft.remoteDocs,
            [fromPeerId],
            [documentId],
          )

          // If we are not already tracking this document, we need to
          if (!isAlreadyKnown) {
            newlyDiscoveredDocs.push(documentId)
          }

          // Record that we know about the peer that announced the document
          if (!model.peers.has(fromPeerId)) {
            console.warn(
              "we only found out about a peer when it announced a doc",
              fromPeerId,
            )
            draft.peers.set(fromPeerId, {})
          }

          // If we are searching for this document, we can now request it
          const syncState = draft.syncStates.get(documentId)
          if (syncState?.state === "searching") {
            draft.syncStates.set(documentId, {
              state: "syncing",
              peerId: fromPeerId,
              userTimeout: syncState.userTimeout,
              requestId: syncState.requestId,
            })

            commands.push({ type: "cmd-clear-timeout", documentId })
            commands.push({
              type: "cmd-send-message",
              message: {
                type: "sync-request",
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
      })

      // Tell the repo about any new documents we discovered
      if (newlyDiscoveredDocs.length > 0) {
        commands.push({
          type: "cmd-notify-docs-available",
          documentIds: newlyDiscoveredDocs,
        })
      }

      const command = createCommand(commands)

      return [newModel, command]
    }

    case "msg-received-doc-request": {
      const { from, documentId } = msg

      // Track that this peer is now aware of this document
      const newModel = create(model, (draft: Model) => {
        draft.remoteDocs = addPeersAwareOfDocuments(
          draft.remoteDocs,
          [from],
          [documentId],
        )
      })

      // Always check storage (even if not in localDocs) by delegating to the host
      const command: Command = {
        type: "cmd-check-storage-and-respond",
        documentId,
        to: from,
      }
      return [newModel, command]
    }

    case "msg-received-sync": {
      const { from, documentId, transmission, hopCount } = msg
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
        transmission,
        requestId: syncState?.requestId,
      })

      // Forward the sync to other aware peers only if this hasn't been forwarded yet
      // (hopCount = 0 means this is the original message)
      if (hopCount === 0) {
        // Get peers aware of document from model.remoteDocs
        const awarePeers = getPeersAwareOfDocument(model.remoteDocs, documentId)
        if (awarePeers.length > 0) {
          const forwardTargets = awarePeers.filter(
            (peerId: PeerId) => peerId !== from,
          )
          if (forwardTargets.length > 0) {
            commands.push({
              type: "cmd-send-message",
              message: {
                type: "sync-response",
                targetIds: forwardTargets,
                documentId,
                transmission,
                hopCount: 1, // Increment hop count when forwarding
              },
            })
          }
        }
      }
      // If hopCount >= 1, we don't forward to prevent cascades

      // If we were syncing, we can stop now.
      if (syncState) {
        const newModel = create(model, (draft: Model) => {
          draft.syncStates.delete(documentId)
        })
        commands.unshift({ type: "cmd-clear-timeout", documentId })
        const command = createCommand(commands)
        return [newModel, command]
      }

      const command = createCommand(commands)

      return [model, command]
    }

    case "msg-local-change": {
      const { documentId, data } = msg

      // Get peers aware of document from model.remoteDocs
      const awarePeers = getPeersAwareOfDocument(model.remoteDocs, documentId)
      if (awarePeers.length === 0) return [model]

      const command: Command = {
        type: "cmd-send-message",
        message: {
          type: "sync-response",
          targetIds: awarePeers,
          documentId,
          transmission: {
            // Assume peers are up to date at this point, and just forward the local update to them (Loro CRDT is efficient!)
            type: "update",
            data,
          },
          hopCount: 0, // Original message for local changes
        },
      }
      return [model, command]
    }

    case "msg-sync-started": {
      const { documentId, requestId, timeout } = msg

      // Get peers who have the document from model.remoteDocs
      const knownPeers = getPeersWithDocument(model.remoteDocs, documentId)

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

      const commands: Command[] = []
      const timeoutDuration = timeout || DEFAULT_SYNC_TIMEOUT

      const newModel = create(model, (draft: Model) => {
        if (knownPeers.length > 0) {
          // We know who has the doc, request it from one of them.
          const peerId = knownPeers[0]
          draft.syncStates.set(documentId, {
            state: "syncing",
            peerId,
            userTimeout: timeout,
            requestId,
          })
          commands.push({
            type: "cmd-send-message",
            message: {
              type: "sync-request",
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
          draft.syncStates.set(documentId, {
            state: "searching",
            userTimeout: timeout,
            requestId,
          })
          commands.push({
            type: "cmd-send-message",
            message: {
              type: "sync-request",
              documentId,
              targetIds: [...draft.peers.keys()],
            },
          })
          commands.push({
            type: "cmd-set-timeout",
            documentId,
            duration: timeoutDuration,
          })
        }
      })

      const command = createCommand(commands)
      return [newModel, command]
    }

    case "msg-sync-timeout-fired": {
      const { documentId } = msg
      const syncState = model.syncStates.get(documentId)
      if (!syncState) return [model]

      // If this was a user-specified timeout (from findOrCreate), fail immediately
      // Otherwise, this is a regular sync that can be retried when peers connect
      const newModel = create(model, (draft: Model) => {
        draft.syncStates.delete(documentId)
      })

      const command = createCommand([
        { type: "cmd-clear-timeout", documentId },
        {
          type: "cmd-sync-failed",
          documentId,
          requestId: syncState.requestId,
        },
      ])
      return [newModel, command]
    }

    default:
      return [model]
  }
}
