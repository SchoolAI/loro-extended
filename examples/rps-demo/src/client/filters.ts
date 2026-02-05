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
 * Create a client-side lens filter that enforces sovereignty:
 * - Accept server commits (they control phase/result)
 * - Accept own commits that only modify own player state
 * - Reject other players' commits that try to modify our state
 * - Accept other players' commits that modify their own state
 * 
 * With mergeable: true, container IDs are path-based, so we can extract
 * the player name directly from the container ID.
 * 
 * @param playerId - The current player's ID
 */
export function createClientLensFilter(playerId: string): LensFilter {
  return (info: CommitInfo) => {
    const identity = parseIdentityMessage(info.message)

    // Accept server commits
    if (identity?.playerId === SERVER_PLAYER_ID) return true

    // Reject commits without identity
    if (!identity) return false

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

    // For own commits: only allow if targeting own container
    if (identity.playerId === playerId) {
      for (const targetPlayer of targetedPlayers) {
        if (targetPlayer !== playerId) {
          return false
        }
      }
      return true
    }

    // For other players' commits: reject if they target our container
    for (const targetPlayer of targetedPlayers) {
      if (targetPlayer === playerId) {
        // Another player is trying to modify our state - reject
        return false
      }
    }

    // Other player modifying their own state - accept
    return true
  }
}
