/**
 * Handle establish-request - Server side of connection handshake
 *
 * This is the first message in the connection protocol. When a peer wants to connect,
 * they send an establish-request with their identity. We respond with our identity
 * to complete the handshake.
 *
 * ## Protocol Flow
 *
 * ```
 * Peer A                    Peer B (us)
 *   |                          |
 *   |-- establish-request ---->|  (this handler)
 *   |                          |  1. Establish channel
 *   |                          |  2. Create/update peer state
 *   |<-- establish-response ---|  3. Send our identity
 *   |                          |
 * ```
 *
 * ## Important Design Decision
 *
 * We **only** send establish-response here, NOT sync-request or directory-request.
 * This keeps the handshake clean and symmetric:
 * - The requester (client) will send directory-request after receiving our response
 * - Both sides then discover and sync documents in parallel
 *
 * This prevents the "dual sync-response" problem where both sides try to sync
 * simultaneously during establishment.
 *
 * @see docs/discovery-and-sync-architecture.md - Pattern 3: Peer Connection Established
 * @see handle-establish-response.ts - Client side of handshake
 */

import type {
  ChannelMsgEstablishRequest,
  ChannelMsgSyncRequest,
  EstablishedChannel,
} from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import { ensurePeerState } from "../peer-state-helpers.js"
import type { ChannelHandlerContext } from "../types.js"
import { batchAsNeeded, filterAllowedDocs, getAllDocsToSync } from "../utils.js"

export function handleEstablishRequest(
  message: ChannelMsgEstablishRequest,
  { channel, model, fromChannelId, permissions }: ChannelHandlerContext,
): Command | undefined {
  const commands: Command[] = []

  // 1. Extract stable peerId from identity and establish the peer connection
  const peerId = message.identity.peerId
  const establishedChannel: EstablishedChannel = {
    ...channel,
    type: "established",
    peerId,
  }
  Object.assign(channel, establishedChannel)

  // 2. Get or create peer state for reconnection optimization
  ensurePeerState(model, message.identity, channel.channelId)

  // 3. Send establish-response back to the requester
  commands.push({
    type: "cmd/send-establishment-message",
    envelope: {
      toChannelIds: [fromChannelId],
      message: {
        type: "channel/establish-response",
        // Copy the identity object here to avoid needing mutative's slower `current()` function
        // (Normally objects can't outlive a mutative change, and current gets around that)
        identity: {
          type: model.identity.type,
          name: model.identity.name,
          peerId: model.identity.peerId,
        },
      },
    },
  })

  // 4. Send sync-request for all allowed documents
  // This ensures the client discovers our documents even without directory-request
  const allowedDocs = filterAllowedDocs(
    model.documents,
    establishedChannel,
    model,
    permissions,
  )
  const docsToSync = getAllDocsToSync(allowedDocs)

  if (docsToSync.length === 1) {
    // Single document - send single sync-request
    commands.push({
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [fromChannelId],
        message: {
          type: "channel/sync-request",
          docId: docsToSync[0].docId,
          requesterDocVersion: docsToSync[0].requesterDocVersion,
          bidirectional: true,
        },
      },
    })
  } else if (docsToSync.length > 1) {
    // Multiple documents - batch sync-requests
    const syncRequests: ChannelMsgSyncRequest[] = docsToSync.map(doc => ({
      type: "channel/sync-request",
      docId: doc.docId,
      requesterDocVersion: doc.requesterDocVersion,
      bidirectional: true,
    }))

    commands.push({
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [fromChannelId],
        message: {
          type: "channel/batch",
          messages: syncRequests,
        },
      },
    })
  }

  return batchAsNeeded(...commands)
}
