import { Shape } from "@loro-extended/change"
import type { PeerID } from "@loro-extended/repo"

// ============================================================================
// Room Document Schema (Persistent CRDT)
// ============================================================================

export const ParticipantSchema = Shape.map({
  peerId: Shape.plain.string(),
  name: Shape.plain.string(),
  joinedAt: Shape.plain.number(),
})

export const RoomMetadataSchema = Shape.map({
  name: Shape.plain.string(),
  createdAt: Shape.plain.number(),
})

export const RoomSchema = Shape.doc({
  // Room metadata stored in a map container
  metadata: RoomMetadataSchema,

  // Participant list - who has joined the room
  participants: Shape.list(ParticipantSchema),
})

export type Participant = {
  peerId: PeerID
  name: string
  joinedAt: number
}

export const EmptyRoom = {
  metadata: {
    name: "",
    createdAt: 0,
  },
  participants: [],
}

// ============================================================================
// Presence Types (Ephemeral)
// ============================================================================

// Runtime types (more permissive than schema for actual usage)
// biome-ignore lint/suspicious/noExplicitAny: simple-peer signal data is dynamic
export type SignalData = any

export type SignalsMap = Record<string, SignalData[]>

/**
 * User presence - stable metadata that changes infrequently.
 * Used for displaying participant info in the UI.
 * 
 * This is separate from signaling to avoid mixing high-frequency signal updates
 * with stable user metadata.
 */
export type UserPresence = {
  name: string
  wantsAudio: boolean
  wantsVideo: boolean
}

export const EmptyUserPresence: UserPresence = {
  name: "Anonymous",
  wantsAudio: true,
  wantsVideo: true,
}

/**
 * Signaling presence - high-frequency, transient WebRTC signals.
 * Used for WebRTC connection establishment.
 * 
 * Signals are keyed by target peer ID, with an array of signal data
 * to send to that peer.
 */
export type SignalingPresence = {
  signals: SignalsMap
}

export const EmptySignalingPresence: SignalingPresence = {
  signals: {},
}

// ============================================================================
// Presence Schemas (for reference, we use untyped presence API)
// ============================================================================

// NOTE: We intentionally DON'T use Shape.plain.object for the presence
// because the mergeValue function in @loro-extended/change iterates over
// schema-defined keys and may not properly handle dynamic keys like peer IDs.
// Instead, we'll use the untyped presence API directly.

export const UserPresenceSchema = Shape.plain.object({
  name: Shape.plain.string(),
  wantsAudio: Shape.plain.boolean(),
  wantsVideo: Shape.plain.boolean(),
})

export const SignalingPresenceSchema = Shape.plain.object({
  signals: Shape.plain.record(Shape.plain.array(Shape.plain.object({}))),
})