/**
 * Change Filters - Shared filtering helpers
 *
 * These helpers extract identity from commit messages to support
 * role-specific filters (server and client).
 *
 * Note: The actual container-based filtering logic is in:
 * - src/server/filters.ts (server-side)
 * - src/client/filters.ts (client-side)
 *
 * These filters use the doc to map container IDs to player names,
 * since container IDs are numeric (e.g., "cid:2@123456:Map") rather
 * than path-based (e.g., "cid:root-game/players/alice:Map").
 */

import type { CommitInfo } from "@loro-extended/lens"
import { type GameIdentity, SERVER_PLAYER_ID } from "./identity.js"

/**
 * Get the player ID from a commit's message.
 */
export function getCommitPlayerId(info: CommitInfo): string | undefined {
  const identity = info.message as GameIdentity | null
  return identity?.playerId
}

/**
 * Check if a commit is from the server.
 */
export function isServerCommit(info: CommitInfo): boolean {
  return getCommitPlayerId(info) === SERVER_PLAYER_ID
}
