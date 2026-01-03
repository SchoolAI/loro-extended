/**
 * Handle sync-request - Peer explicitly requests document data
 *
 * This is the "pull" in the pull-based sync model. The peer has discovered
 * a document (via directory-response) and now explicitly requests the data.
 *
 * ## Key Behaviors
 *
 * 1. **Send sync-response** with document data (snapshot or update)
 * 2. **Add to peer's subscriptions** - Peer has subscribed to this document
 * 3. **Update peer awareness** - Track that peer has this document
 *
 * ## Storage-First Sync (for network requests)
 *
 * When a network peer requests a document we don't have, we first check with
 * all storage adapters before responding. This prevents the race condition where
 * we respond "unavailable" before storage has loaded the document.
 *
 * Flow for network request when doc doesn't exist:
 * 1. Create doc with pendingStorageChannels set
 * 2. Queue the network request in pendingNetworkRequests
 * 3. Send sync-request to all storage adapters
 * 4. When all storage responds, process queued network requests
 *
 * ## Subscription Model
 *
 * When a peer sends sync-request, they're implicitly subscribing to future updates:
 * - We add the document to the peer's `subscriptions` set
 * - Future local changes will send sync-response directly (real-time updates)
 * - No need for announcements - peer already knows about the document
 *
 * ## Version Vector Semantics
 *
 * The `requesterDocVersion` tells us what the peer has:
 * - **Empty version**: Peer has nothing → send snapshot (full document)
 * - **Non-empty version**: Peer has this version → send update (delta)
 * - **Up-to-date**: Peer has latest → send "up-to-date" response
 *
 * ## Protocol Flow
 *
 * ```
 * Peer                          Us
 *   |                           |
 *   |-- sync-request ---------->|  (this handler)
 *   |   [docId, version]        |  1. Check if we have doc
 *   |                           |  2. Add to peer's subscriptions
 *   |                           |  3. Update peer awareness
 *   |<-- sync-response ---------|  4. Send document data
 *   |   [data or up-to-date]    |
 *   |                           |
 *   |<-- sync-response ---------|
 *   |   [data or up-to-date]    |
 *   |                           |
 *   |<-- sync-response ---------|
 *   |   [data or up-to-date]    |
 * ```
 *
 * ## Storage Adapter Behavior
 *
 * Storage adapters:
 * - Send sync-request for all announced documents (eager)
 * - Always have subscriptions after first request
 * - Receive all future updates automatically
 *
 * @see docs/discovery-and-sync-architecture.md - Sync Data Transfer
 * @see handle-sync-response.ts - How we handle responses from peers
 * @see handle-local-doc-change.ts - How we send updates to subscribed peers
 */

import { VersionVector } from "loro-crdt"
import type { ChannelMsgSyncRequest } from "../../channel.js"
import type { Command } from "../../synchronizer-program.js"
import { createDocState } from "../../types.js"
import { getEstablishedChannelsForDoc } from "../../utils/get-established-channels-for-doc.js"
import { getStorageChannelIds } from "../../utils/get-storage-channel-ids.js"
import {
  addPeerSubscription,
  setPeerDocumentAwareness,
} from "../peer-state-helpers.js"
import type { EstablishedHandlerContext } from "../types.js"
import { batchAsNeeded } from "../utils.js"

