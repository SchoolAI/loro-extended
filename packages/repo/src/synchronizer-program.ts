import {
  addPeersAwareOfDocuments,
  addPeersWithDocuments,
  createDocumentPeerRegistry,
  type DocumentPeerRegistry,
  getPeersAwareOfDocument,
  getPeersWithDocument,
  removePeerFromAllDocuments,
} from "./document-peer-registry.js"
import type { PeerMetadata } from "./network/network-adapter.js"
import type {
  AddressedNetMsg,
  SyncTransmission,
} from "./network/network-messages.js"
import type { PermissionAdapter } from "./permission-adapter.js"
import type { RequestId } from "./request-tracker.js"
import type { DocumentId, PeerId } from "./types.js"
import { makeMutableUpdate } from "./utils/make-mutable-update.js"

// STATE

/** The pure-functional state of the synchronizer. */
export type Model = {
  /** A map of which documents we have locally. */
  localDocs: Set<DocumentId>

  /** A pair of maps that track what we know about peers & their remote docs. */
  remoteDocs: DocumentPeerRegistry

  /** Documents we are actively trying to fetch and their current status. */
  syncStates: Map<DocumentId, SyncState>

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

export function init(): [Model, Command?] {
  return [
    {
      localDocs: new Set(),
      syncStates: new Map(),
      peers: new Map(),
      remoteDocs: createDocumentPeerRegistry(),
    },
  ]
}

/**
 * Creates a mutative update function that captures permissions in closure.
 * This is used internally by the transformer to provide cleaner update logic.
 */
function createUpdateMutative(permissions: PermissionAdapter) {
  return function updateMutative(
    msg: Message,
    model: Model,
  ): Command | undefined {
    switch (msg.type) {
      case "msg-peer-added": {
        // Read from model BEFORE mutating
        const docIds: PeerId[] = [...model.localDocs].filter(docId =>
          permissions.canList(msg.peerId, docId),
        )

        // Now mutate the model directly
        model.peers.set(msg.peerId, { connected: true })
        addPeersAwareOfDocuments(model.remoteDocs, [msg.peerId], docIds)

        // Return the command
        return {
          type: "cmd-send-message",
          message: {
            type: "directory-response",
            documentIds: docIds,
            targetIds: [msg.peerId],
          },
        }
      }

      case "msg-peer-removed": {
        // Remove the peer from the peers map
        model.peers.delete(msg.peerId)
        // Remove the peer from all document relationships
        removePeerFromAllDocuments(model.remoteDocs, msg.peerId)
        return
      }

      case "msg-document-added": {
        // Read from model BEFORE mutating
        const announceTargetIds = [...model.peers.keys()].filter(peerId =>
          permissions.canList(peerId, msg.documentId),
        )

        // Now mutate the model directly
        model.localDocs.add(msg.documentId)
        addPeersAwareOfDocuments(model.remoteDocs, announceTargetIds, [
          msg.documentId,
        ])

        // Return the command
        return {
          type: "cmd-send-message",
          message: {
            type: "directory-response",
            documentIds: [msg.documentId],
            targetIds: announceTargetIds,
          },
        }
      }

      case "msg-document-removed": {
        // Read from model BEFORE mutating
        const connectedPeers = [...model.peers.keys()]

        // Now mutate the model directly
        model.localDocs.delete(msg.documentId)
        // Remove the document from remoteDocs registry
        removePeerFromAllDocuments(model.remoteDocs, msg.documentId)

        // Return the command
        return {
          type: "cmd-send-message",
          message: {
            type: "delete-response",
            status: "deleted",
            documentId: msg.documentId,
            targetIds: connectedPeers,
          },
        }
      }

      case "msg-received-doc-announced": {
        const { from: fromPeerId, documentIds } = msg
        const commands: Command[] = []
        const newlyDiscoveredDocs: DocumentId[] = []

        for (const documentId of documentIds) {
          const isAlreadyKnown =
            model.localDocs.has(documentId) || model.syncStates.has(documentId)

          // Record that this peer HAS this document
          addPeersWithDocuments(model.remoteDocs, [fromPeerId], [documentId])

          // Also record that this peer KNOWS ABOUT this document
          addPeersAwareOfDocuments(model.remoteDocs, [fromPeerId], [documentId])

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
            model.peers.set(fromPeerId, {})
          }

          // If we are searching for this document, we can now request it
          const syncState = model.syncStates.get(documentId)
          if (syncState?.state === "searching") {
            model.syncStates.set(documentId, {
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

        // Tell the repo about any new documents we discovered
        if (newlyDiscoveredDocs.length > 0) {
          commands.push({
            type: "cmd-notify-docs-available",
            documentIds: newlyDiscoveredDocs,
          })
        }

        return createCommand(commands)
      }

      case "msg-received-doc-request": {
        const { from, documentId } = msg

        // Track that this peer is now aware of this document
        addPeersAwareOfDocuments(model.remoteDocs, [from], [documentId])

        // Always check storage (even if not in localDocs) by delegating to the host
        return {
          type: "cmd-check-storage-and-respond",
          documentId,
          to: from,
        }
      }

      case "msg-received-sync": {
        const { from, documentId, transmission, hopCount } = msg
        const syncState = model.syncStates.get(documentId)

        if (!permissions.canWrite(from, documentId)) {
          return
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
          const awarePeers = getPeersAwareOfDocument(
            model.remoteDocs,
            documentId,
          )
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
          model.syncStates.delete(documentId)
          commands.unshift({ type: "cmd-clear-timeout", documentId })
        }

        return createCommand(commands)
      }

      case "msg-local-change": {
        const { documentId, data } = msg

        // Get peers aware of document from model.remoteDocs
        const awarePeers = getPeersAwareOfDocument(model.remoteDocs, documentId)
        if (awarePeers.length === 0) return

        return {
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
      }

      case "msg-sync-started": {
        const { documentId, requestId, timeout } = msg

        // Get peers who have the document from model.remoteDocs
        const knownPeers = getPeersWithDocument(model.remoteDocs, documentId)

        // If we already have the doc or are already syncing it, do nothing.
        if (
          model.localDocs.has(documentId) ||
          model.syncStates.has(documentId)
        ) {
          // If there's a request, we should probably respond to it successfully
          if (requestId) {
            // This path is not well-defined. What data should we return?
            // For now, we'll assume the caller of `queryNetwork` which calls this
            // will get the document from the handle directly.
          }
          return
        }

        const commands: Command[] = []
        const timeoutDuration = timeout || DEFAULT_SYNC_TIMEOUT

        if (knownPeers.length > 0) {
          // We know who has the doc, request it from one of them.
          const peerId = knownPeers[0]
          model.syncStates.set(documentId, {
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
          model.syncStates.set(documentId, {
            state: "searching",
            userTimeout: timeout,
            requestId,
          })
          commands.push({
            type: "cmd-send-message",
            message: {
              type: "sync-request",
              documentId,
              targetIds: [...model.peers.keys()],
            },
          })
          commands.push({
            type: "cmd-set-timeout",
            documentId,
            duration: timeoutDuration,
          })
        }

        return createCommand(commands)
      }

      case "msg-sync-timeout-fired": {
        const { documentId } = msg
        const syncState = model.syncStates.get(documentId)
        if (!syncState) return

        // If this was a user-specified timeout (from findOrCreate), fail immediately
        // Otherwise, this is a regular sync that can be retried when peers connect
        model.syncStates.delete(documentId)

        return createCommand([
          { type: "cmd-clear-timeout", documentId },
          {
            type: "cmd-sync-failed",
            documentId,
            requestId: syncState.requestId,
          },
        ])
      }
    }
  }
}

/**
 * Creates a standard raj-compatible update function with permissions captured in closure.
 * Uses the transformer to provide immutability while keeping the logic clean.
 */
export function createUpdate(permissions: PermissionAdapter) {
  return makeMutableUpdate(createUpdateMutative(permissions))
}

/**
 * Creates an update function with patch generation for debugging and permissions captured in closure.
 * This is used when debugging capabilities are needed.
 */
export function createUpdateWithPatches(
  permissions: PermissionAdapter,
  onPatch: (patches: import("mutative").Patch[]) => void,
): (msg: Message, model: Model) => [Model, Command?] {
  return makeMutableUpdate(createUpdateMutative(permissions), onPatch)
}
