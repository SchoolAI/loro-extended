/**
 * Synchronizer Program - Core orchestration for document discovery and synchronization
 *
 * This module implements the main state machine for the loro-extended synchronization protocol.
 * It follows The Elm Architecture (TEA) pattern with immutable updates via the mutative library.
 *
 * ## Architecture Overview
 *
 * The synchronizer uses a **pull-based discovery model** with two main message flows:
 *
 * 1. **Discovery Flow** (what documents exist):
 *    - `directory-request/response` - Peers announce and discover documents
 *    - Controlled by `canReveal` permission rule
 *
 * 2. **Sync Flow** (transferring document data):
 *    - `sync-request/response` - Peers explicitly request and receive document data
 *    - Controlled by `canUpdate` permission rule
 *
 * ## Key Design Principles
 *
 * - **Separation of Concerns**: Discovery and sync are separate, explicit steps
 * - **Privacy by Design**: Rules checked at every decision point
 * - **Symmetric Protocol**: Both peers use the same patterns (no client/server roles)
 * - **Pull-Based**: Peers announce documents, interested peers request them
 *
 * ## Message Flow Patterns
 *
 * ### Pattern 1: New Document Created
 * ```
 * 1. local-doc-change triggered
 * 2. Send directory-response (announcement) to channels where canReveal=true
 * 3. Interested peers send sync-request
 * 4. Send sync-response with document data
 * ```
 *
 * ### Pattern 2: Existing Document Modified
 * ```
 * 1. local-doc-change triggered
 * 2. If peer has previously requested (peerWantsUpdates=true):
 *    - Send sync-response directly (real-time update)
 * 3. Otherwise: Send directory-response announcement
 * ```
 *
 * ### Pattern 3: Peer Connection Established
 * ```
 * 1. establish-request/response handshake
 * 2. Both peers send directory-request
 * 3. Both peers send sync-request for their own documents
 * 4. Discovery and sync happen in parallel
 * ```
 *
 * @see docs/discovery-and-sync-architecture.md for detailed architecture documentation
 */

import { getLogger, type Logger } from "@logtape/logtape"
import { omit } from "lodash-es"
import type { VersionVector } from "loro-crdt"
import type { Patch } from "mutative"
import type {
  AddressedEstablishedEnvelope,
  AddressedEstablishmentEnvelope,
  Channel,
  ChannelMsg,
  ConnectedChannel,
  ReturnEnvelope,
} from "./channel.js"
import { isEstablished } from "./channel.js"
import type { Rules } from "./rules.js"
import {
  type ChannelHandlerContext,
  handleChannelAdded,
  handleChannelRemoved,
  handleDirectoryRequest,
  handleDirectoryResponse,
  handleDocChange,
  handleDocDelete,
  handleDocEnsure,
  handleEstablishChannel,
  handleEstablishRequest,
  handleEstablishResponse,
  handleSyncRequest,
  handleSyncResponse,
} from "./synchronizer/index.js"
import type {
  ChannelId,
  DocId,
  DocState,
  PeerID,
  PeerIdentityDetails,
  PeerState,
  ReadyState,
} from "./types.js"
import { makeImmutableUpdate } from "./utils/make-immutable-update.js"
import { getEstablishedChannelsForDoc } from "./utils/get-established-channels-for-doc.js"
import { handleEphemeral } from "./synchronizer/handle-ephemeral.js"

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// STATE
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

/**
 * The synchronizer's state model
 *
 * This represents the complete state of the synchronization system at any point in time.
 * All state updates are immutable (via mutative library).
 */
export type SynchronizerModel = {
  /** Our own peer identity */
  identity: PeerIdentityDetails

  /** All documents we know about (local and synced from peers) */
  documents: Map<DocId, DocState>

  /** All active channels (storage adapters, network peers) */
  channels: Map<ChannelId, Channel>

  /**
   * Peer state tracking for reconnection optimization
   *
   * Tracks what each peer knows about our documents to enable:
   * - Optimized sync on reconnection (only send changed docs)
   * - Awareness-based message routing (announcements vs updates)
   */
  peers: Map<PeerID, PeerState>
}

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// MESSAGES (inputs to the update function)
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

/**
 * Messages that drive the synchronizer state machine
 *
 * These are the inputs to the update function. Each message triggers
 * a state transition and may produce commands as side effects.
 */
export type SynchronizerMessage =
  // A heartbeat signal given to us from Synchronizer runtime; used for ephemeral store
  | { type: "synchronizer/heartbeat" }
  | { type: "synchronizer/ephemeral-local-change"; docId: DocId }

  // Channel lifecycle messages
  | { type: "synchronizer/channel-added"; channel: ConnectedChannel }
  | { type: "synchronizer/establish-channel"; channelId: ChannelId }
  | { type: "synchronizer/channel-removed"; channel: Channel }

  // Document lifecycle messages
  | { type: "synchronizer/doc-ensure"; docId: DocId }
  | { type: "synchronizer/doc-change"; docId: DocId }
  | { type: "synchronizer/doc-delete"; docId: DocId }

  // Channel message received (from network or storage)
  | { type: "synchronizer/channel-receive-message"; envelope: ReturnEnvelope }

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// COMMANDS (outputs of the update function)
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

