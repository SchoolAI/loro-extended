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
 *    - Controlled by `canReveal` rule
 *
 * 2. **Sync Flow** (transferring document data):
 *    - `sync-request/response` - Peers explicitly request and receive document data
 *    - Controlled by `canUpdate` rule
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
import type { VersionVector } from "loro-crdt"
import type { Patch } from "mutative"
import type {
  AddressedEstablishedEnvelope,
  AddressedEstablishmentEnvelope,
  Channel,
  ConnectedChannel,
  ReturnEnvelope,
} from "./channel.js"
import type { Rules } from "./rules.js"
import { synchronizerDispatcher } from "./synchronizer/synchronizer-dispatcher.js"
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
  | { type: "synchronizer/local-doc-change"; docId: DocId }
  | { type: "synchronizer/doc-delete"; docId: DocId }
  | {
      type: "synchronizer/doc-imported"
      docId: DocId
      fromPeerId: PeerID
    }

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
  | {
      type: "cmd/import-doc-data"
      docId: DocId
      data: Uint8Array
      fromPeerId: PeerID
    }
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
 * Creates the core synchronizer update logic with rules captured in closure
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
 * @param rules - Rules for canReveal and canUpdate checks
 * @param synchronizerLogger - Logger for tracing message flow
 * @returns Mutative update function (converted to immutable by makeImmutableUpdate)
 */
function createSynchronizerLogic(rules: Rules, synchronizerLogger: Logger) {
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
      logger.trace("{type}", detail)
    }

    return synchronizerDispatcher(msg, model, rules, logger)
  }
}

type CreateSynchronizerUpdateParams = {
  rules: Rules
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
 *   rules: {
 *     canReveal: (ctx) => ctx.channelKind === "storage" || isOwner(ctx),
 *     canUpdate: (ctx) => ctx.channelKind === "storage" || hasWriteAccess(ctx),
 *   },
 *   logger: getLogger(["my-app", "sync"]),
 *   onUpdate: (patches) => console.log("State changed:", patches),
 * })
 * ```
 *
 * @param rules - Rules for canReveal and canUpdate checks
 * @param logger - Optional logger (defaults to @loro-extended/repo logger)
 * @param onUpdate - Optional callback for debugging state changes
 * @returns Immutable update function compatible with raj/TEA pattern
 */
export function createSynchronizerUpdate({
  rules,
  logger,
  onUpdate,
}: CreateSynchronizerUpdateParams) {
  return makeImmutableUpdate(
    createSynchronizerLogic(
      rules,
      logger ?? getLogger(["@loro-extended", "repo"]),
    ),
    onUpdate,
  )
}
