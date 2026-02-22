import { Shape } from "@loro-extended/change"
import type { Infer } from "@loro-extended/repo"

// ============================================================================
// Room Document Schema (Persistent CRDT)
// ============================================================================

export const ParticipantSchema = Shape.struct({
  peerId: Shape.plain.string(),
  name: Shape.plain.string(),
  joinedAt: Shape.plain.number(),
})
export type Participant = Infer<typeof ParticipantSchema>

export const RoomMetadataSchema = Shape.struct({
  name: Shape.plain.string(),
  createdAt: Shape.plain.number(),
})
export type RoomMetadata = Infer<typeof RoomMetadataSchema>

export const RoomSchema = Shape.doc({
  // Room metadata stored in a map container
  metadata: RoomMetadataSchema,

  // Participant list - who has joined the room
  participants: Shape.list(ParticipantSchema),
})
export type Room = Infer<typeof RoomSchema>

// ============================================================================
// Presence Types (Ephemeral)
// ============================================================================

/**
 * WebRTC signal data for establishing peer connections.
 *
 * This is a discriminated union matching ALL signals that simple-peer emits:
 * - `offer`: SDP offer to initiate a connection
 * - `answer`: SDP answer in response to an offer
 * - `candidate`: ICE candidate for NAT traversal
 * - `transceiverRequest`: Request to add a transceiver (for adding tracks mid-call)
 * - `renegotiate`: Request to renegotiate the connection
 *
 * The `targetInstanceId` field is our extension to support signal routing
 * when a peer has multiple browser sessions.
 */
export type SignalData =
  | {
      type: "offer"
      sdp: string
      targetInstanceId?: string
    }
  | {
      type: "answer"
      sdp: string
      targetInstanceId?: string
    }
  | {
      type: "candidate"
      /** ICE candidate data - matches RTCIceCandidateInit but inlined for Node.js compatibility */
      candidate: {
        candidate?: string
        sdpMid?: string | null
        sdpMLineIndex?: number | null
        usernameFragment?: string | null
      }
      targetInstanceId?: string
    }
  | {
      type: "transceiverRequest"
      /** Request to add a transceiver for adding tracks mid-call */
      transceiverRequest: {
        kind: string
        init?: unknown
      }
      targetInstanceId?: string
    }
  | {
      type: "renegotiate"
      /** Marker indicating renegotiation is needed */
      renegotiate: true
      targetInstanceId?: string
    }

/**
 * Type guard to validate incoming signal data from untrusted sources (e.g., presence).
 *
 * Validates the structure matches one of the known signal types.
 * Invalid signals are filtered out with a warning logged.
 *
 * @param value - The value to check
 * @returns true if value is a valid SignalData
 */
export function isSignalData(value: unknown): value is SignalData {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const obj = value as Record<string, unknown>

  // Validate targetInstanceId if present
  if (
    obj.targetInstanceId !== undefined &&
    typeof obj.targetInstanceId !== "string"
  ) {
    return false
  }

  switch (obj.type) {
    case "offer":
    case "answer":
      return typeof obj.sdp === "string"

    case "candidate":
      return typeof obj.candidate === "object" && obj.candidate !== null

    case "transceiverRequest":
      return (
        typeof obj.transceiverRequest === "object" &&
        obj.transceiverRequest !== null
      )

    case "renegotiate":
      return obj.renegotiate === true

    default:
      return false
  }
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
export const UserPresenceSchema = Shape.plain.struct({
  name: Shape.plain.string().placeholder("Anonymous"),
  wantsAudio: Shape.plain.boolean().placeholder(true),
  wantsVideo: Shape.plain.boolean().placeholder(true),
})
export type UserPresence = Infer<typeof UserPresenceSchema>

/**
 * Ephemeral declarations for user presence
 */
export const UserEphemeralDeclarations = {
  presence: UserPresenceSchema,
}

/**
 * Signaling presence - high-frequency, transient WebRTC signals.
 * Used for WebRTC connection establishment.
 *
 * Signals are keyed by target peer ID, with an array of signal data
 * to send to that peer.
 */
export const SignalingPresenceSchema = Shape.plain.struct({
  instanceId: Shape.plain.string(),
  signals: Shape.plain.record(Shape.plain.array(Shape.plain.struct({}))),
})
export type SignalingPresence = Infer<typeof SignalingPresenceSchema>

/**
 * Ephemeral declarations for signaling presence
 */
export const SignalingEphemeralDeclarations = {
  presence: SignalingPresenceSchema,
}