/**
 * Commands are side effects produced by the update function
 *
 * The synchronizer is pure - it doesn't perform side effects directly.
 * Instead, it returns commands that the runtime executes.
 */
export type Command =
  // Channel operations
  | { type: "cmd/stop-channel"; channel: Channel }
  | {
      type: "cmd/send-establishment-message"
      envelope: AddressedEstablishmentEnvelope
    }
  | { type: "cmd/send-message"; envelope: AddressedEstablishedEnvelope }
  | {
      type: "cmd/send-sync-response"
      docId: DocId
      requesterDocVersion: VersionVector
      toChannelId: ChannelId
    }

  // Document operations
  | { type: "cmd/subscribe-doc"; docId: DocId }
  | { type: "cmd/apply-ephemeral"; docId: DocId; data: Uint8Array }
  | {
      type: "cmd/broadcast-ephemeral"
      docId: DocId
      allPeerData: boolean
      hopsRemaining: number
      toChannelIds: ChannelId[]
    }
  | {
      type: "cmd/remove-ephemeral-peer"
      peerId: PeerID
    }

  // Events
  | {
      type: "cmd/emit-ready-state-changed"
      docId: DocId
      readyStates: ReadyState[]
    }
  | {
      type: "cmd/emit-ephemeral-change"
      docId: DocId
    }

  // Utilities
  | { type: "cmd/dispatch"; dispatch: SynchronizerMessage }
  | { type: "cmd/batch"; commands: Command[] }

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// PROGRAM DEFINITION
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

export type Program = {
  update(
    message: SynchronizerMessage,
    model: SynchronizerModel,
  ): [SynchronizerModel, Command?]
}

/**
 * Initialize the synchronizer with a peer identity
 *
 * @param identity - Our peer identity (name and stable peerId)
 * @returns Initial model state with no documents, channels, or peers
 */
export function init(
  identity: PeerIdentityDetails,
): [SynchronizerModel, Command?] {
  return [
    {
      identity,
      documents: new Map(),
      channels: new Map(),
      peers: new Map(),
    },
  ]
}

/**
 * Creates the core synchronizer update logic with permissions captured in closure
 *
 * This function creates a mutative update function that's easier to write and reason about.
 * The mutative library automatically converts it to an immutable update function.
 *
 * ## Message Routing
 *
 * The synchronizer handles two categories of messages:
 *
 * 1. **Synchronizer Messages** (synchronizer/*):
 *    - Channel lifecycle (added, removed, establish)
 *    - Document lifecycle (ensure, change, delete)
 *    - Handled directly in this switch statement
 *
 * 2. **Channel Messages** (channel/*):
 *    - Protocol messages from peers (establish, sync, directory)
 *    - Routed to mutatingChannelUpdate for dispatch
 *
 * @param permissions - Rules for canReveal and canUpdate checks
 * @param synchronizerLogger - Logger for tracing message flow
 * @returns Mutative update function (converted to immutable by makeImmutableUpdate)
 */
function createSynchronizerLogic(
  permissions: Rules,
  synchronizerLogger: Logger,
) {
  const logger = synchronizerLogger.getChild("program")

  // A mutating update function is easier to read and write, because we need only concern ourselves
  // with what needs to change, using standard assignment and JS operations. But the machinery
  // around this function turns it back into an immutable `update` function like raj/TEA expects.
  return function mutatingUpdate(
    msg: SynchronizerMessage,
    model: SynchronizerModel,
  ): Command | undefined {
    // Log all messages except channel-receive-message (too noisy)
    if (msg.type !== "synchronizer/channel-receive-message") {
      const detail = "data" in msg ? { ...msg, data: "[omitted]" } : msg
      logger.trace(msg.type, detail)
    }

    // Route synchronizer messages to their handlers
    // Each handler is in its own file under src/synchronizer/
    switch (msg.type) {
      case "synchronizer/heartbeat": {
        // Broadcast all ephemeral state for all documents to all peers
        const commands: Command[] = []

        for (const docId of model.documents.keys()) {
          const channelIds = getEstablishedChannelsForDoc(
            model.channels,
            model.peers,
            docId,
          )

          if (channelIds.length > 0) {
            commands.push({
              type: "cmd/broadcast-ephemeral",
              docId,
              allPeerData: true,
              hopsRemaining: 0,
              toChannelIds: channelIds,
            })
          }
        }

        return commands.length > 0 ? { type: "cmd/batch", commands } : undefined
      }

      case "synchronizer/ephemeral-local-change": {
        const channelIds = getEstablishedChannelsForDoc(
          model.channels,
          model.peers,
          msg.docId,
        )

        return {
          type: "cmd/batch",
          commands: [
            {
              type: "cmd/emit-ephemeral-change",
              docId: msg.docId,
            },
            {
              type: "cmd/broadcast-ephemeral",
              docId: msg.docId,
              allPeerData: false,
              // Allow a hub-and-spoke server to propagate one more hop
              hopsRemaining: 1,
              toChannelIds: channelIds,
            },
          ],
        }
      }

      case "synchronizer/channel-added":
        return handleChannelAdded(msg, model)

      case "synchronizer/establish-channel":
        return handleEstablishChannel(msg, model, logger)

      case "synchronizer/channel-removed":
        return handleChannelRemoved(msg, model, logger)

      case "synchronizer/doc-ensure":
        return handleDocEnsure(msg, model, permissions)

      case "synchronizer/doc-change":
        return handleDocChange(msg, model, permissions, logger)

      case "synchronizer/doc-delete":
        return handleDocDelete(msg, model, logger)

      case "synchronizer/channel-receive-message":
        // Channel messages are routed through the channel dispatcher
        return mutatingChannelUpdate(
          msg.envelope.message,
          model,
          msg.envelope.fromChannelId,
          permissions,
          logger,
        )
    }
    return
  }
}

// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
// CHANNEL MESSAGE DISPATCHER
// =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

/**
 * Dispatches channel protocol messages to their handlers
 *
 * Channel messages implement the discovery and sync protocol between peers.
 * This function:
 * 1. Validates the channel exists
 * 2. Logs the message for debugging
 * 3. Routes to the appropriate handler based on message type
 *
 * ## Message Types
 *
 * **Establishment** (connection setup):
 * - `establish-request` - Peer wants to connect
 * - `establish-response` - Connection accepted
 *
 * **Discovery** (what documents exist):
 * - `directory-request` - Ask peer what documents they have
 * - `directory-response` - Announce documents (filtered by canReveal)
 *
 * **Sync** (transfer document data):
 * - `sync-request` - Request document data
 * - `sync-response` - Send document data (filtered by canUpdate)
 *
 * @see docs/discovery-and-sync-architecture.md for protocol details
 */
function mutatingChannelUpdate(
  channelMessage: ChannelMsg,
  model: SynchronizerModel,
  fromChannelId: ChannelId,
  permissions: Rules,
  logger: Logger,
): Command | undefined {
  const channel = model.channels.get(fromChannelId)

  if (!channel) {
    logger.warn(
      `channel not found corresponding to from-channel-id: ${fromChannelId}`,
    )
    return
  }

  // Determine sender name for logging
  const from = isEstablished(channel)
    ? model.peers.get(channel.peerId)?.identity.name
    : channelMessage.type === "channel/establish-request"
      ? channelMessage.identity.name
      : channelMessage.type === "channel/establish-response"
        ? channelMessage.identity.name
        : "unknown"

  // Log all channel messages for debugging
  logger.trace(channelMessage.type, {
    from,
    to: model.identity.name,
    via: fromChannelId,
    dir: "recv",
    channelMessage: omit(channelMessage, "type"),
  })

  // Build context for handlers
  const ctx: ChannelHandlerContext = {
    channel,
    model,
    fromChannelId,
    permissions,
    logger,
  }

  // Route to appropriate handler
  // Each handler is in its own file under src/synchronizer/
  switch (channelMessage.type) {
    case "channel/establish-request":
      return handleEstablishRequest(channelMessage, ctx)

    case "channel/establish-response":
      return handleEstablishResponse(channelMessage, ctx)

    case "channel/sync-request":
      return handleSyncRequest(channelMessage, ctx)

    case "channel/sync-response":
      return handleSyncResponse(channelMessage, ctx)

    case "channel/directory-request":
      return handleDirectoryRequest(channelMessage, ctx)

    case "channel/directory-response":
      return handleDirectoryResponse(channelMessage, ctx)

    case "channel/ephemeral":
      return handleEphemeral(channelMessage, ctx)
  }
  return
}

type CreateSynchronizerUpdateParams = {
  permissions: Rules
  logger?: Logger
  onUpdate?: (patches: Patch[]) => void
}

/**
 * Creates the main synchronizer update function
 *
 * This is the public API for creating a synchronizer. It wraps the mutative
 * update logic with immutability guarantees via the mutative library.
 *
 * ## Usage
 *
 * ```typescript
 * const update = createSynchronizerUpdate({
 *   permissions: {
 *     canReveal: (ctx) => ctx.channelKind === "storage" || isOwner(ctx),
 *     canUpdate: (ctx) => ctx.channelKind === "storage" || hasWriteAccess(ctx),
 *   },
 *   logger: getLogger(["my-app", "sync"]),
 *   onUpdate: (patches) => console.log("State changed:", patches),
 * })
 * ```
 *
 * @param permissions - Rules for canReveal and canUpdate checks
 * @param logger - Optional logger (defaults to @loro-extended/repo logger)
 * @param onUpdate - Optional callback for debugging state changes
 * @returns Immutable update function compatible with raj/TEA pattern
 */
export function createSynchronizerUpdate({
  permissions,
  logger,
  onUpdate,
}: CreateSynchronizerUpdateParams) {
  return makeImmutableUpdate(
    createSynchronizerLogic(
      permissions,
      logger ?? getLogger(["@loro-extended", "repo"]),
    ),
    onUpdate,
  )
}

// Re-export helpers for backward compatibility
export { getReadyStates } from "./synchronizer/state-helpers.js"
