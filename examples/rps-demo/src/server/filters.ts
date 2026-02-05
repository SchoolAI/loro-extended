import type { CommitInfo, LensFilter } from "@loro-extended/lens"
import { parseIdentityMessage, SERVER_PLAYER_ID } from "../shared/identity.js"

type OpLike = {
  container: string
  content?: {
    type?: string
    key?: unknown
  }
}

/**
 * Extract player name from a path-based container ID.
 *
 * With mergeable: true, container IDs are path-based like:
 * - "cid:root-game-players-alice:Map"
 * - "cid:root-game-players-bob:Map"
 *
 * @param containerId - The container ID to parse
 * @returns The player name, or null if not a player container
 */
function getPlayerFromContainerId(containerId: string): string | null {
  // Match pattern like "cid:root-game-players-alice:Map"
  const match = containerId.match(/^cid:root-game-players-([^:]+):Map$/)
  return match ? match[1] : null
}

/**
 * Check if any op targets the game root map's phase or result keys.
 * Only the server should be able to modify these.
 */
function targetsPhaseOrResult(ops: OpLike[]): boolean {
  return ops.some(op => {
    if (op.container !== "cid:root-game:Map") return false
    if (op.content?.type !== "insert" || op.content.key === undefined) {
      return false
    }
    const key = String(op.content.key)
    return key === "phase" || key === "result"
  })
}

/**
 * Get the set of player names whose containers are targeted by the ops.
 */
function getTargetedPlayers(ops: OpLike[]): Set<string> {
  const targets = new Set<string>()
  for (const op of ops) {
    const playerName = getPlayerFromContainerId(op.container)
    if (playerName) {
      targets.add(playerName)
    }
  }
  return targets
}

/**
 * Create a server-side lens filter that validates player commits:
 * - Accept server commits (they control phase/result)
 * - Accept player commits that only modify their own player state
 * - Reject player commits that try to modify other players' state
 * - Reject player commits that try to modify phase/result
 *
 * With mergeable: true, container IDs are path-based, so we can extract
 * the player name directly from the container ID without needing the doc.
 */
export const makeGameFilter = (): LensFilter => (info: CommitInfo) => {
  // This could be cryptographically signed, but is not for this demo
  const identity = parseIdentityMessage(info.message)

  if (!identity) {
    return false
  }

  if (identity.playerId === SERVER_PLAYER_ID) return true

  const ops = info.raw.ops as OpLike[]

  // Reject if trying to modify phase or result (server-only)
  if (targetsPhaseOrResult(ops)) {
    return false
  }

  // Get the players whose containers are being modified
  const targetedPlayers = getTargetedPlayers(ops)

  // If no player containers are targeted, allow (might be other shared state)
  if (targetedPlayers.size === 0) {
    return true
  }

  // Check that all targeted players match the commit's identity
  for (const targetPlayer of targetedPlayers) {
    if (targetPlayer !== identity.playerId) {
      return false
    }
  }

  return true
}
