import { Shape } from "@loro-extended/change"
import type { PeerID } from "@loro-extended/repo"

// ============================================================================
// Game Constants
// ============================================================================

export const ARENA_WIDTH = 800
export const ARENA_HEIGHT = 600
export const CAR_RADIUS = 25
export const CAR_WIDTH = 50
export const CAR_HEIGHT = 30

// Physics constants
export const MAX_SPEED = 8
export const ACCELERATION = 0.5
export const FRICTION = 0.98
export const WALL_BOUNCE = 0.7
export const CAR_BOUNCE = 0.8
export const ROTATION_SPEED = 0.1

// Game loop
export const TICK_RATE = 60 // Server runs at 60fps
export const TICK_INTERVAL = 1000 / TICK_RATE

// ============================================================================
// Color Palette - Distinct colors for easy identification
// ============================================================================

export const CAR_COLORS = [
  "#FF6B6B", // Red
  "#FF9F43", // Orange
  "#FFEAA7", // Yellow
  "#26DE81", // Green
  "#4ECDC4", // Teal
  "#54A0FF", // Blue
  "#A55EEA", // Purple
  "#FFB8D0", // Pink (lighter/pastel)
  "#2D3436", // Charcoal
  "#FFFFFF", // White
] as const

export type CarColor = (typeof CAR_COLORS)[number]

// ============================================================================
// Document Schema (Persistent - Scoreboard)
// ============================================================================

// Player score uses a map with counter for bumps (allows concurrent increments)
export const PlayerScoreSchema = Shape.map({
  name: Shape.plain.string(),
  color: Shape.plain.string(),
  bumps: Shape.counter(),
})

export const ArenaSchema = Shape.doc({
  scores: Shape.record(PlayerScoreSchema),
})

export type PlayerScore = {
  name: string
  color: string
  bumps: number
}

// ============================================================================
// Presence Schemas (Ephemeral) - Using Discriminated Union
// Placeholder values are derived from schema annotations - no separate empty state needed
// ============================================================================

/**
 * Input state from a client's joystick/keyboard
 */
const InputStateSchema = Shape.plain.object({
  force: Shape.plain.number(), // 0-1 normalized force, default 0
  angle: Shape.plain.number(), // radians, default 0
})

export type InputState = {
  force: number
  angle: number
}

/**
 * Client presence schema - sent by each player
 * Contains their input state and identity info
 * Placeholder values are derived from .placeholder() annotations
 */
export const ClientPresenceSchema = Shape.plain.object({
  type: Shape.plain.string("client"),
  name: Shape.plain.string(), // default ""
  color: Shape.plain.string().placeholder(CAR_COLORS[0]),
  input: InputStateSchema,
})

export type ClientPresence = {
  type: "client"
  name: string
  color: string
  input: InputState
}

// EmptyClientPresence removed - placeholder is derived from schema

/**
 * Car state in the game world
 */
const CarStateSchema = Shape.plain.object({
  x: Shape.plain.number(),
  y: Shape.plain.number(),
  vx: Shape.plain.number(),
  vy: Shape.plain.number(),
  rotation: Shape.plain.number(),
  color: Shape.plain.string(),
  name: Shape.plain.string(),
  hitUntil: Shape.plain.number(), // Timestamp when hit effect ends (0 = not hit)
})

export type CarState = {
  x: number
  y: number
  vx: number
  vy: number
  rotation: number
  color: string
  name: string
  hitUntil: number // Timestamp when hit effect ends (0 = not hit)
}

/**
 * Server presence schema - broadcast by the server
 * Contains the authoritative game state
 * Placeholder values are derived from .placeholder() annotations
 */
export const ServerPresenceSchema = Shape.plain.object({
  type: Shape.plain.string("server"),
  cars: Shape.plain.record(CarStateSchema), // default {}
  tick: Shape.plain.number(), // default 0
})

export type ServerPresence = {
  type: "server"
  cars: Record<PeerID, CarState>
  tick: number
}

// EmptyServerPresence removed - placeholder is derived from schema

/**
 * Combined presence schema using discriminated union
 * This allows type-safe handling of both client and server presence
 */
export const GamePresenceSchema = Shape.plain.discriminatedUnion("type", {
  client: ClientPresenceSchema,
  server: ServerPresenceSchema,
})

/**
 * Combined presence type - can be either client or server
 */
export type GamePresence = ClientPresence | ServerPresence

// ============================================================================
// Collision Types
// ============================================================================

export type Collision = {
  peer1: PeerID
  peer2: PeerID
  timestamp: number
  // Which peer(s) scored - only the car that hit with its front scores
  scorers: PeerID[]
}

// ============================================================================
// Arena Document ID
// ============================================================================

export const ARENA_DOC_ID = "bumper-cars-arena"
