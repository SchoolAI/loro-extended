/**
 * Propagate document changes to peers
 *
 * This utility contains the shared logic for propagating document changes to peers.
 * It's used by both:
 * - `handle-local-doc-change.ts` - For local changes (user edits)
 * - `handle-doc-imported.ts` - For imported changes (from other peers)
 *
 * ## Decision Tree
 *
 * For each established channel where `canReveal=true`:
 *
 * 1. **If peer has subscribed** (in peer's `subscriptions` set):
 *    - Send `sync-response` with update data directly
 *    - Enables real-time collaboration
 *
 * 2. **If peer awareness is "unknown"**:
 *    - Send `directory-response` as announcement
 *    - Peer can then decide whether to request the document
 *    - Respects peer autonomy (no forced sync)
 *
 * 3. **If peer awareness is "no-doc"**:
 *    - Send nothing (peer explicitly doesn't have/want this doc)
 *
 * @see docs/discovery-and-sync-architecture.md - Pattern 2: Local Document Changes
 */

import type { Logger } from "@logtape/logtape"
import type { VersionVector } from "loro-crdt"
import type { SyncTransmission } from "../../channel.js"
import { type EstablishedChannel, isEstablished } from "../../channel.js"
import type { Rules } from "../../rules.js"
import type { Command, SynchronizerModel } from "../../synchronizer-program.js"
import type { DocId, DocState, PeerID } from "../../types.js"
import {
  setPeerDocumentAwareness,
  shouldSyncWithPeer,
} from "../peer-state-helpers.js"
import { getRuleContext } from "../rule-context.js"

export type PropagationOptions = {
  /** The document ID to propagate */
  docId: DocId
  /** The document state */
  docState: DocState
  /** Our current version (after any import) */
  ourVersion: VersionVector
  /** The synchronizer model */
  model: SynchronizerModel
  /** Rules for canReveal checks */
  rules: Rules
  /** Logger for debugging */
  logger: Logger
  /** Optional: Peer ID to exclude from propagation (e.g., the source of an import) */
  excludePeerId?: PeerID
  /** Log prefix for debugging (e.g., "local-doc-change" or "doc-imported") */
  logPrefix: string
}

/**
 * Propagate document changes to all eligible peers.
 *
 * @returns Array of commands to send to peers
 */
export function propagateToPeers(options: PropagationOptions): Command[] {
  const {
    docId,
    docState,
    ourVersion,
    model,
    rules,
    logger,
    excludePeerId,
    logPrefix,
  } = options

  const commands: Command[] = []

  // Iterate through all established channels to propagate the change
  for (const channel of model.channels.values()) {
    if (!isEstablished(channel)) {
      logger.debug(
        `${logPrefix}: skipping non-established channel {channelId}`,
        {
          channelId: channel.channelId,
        },
      )
      continue
    }

    // Skip excluded peer (e.g., the source of an import)
    if (excludePeerId && channel.peerId === excludePeerId) {
      logger.trace(
        `${logPrefix}: skipping excluded peer {peerId} on channel {channelId}`,
        {
          channelId: channel.channelId,
          peerId: channel.peerId,
        },
      )
      continue
    }

    const peerCommands = propagateToPeer({
      channel,
      docId,
      docState,
      ourVersion,
      model,
      rules,
      logger,
      logPrefix,
    })

    commands.push(...peerCommands)
  }

  return commands
}

type PropagateToSinglePeerOptions = {
  channel: EstablishedChannel
  docId: DocId
  docState: DocState
  ourVersion: VersionVector
  model: SynchronizerModel
  rules: Rules
  logger: Logger
  logPrefix: string
}

/**
 * Propagate document changes to a single peer.
 *
 * @returns Array of commands to send to this peer
 */