export function handleSyncRequest(
  message: ChannelMsgSyncRequest,
  {
    channel,
    peerState,
    model,
    fromChannelId,
    logger,
    permissions,
  }: EstablishedHandlerContext,
): Command | undefined {
  const {
    docId,
    requesterDocVersion,
    ephemeral,
    bidirectional = true,
  } = message
  const commands: (Command | undefined)[] = []

  // ALWAYS track subscription
  // The peer is explicitly telling us they want this document
  // This ensures that if we get the document later, we know to send it to them
  addPeerSubscription(peerState, docId)

  // Set awareness to "pending" (maps to "aware" state)
  // We know the peer is interested in this doc, but we don't know if they have data
  // to give us yet. The requesterDocVersion is what they HAVE, not what they're offering.
  // We'll upgrade to "synced" when we receive their sync-response.
  setPeerDocumentAwareness(peerState, docId, "pending")

  let docState = model.documents.get(docId)

  logger.debug(
    "sync-request: updated peer {peerId} awareness ({awareness}) and subscription ({docId})",
    {
      peerId: channel.peerId,
      docId,
      awareness: "pending",
    },
  )

  // If we don't have the document, create it!
  // This allows peers to initialize documents on the server just by requesting them
  if (!docState) {
    // Check if peer is allowed to create this document
    // Use creation permission with peer context
    const peerContext = {
      peerId: peerState.identity.peerId,
      peerName: peerState.identity.name,
      peerType: peerState.identity.type,
      channelId: channel.channelId,
      channelKind: channel.kind,
    }

    if (!permissions.creation(docId, peerContext)) {
      logger.warn(
        "sync-request: peer {peerId} not allowed to create document {docId}, ignoring request",
        {
          docId,
          peerId: channel.peerId,
        },
      )
      // Can't create the document, return early
      return
    }

    // Check if this is a network request and we have storage adapters
    // If so, we need to consult storage before responding
    const storageChannelIds = getStorageChannelIds(model.channels)
    const isNetworkRequest = channel.kind === "network"

    if (isNetworkRequest && storageChannelIds.length > 0) {
      // Storage-first sync: queue the network request and ask storage first
      logger.debug(
        "sync-request: network request for unknown doc {docId}, consulting {count} storage adapter(s) first",
        {
          docId,
          count: storageChannelIds.length,
          peerId: channel.peerId,
        },
      )

      // Create doc with pending storage state
      docState = createDocState({ docId, peerId: model.identity.peerId })
      docState.pendingStorageChannels = new Set(storageChannelIds)
      docState.pendingNetworkRequests = [
        { channelId: fromChannelId, requesterDocVersion },
      ]
      model.documents.set(docId, docState)

      // Subscribe to the doc for future updates
      commands.push({
        type: "cmd/subscribe-doc",
        docId,
      })

      // Ask all storage adapters if they have this document
      // Use empty version to get full snapshot if they have it
      for (const storageChannelId of storageChannelIds) {
        commands.push({
          type: "cmd/send-sync-request",
          toChannelId: storageChannelId,
          docs: [{ docId, requesterDocVersion: new VersionVector(null) }],
          bidirectional: false, // We don't need storage to request back
        })
      }

      // Don't respond to network yet - wait for storage
      return batchAsNeeded(...commands)
    }

    // No storage adapters or this is a storage request - create doc and respond immediately
    logger.debug(
      "sync-request: creating new document ({docId}) from peer request",
      {
        docId,
        peerId: channel.peerId,
      },
    )
    docState = createDocState({ docId, peerId: model.identity.peerId })
    model.documents.set(docId, docState)
    commands.push({
      type: "cmd/subscribe-doc",
      docId,
    })
  }

  // Check if this doc is waiting for storage and this is another network request
  // If so, queue this request too
  if (
    docState.pendingStorageChannels &&
    docState.pendingStorageChannels.size > 0 &&
    channel.kind === "network"
  ) {
    logger.debug(
      "sync-request: doc {docId} is waiting for storage, queueing network request from {peerId}",
      {
        docId,
        peerId: channel.peerId,
      },
    )

    // Add to pending requests
    if (!docState.pendingNetworkRequests) {
      docState.pendingNetworkRequests = []
    }
    docState.pendingNetworkRequests.push({
      channelId: fromChannelId,
      requesterDocVersion,
    })

    // Don't respond yet - wait for storage
    return
  }

  // Apply incoming ephemeral data from the requester if provided
  // ephemeral is now EphemeralStoreData[]: { peerId, data, namespace }[]
  if (ephemeral && ephemeral.length > 0) {
    for (const store of ephemeral) {
      logger.debug(
        "sync-request: applying ephemeral data from {peerId} for {docId} namespace {namespace}",
        {
          peerId: store.peerId,
          docId,
          namespace: store.namespace,
        },
      )
      commands.push({
        type: "cmd/apply-ephemeral",
        docId,
        stores: [
          {
            peerId: store.peerId,
            data: store.data,
            namespace: store.namespace,
          },
        ],
      })

      // Relay requester's ephemeral to other peers (not back to requester)
      const otherChannelIds = getEstablishedChannelsForDoc(
        model.channels,
        model.peers,
        docId,
      ).filter(id => id !== fromChannelId)

      if (otherChannelIds.length > 0) {
        logger.debug(
          "sync-request: relaying ephemeral from {peerId} to {count} other peers for {docId}",
          {
            peerId: store.peerId,
            count: otherChannelIds.length,
            docId,
          },
        )
        commands.push({
          type: "cmd/send-message",
          envelope: {
            toChannelIds: otherChannelIds,
            message: {
              type: "channel/ephemeral",
              docId,
              hopsRemaining: 0, // Direct relay only
              stores: [
                {
                  peerId: store.peerId,
                  data: store.data,
                  namespace: store.namespace,
                },
              ],
            },
          },
        })
      }
    }
  }

  logger.debug("sending sync-response due to channel/sync-request", {
    docId,
    peerId: channel.peerId,
  })

  // Send sync-response with document data and ephemeral snapshot
  // The cmd/send-sync-response command will determine whether to send
  // a snapshot (full doc) or update (delta) based on requesterDocVersion
  // The includeEphemeral flag tells it to include all known ephemeral state
  commands.push({
    type: "cmd/send-sync-response",
    toChannelId: fromChannelId,
    docId,
    requesterDocVersion,
    includeEphemeral: true,
  })

  // Send reciprocal sync-request if bidirectional
  // If bidirectional is true, we want to ensure we are also subscribed to this document
  // and have the latest version from the peer.
  if (bidirectional) {
    logger.debug("sending reciprocal sync-request to {peerId} for {docId}", {
      peerId: channel.peerId,
      docId,
    })

    commands.push({
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [fromChannelId],
        message: {
          type: "channel/sync-request",
          docId,
          requesterDocVersion: docState.doc.version(),
          bidirectional: false, // Prevent infinite loops
        },
      },
    })
  }

  return batchAsNeeded(...commands)
}
