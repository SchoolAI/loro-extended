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
// Signaling Presence Schema (Ephemeral)
// ============================================================================

// For presence, we keep it simple - the signals field will hold
// arbitrary signal data from simple-peer. We use a permissive schema
// since presence is ephemeral and doesn't need strict validation.
//
// NOTE: We intentionally DON'T use Shape.plain.object for the presence
// because the mergeValue function in @loro-extended/change iterates over
// schema-defined keys and may not properly handle dynamic keys like peer IDs.
// Instead, we'll use the untyped presence API directly.
export const SignalingPresenceSchema = Shape.plain.object({
  // Display name for this peer
  name: Shape.plain.string(),

  // Current media preferences
  wantsAudio: Shape.plain.boolean(),
  wantsVideo: Shape.plain.boolean(),

  // WebRTC signaling - stored as a generic record
  // The actual structure is: Record<peerId, SignalData[]>
  // We use any here because simple-peer signal data is dynamic
  signals: Shape.plain.record(Shape.plain.array(Shape.plain.object({}))),
})

// Runtime types (more permissive than schema for actual usage)
// biome-ignore lint/suspicious/noExplicitAny: simple-peer signal data is dynamic
export type SignalData = any

export type SignalsMap = Record<string, SignalData[]>

export type SignalingPresence = {
  name: string
  wantsAudio: boolean
  wantsVideo: boolean
  signals: SignalsMap
}

export const EmptySignalingPresence = {
  name: "Anonymous",
  wantsAudio: true,
  wantsVideo: true,
  signals: {} as SignalsMap,
}