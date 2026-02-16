import type { PeerID } from "@loro-extended/repo"
import type {
  ClientPresence,
  GamePresence,
  InputState,
  PlayerScore,
  ServerPresence,
} from "../shared/types"

// =============================================================================
// Constants
// =============================================================================

/** Default input state (no movement) */
export const ZERO_INPUT: InputState = { force: 0, angle: 0 }

// =============================================================================
// Presence Partitioning
// =============================================================================

/** Result of partitioning presence data into server and client presences */
export type PartitionedPresences = {
  serverPresence: ServerPresence | null
  clientPresences: Record<PeerID, ClientPresence>
}

/**
 * Partitions raw presence data into server presence and client presences.
 * Replaces the 3-step useMemo chain (allPresence → serverPresence → clientPresences).
 */
export function partitionPresences(
  self: GamePresence | null | undefined,
  peers: Map<string, GamePresence | null | undefined>,
  myPeerId: PeerID,
): PartitionedPresences {
  let serverPresence: ServerPresence | null = null
  const clientPresences: Record<PeerID, ClientPresence> = {}

  // Check self presence
  if (self) {
    if (self.type === "server") {
      serverPresence = self
    } else if (self.type === "client") {
      clientPresences[myPeerId] = self
    }
  }

  // Check peer presences
  for (const [peerId, presence] of peers.entries()) {
    if (!presence) continue

    if (presence.type === "server") {
      serverPresence = presence
    } else if (presence.type === "client") {
      clientPresences[peerId as PeerID] = presence
    }
  }

  return { serverPresence, clientPresences }
}

// =============================================================================
// Active Players
// =============================================================================

/** Player info for the player list component */
export type ActivePlayer = {
  peerId: PeerID
  name: string
  color: string
}

/**
 * Extracts active player info from client presences.
 * Pure transformation for the PlayerList component.
 */
export function getActivePlayers(
  clientPresences: Record<PeerID, ClientPresence>,
): ActivePlayer[] {
  return Object.entries(clientPresences).map(([peerId, presence]) => ({
    peerId: peerId as PeerID,
    name: presence.name,
    color: presence.color,
  }))
}

// =============================================================================
// Client Presence Factory
// =============================================================================

/**
 * Factory function to create a ClientPresence object.
 * Centralizes the construction pattern used in multiple places.
 */
export function createClientPresence(
  name: string,
  color: string,
  input: InputState,
): ClientPresence {
  return {
    type: "client",
    name,
    color,
    input,
  }
}

// =============================================================================
// Score Sorting
// =============================================================================

/** Score entry with peer ID for display in scoreboard */
export type SortedScore = {
  peerId: PeerID
  name: string
  color: string
  bumps: number
}

/**
 * Sorts scores by bumps descending and limits to top N.
 * Pure transformation for the Scoreboard component.
 */
export function sortScores(
  scores: Record<string, PlayerScore>,
  limit: number,
): SortedScore[] {
  return Object.entries(scores)
    .map(([peerId, score]) => ({
      peerId: peerId as PeerID,
      name: score.name,
      color: score.color,
      bumps: score.bumps,
    }))
    .sort((a, b) => b.bumps - a.bumps)
    .slice(0, limit)
}

// =============================================================================
// Input Handling
// =============================================================================

/**
 * Combines joystick and keyboard inputs.
 * Joystick takes priority if it has any force applied.
 */
export function combineInputs(
  joystickInput: InputState,
  keyboardInput: InputState,
): InputState {
  if (joystickInput.force > 0) {
    return joystickInput
  }
  return keyboardInput
}

/**
 * Determines whether a presence update should be sent based on throttling rules.
 *
 * Rules:
 * - If input hasn't changed, don't send
 * - If this is a "stop" input (force = 0), send immediately (responsive joystick release)
 * - Otherwise, respect the throttle interval
 */
export function shouldSendPresenceUpdate(
  currentInput: InputState,
  lastInput: InputState,
  lastUpdateTime: number,
  now: number,
  throttleMs: number,
): boolean {
  // Check if input actually changed
  const inputChanged =
    lastInput.force !== currentInput.force ||
    lastInput.angle !== currentInput.angle

  if (!inputChanged) {
    return false
  }

  // Always send zero-force updates immediately (joystick released)
  const isStopInput = currentInput.force === 0
  if (isStopInput) {
    return true
  }

  // Otherwise throttle updates
  const timeSinceLastUpdate = now - lastUpdateTime
  return timeSinceLastUpdate >= throttleMs
}
