/**
 * Handle establish-response - Complete connection handshake (client side)
 *
 * This is the response to our establish-request. The peer has accepted our connection
 * and sent us their identity. Now we can start syncing documents.
 *
 * ## Two Connection Paths
 *
 * ### 1. New Peer (First Connection)
 * - No cached peer state exists
 * - Send directory-request to discover their documents
 * - Send sync-request for all our documents
 * - Full discovery process
 *
 * ### 2. Reconnection (Known Peer)
 * - Cached peer state exists with document awareness
 * - Skip directory-request (we know their docs from cache)
 * - Send optimized sync-request only for:
 *   - New documents created since last connection
 *   - Documents that changed since last connection (version comparison)
 * - Much faster reconnection
 *
 * ## Peer Awareness Optimization
 *
 * We cache what each peer knows about our documents:
 * - "unknown" - Never seen this peer before
 * - "has-doc" - Peer had this document (with version)
 * - "no-doc" - Peer explicitly doesn't have this document
 *
 * On reconnection, we use this cache to:
 * - Skip unchanged documents
 * - Only sync new or modified documents
 * - Avoid redundant directory-request
 *
 * ## Protocol Flow (New Peer)
 *
 * ```
 * Us                            Peer
 *   |                           |
 *   |-- establish-request ----->|
 *   |                           |
 *   |<-- establish-response ----|  (this handler)
 *   |   [peer identity]         |  1. Mark channel as established
 *   |                           |  2. Create/update peer state
 *   |                           |  3. Send directory-request
 *   |-- directory-request ----->|  4. Send sync-request (all docs)
 *   |-- sync-request ---------->|
 * ```
 *
 * ## Protocol Flow (Reconnection)
 *
 * ```
 * Us                            Peer
 *   |                           |
 *   |-- establish-request ----->|
 *   |                           |
 *   |<-- establish-response ----|  (this handler)
 *   |   [peer identity]         |  1. Mark channel as established
 *   |                           |  2. Update peer state (lastSeen)
 *   |                           |  3. Check cached awareness
 *   |-- sync-request ---------->|  4. Send optimized sync-request
 *   |   [only new/changed docs] |     (skip directory-request)
 * ```
 *
 * @see docs/discovery-and-sync-architecture.md - Connection Establishment
 * @see handle-establish-request.ts - Server side of handshake
 */

import type {
  ChannelMsgEstablishResponse,
  ChannelMsgSyncRequest,
  EstablishedChannel,
} from "../channel.js"
import type { Command, SynchronizerModel } from "../synchronizer-program.js"
import { getReadyStates } from "./state-helpers.js"
import { ensurePeerState, shouldSyncWithPeer } from "./peer-state-helpers.js"
import type { ChannelHandlerContext } from "./types.js"
import { batchAsNeeded } from "./utils.js"

export function handleEstablishResponse(
  message: ChannelMsgEstablishResponse,
  { channel, model, logger }: ChannelHandlerContext,
): Command | undefined {
  // Step 1: Mark channel as established with peer identity
  const peerId = message.identity.peerId
  Object.assign(channel, {
    ...channel,
    type: "established",
    peerId,
  } satisfies EstablishedChannel)

  // Step 2: Check if this is a reconnection to a known peer
  const existingPeer = model.peers.get(peerId)
  const isReconnection = existingPeer !== undefined

  // Step 3: Get or create peer state
  const peerState = ensurePeerState(model, message.identity, channel.channelId)

  logger.debug(
    isReconnection
      ? "establish-response: reconnecting to known peer"
      : "establish-response: connecting to new peer",
    {
      channelId: channel.channelId,
      peerId,
      documentCount: model.documents.size,
      cachedDocumentAwareness: existingPeer?.documentAwareness.size ?? 0,
    },
  )

  // Note: We don't set canReveal or subscriptions during establishment
  // - canReveal will be checked on-the-fly when needed
  // - Subscriptions will be set when peer sends sync-request

  // Emit ready-state-changed for all documents since we have a new established channel
  const readyStateCommands: Command[] = []
  for (const docId of model.documents.keys()) {
    readyStateCommands.push({
      type: "cmd/emit-ready-state-changed",
      docId,
      readyStates: getReadyStates(model.channels, model.peers, docId),
    })
  }

  if (isReconnection) {
    // ============================================================
    // RECONNECTION PATH - Optimized discovery using cached awareness
    // ============================================================
    logger.debug("establish-response: using optimized sync for reconnection", {
      peerId,
      channelId: channel.channelId,
    })

    // Build optimized sync request based on cached knowledge
    const docsToSync: ChannelMsgSyncRequest["docs"] = []

    for (const [docId, docState] of model.documents.entries()) {
      const peerAwareness = peerState.documentAwareness.get(docId)

      if (!peerAwareness) {
        // New document created since last connection
        // Peer doesn't know about it yet
        logger.debug("establish-response: new doc since last connection", {
          docId,
          peerId,
        })
        docsToSync.push({
          docId,
          requesterDocVersion: docState.doc.version(),
        })
      } else if (peerAwareness.awareness === "has-doc") {
        // Peer had this document - check if our version is ahead
        if (shouldSyncWithPeer(docState, peerAwareness)) {
          logger.debug(
            "establish-response: doc changed since last connection",
            {
              docId,
              peerId,
            },
          )
          docsToSync.push({
            docId,
            requesterDocVersion:
              peerAwareness.lastKnownVersion ?? docState.doc.version(),
          })
        } else {
          logger.debug(
            "establish-response: doc unchanged since last connection",
            {
              docId,
              peerId,
            },
          )
        }
      }
      // Skip if peerAwareness.awareness === "no-doc" (they don't have it)
    }

    // Send optimized sync (may be empty if nothing changed)
    // Note: We skip directory-request since we already know their docs from cache
    if (docsToSync.length > 0) {
      logger.debug("establish-response: sending optimized sync-request", {
        channelId: channel.channelId,
        docCount: docsToSync.length,
      })
      return {
        type: "cmd/send-message",
        envelope: {
          toChannelIds: [channel.channelId],
          message: {
            type: "channel/sync-request",
            docs: docsToSync,
            bidirectional: true,
          },
        },
      }
    } else {
      logger.debug("establish-response: no sync needed for reconnection", {
        channelId: channel.channelId,
      })
      return
    }
  } else {
    // ============================================================
    // NEW PEER PATH - Full discovery
    // ============================================================
    logger.debug("establish-response: using full discovery for new peer", {
      peerId,
      channelId: channel.channelId,
    })

    // Step 1: Request directory from peer to discover their documents
    const sendDirectoryRequestCmd: Command = {
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [channel.channelId],
        message: {
          type: "channel/directory-request",
        },
      },
    }

    // Step 2: Send sync-request for all our documents
    // Peer will respond with data for documents they have
    const docs: ChannelMsgSyncRequest["docs"] = Array.from(
      model.documents.values(),
    ).map(({ doc, docId }) => {
      const requesterDocVersion = doc.version()
      return { docId, requesterDocVersion }
    })

    logger.debug("establish-response: sending full sync-request", {
      channelId: channel.channelId,
      docCount: docs.length,
    })

    const sendSyncRequestCmd: Command = {
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [channel.channelId],
        message: {
          type: "channel/sync-request",
          docs,
          bidirectional: true,
        },
      },
    }

    return batchAsNeeded(
      sendDirectoryRequestCmd,
      sendSyncRequestCmd,
      ...readyStateCommands,
    )
  }
}