function propagateToPeer(options: PropagateToSinglePeerOptions): Command[] {
  const {
    channel,
    docId,
    docState,
    ourVersion,
    model,
    rules,
    logger,
    logPrefix,
  } = options

  const commands: Command[] = []

  const peerState = model.peers.get(channel.peerId)
  const peerAwareness = peerState?.documentAwareness.get(docId)
  const isSubscribed = peerState?.subscriptions.has(docId)

  // Check if we're allowed to reveal this document to this channel
  // This enforces privacy rules (e.g., tenant isolation, repo rules)
  // NOTE: If the peer is already subscribed, they know about the document, so we skip this check
  if (!isSubscribed) {
    const context = getRuleContext({
      channel,
      docState,
      model,
    })

    if (context instanceof Error || !rules.canReveal(context)) {
      logger.debug(`${logPrefix}: skipping channel {channelId} due to rules`, {
        channelId: channel.channelId,
      })
      return commands // Not allowed to reveal to this channel
    }
  }

  logger.debug(`${logPrefix}: checking peer {peerId} on channel {channelId}`, {
    channelId: channel.channelId,
    peerId: channel.peerId,
    isSubscribed,
    awareness: peerAwareness?.awareness,
    hasPeerState: !!peerState,
  })

  // Decision tree based on peer's relationship with this document:

  if (isSubscribed && peerState) {
    // CASE 1: Peer has explicitly requested this document

    // Check if peer needs this update
    // If peer has "no-doc" awareness but is subscribed, they want it but don't have it.
    // We should send a snapshot.
    let shouldSync = false
    if (peerAwareness?.awareness === "no-doc") {
      shouldSync = true
    } else {
      shouldSync = shouldSyncWithPeer(docState, peerAwareness)
    }

    if (shouldSync) {
      // Export update specifically for this peer based on their version
      const theirVersion = peerAwareness?.lastKnownVersion

      // Determine transmission type and export data
      let transmission: SyncTransmission

      if (
        !theirVersion ||
        theirVersion.length() === 0 ||
        peerAwareness?.awareness === "no-doc"
      ) {
        // Peer has no version or explicitly no doc - send snapshot
        const data = docState.doc.export({ mode: "snapshot" })
        transmission = { type: "snapshot", data, version: ourVersion }
      } else {
        // Peer has a version - send update from their version
        const data = docState.doc.export({
          mode: "update",
          from: theirVersion,
        })
        transmission = { type: "update", data, version: ourVersion }
      }

      // Send real-time update directly (enables collaboration)
      logger.debug(
        `${logPrefix}: sending sync-response ({transmissionType}) for {docId} to {channelId}`,
        {
          channelId: channel.channelId,
          docId,
          transmissionType: transmission.type,
          ourVersion: ourVersion.toJSON(),
          theirVersion: theirVersion?.toJSON(),
        },
      )

      commands.push({
        type: "cmd/send-message",
        envelope: {
          toChannelIds: [channel.channelId],
          message: {
            type: "channel/update",
            docId,
            transmission,
          },
        },
      })

      // Update peer's known version after sending
      setPeerDocumentAwareness(peerState, docId, "has-doc", ourVersion)
    } else {
      logger.debug(
        `${logPrefix}: skipping sync-response for {docId} to {channelId} - peer is up-to-date`,
        {
          channelId: channel.channelId,
          docId,
          ourVersion: ourVersion.toJSON(),
          theirVersion: peerAwareness?.lastKnownVersion?.toJSON(),
        },
      )
    }
  } else if (
    !peerAwareness ||
    peerAwareness.awareness === "unknown" ||
    (peerAwareness.awareness === "has-doc" &&
      shouldSyncWithPeer(docState, peerAwareness))
  ) {
    // CASE 2: Peer doesn't know about this document yet OR they have it but are behind
    // Send announcement (peer can then decide whether to request)
    logger.debug(
      `${logPrefix}: sending directory-response announcement for {docId} to {channelId} (reason: {reason})`,
      {
        channelId: channel.channelId,
        docId,
        reason: !peerAwareness ? "no-awareness" : peerAwareness.awareness,
        shouldSync: peerAwareness
          ? shouldSyncWithPeer(docState, peerAwareness)
          : "N/A",
      },
    )

    commands.push({
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [channel.channelId],
        message: {
          type: "channel/directory-response",
          docIds: [docId],
        },
      },
    })
  }
  // CASE 3: peerAwareness === "no-doc"
  // Peer explicitly doesn't have this document - send nothing

  return commands
}
