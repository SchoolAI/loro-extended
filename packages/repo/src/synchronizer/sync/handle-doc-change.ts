/**
 * Handle doc-change - Propagate document changes to peers
 *
 * This is triggered whenever a document is modified (locally or via import from peers).
 * It implements the **pull-based discovery model** where we announce changes but let
 * peers decide whether to request the data.
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
 * ## Protocol Flows
 *
 * ### Flow 1: New Document Created
 * ```
 * User creates doc → doc-change
 *   → Send directory-response (announcement) to all channels
 *   → Storage adapter sends sync-request (eager)
 *   → Network peer may send sync-request (if interested)
 * ```
 *
 * ### Flow 2: Existing Document Modified
 * ```
 * User edits doc → doc-change
 *   → Send sync-response to peers who requested (real-time update)
 *   → Send directory-response to peers who don't know about it
 * ```
 *
 * ## Storage Adapter Behavior
 *
 * Storage adapters typically:
 * - Request all announced documents immediately (eager sync)
 * - Always have subscriptions after first sync
 * - Receive real-time updates for all subsequent changes
 *
 * @see docs/discovery-and-sync-architecture.md - Pattern 2: Local Document Changes
 * @see handle-sync-request.ts - How peers request documents
 */

import type { Logger } from "@logtape/logtape"
import type { SyncTransmission } from "../../channel.js"
import { isEstablished } from "../../channel.js"
import type { Rules } from "../../rules.js"
import type { Command, SynchronizerModel } from "../../synchronizer-program.js"
import type { DocId } from "../../types.js"
import {
  setPeerDocumentAwareness,
  shouldSyncWithPeer,
} from "../peer-state-helpers.js"
import { getRuleContext } from "../rule-context.js"
import { batchAsNeeded } from "../utils.js"

export function handleDocChange(
  msg: {
    type: "synchronizer/doc-change"
    docId: DocId
  },
  model: SynchronizerModel,
  rules: Rules,
  logger: Logger,
): Command | undefined {
  const { docId } = msg

  const docState = model.documents.get(docId)

  if (!docState) {
    logger.warn("local-doc-change: unable to find doc-state {docId}", { docId })
    return
  }

  logger.debug(
    "doc-change processing for {docId} with {channelCount} channels",
    {
      docId,
      channelCount: model.channels.size,
    },
  )

  const commands: Command[] = []

  // Iterate through all established channels to propagate the change
  for (const channel of model.channels.values()) {
    if (!isEstablished(channel)) {
      logger.debug("skipping non-established channel {channelId}", {
        channelId: channel.channelId,
      })
      continue
    }

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
        logger.debug("skipping channel {channelId} due to rules", {
          channelId: channel.channelId,
        })
        continue // Not allowed to reveal to this channel
      }
    }

    logger.debug(
      "checking peer {peerId} on channel {channelId} for doc-change",
      {
        channelId: channel.channelId,
        peerId: channel.peerId,
        isSubscribed,
        awareness: peerAwareness?.awareness,
        hasPeerState: !!peerState,
      },
    )

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
        const ourVersion = docState.doc.version()

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
          "sending sync-response ({transmissionType}) for {docId} to {channelId}",
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
              type: "channel/sync-response",
              docId,
              transmission,
            },
          },
        })

        // Update peer's known version after sending
        setPeerDocumentAwareness(peerState, docId, "has-doc", ourVersion)
      } else {
        logger.debug(
          "skipping sync-response for {docId} to {channelId} - peer is up-to-date",
          {
            channelId: channel.channelId,
            docId,
            ourVersion: docState.doc.version().toJSON(),
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
        "sending directory-response announcement for {docId} to {channelId} (reason: {reason})",
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
  }

  return batchAsNeeded(...commands)
}
