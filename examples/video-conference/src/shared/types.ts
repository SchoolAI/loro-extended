import { Shape } from "@loro-extended/change"
import type { Infer, PeerID } from "@loro-extended/repo"

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

// ============================================================================
// Presence Types (Ephemeral)
// ============================================================================

// Runtime types (more permissive than schema for actual usage)
export type SignalData = {
  type: "offer" | "answer" | "candidate"
  sdp?: string
  candidate?: any
  targetInstanceId?: string // The instance ID this signal is intended for
  [key: string]: any
}

export type SignalsMap = Record<string, SignalData[]>

// ============================================================================
// Presence Schemas (for reference, we use untyped presence API)
// ============================================================================

/**
 * User presence - stable metadata that changes infrequently.
 * Used for displaying participant info in the UI.
 *
 * This is separate from signaling to avoid mixing high-frequency signal updates
 * with stable user metadata.
 */
export type UserPresence = Infer<typeof UserPresenceSchema>
export const UserPresenceSchema = Shape.plain.object({
  name: Shape.plain.string().placeholder("Anonymous"),
  wantsAudio: Shape.plain.boolean().placeholder(true),
  wantsVideo: Shape.plain.boolean().placeholder(true),
})

/**
 * Signaling presence - high-frequency, transient WebRTC signals.
 * Used for WebRTC connection establishment.
 *
 * Signals are keyed by target peer ID, with an array of signal data
 * to send to that peer.
 */
export type SignalingPresence = Infer<typeof SignalingPresenceSchema>
export const SignalingPresenceSchema = Shape.plain.object({
  instanceId: Shape.plain.string(),
  signals: Shape.plain.record(Shape.plain.array(Shape.plain.object({}))),
})
