import type { VersionVector } from "loro-crdt"
import type { EstablishedChannel } from "../channel.js"
import type { Permissions } from "../permissions.js"
import type { Command, SynchronizerModel } from "../synchronizer-program.js"
import type { DocId, DocState, PeerState } from "../types.js"

/**
 * Type for docs array used by cmd/send-sync-request
 */
export type SyncRequestDoc = {
  docId: DocId
  requesterDocVersion: VersionVector
}

import { shouldSyncWithPeer } from "./peer-state-helpers.js"
import { getPermissionContext } from "./permission-context.js"

/**
 * Batch multiple commands into a single command if needed
 */
export function batchAsNeeded(
  ...commandSequence: (Command | undefined)[]
): Command | undefined {
  const definedCommands: Command[] = commandSequence.flatMap(c =>
    c ? [c] : [],
  )

  if (definedCommands.length === 0) {
    return
  }

  if (definedCommands.length === 1) {
    return definedCommands[0]
  }

  return { type: "cmd/batch", commands: definedCommands }
}

export function filterAllowedDocs(
  documents: Map<string, DocState>,
  channel: EstablishedChannel,
  model: SynchronizerModel,
  permissions: Permissions,
): Map<string, DocState> {
  const allowedDocs = new Map<string, DocState>()
  const peerState = model.peers.get(channel.peerId)

  for (const [docId, docState] of documents) {
    // Check if peer already has the document
    const peerAwareness = peerState?.documentAwareness.get(docId)
    const peerHasDoc = peerAwareness?.awareness === "has-doc"

    if (peerHasDoc) {
      // Peer already knows about it, so we allow it regardless of visibility
      // (visibility bypass for subscribed peers)
      allowedDocs.set(docId, docState)
      continue
    }

    const context = getPermissionContext({ channel, docState, model })
    if (context instanceof Error) continue
    if (permissions.visibility(context.doc, context.peer)) {
      allowedDocs.set(docId, docState)
    }
  }
  return allowedDocs
}

export function getAllDocsToSync(documents: Map<string, DocState>) {
  return Array.from(documents.values()).map(({ doc, docId }) => {
    const requesterDocVersion = doc.version()
    return { docId, requesterDocVersion }
  })
}

export function getChangedDocsToSync(
  peerState: PeerState,
  documents: Map<string, DocState>,
): SyncRequestDoc[] {
  const docsToSync: SyncRequestDoc[] = []

  for (const [docId, docState] of documents.entries()) {
    const peerAwareness = peerState.documentAwareness.get(docId)

    if (!peerAwareness) {
      // We have a new document created since last connection that
      // peer doesn't know about yet
      docsToSync.push({
        docId,
        requesterDocVersion: docState.doc.version(),
      })
    } else if (peerAwareness.awareness === "has-doc") {
      // Peer had this document - check if our version is ahead
      if (shouldSyncWithPeer(docState, peerAwareness)) {
        docsToSync.push({
          docId,
          requesterDocVersion:
            peerAwareness.lastKnownVersion ?? docState.doc.version(),
        })
      }
    } else {
      // Skip if peerAwareness.awareness === "no-doc" (they don't have it)
    }
  }

  return docsToSync
}
