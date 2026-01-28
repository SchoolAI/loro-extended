/**
 * Change Filters - Shared filtering helpers
 *
 * These helpers inspect commit ops and identity to support
 * role-specific filters (server and client).
 */

import type { CommitInfo } from "@loro-extended/lens"
import { type GameIdentity, SERVER_PLAYER_ID } from "./identity.js"

/**
 * Game filter that validates peer commits:
 * - Only allow changes to the peer's own player entry
 * - Reject changes to phase or result (server-controlled)
 * - Reject changes to other players' data
 *
 * The filter uses `source.commitIdentity` (extracted from commit messages)
 * to determine which player is making the change.
 */
type OpLike = {
  container: string
  content?: {
    type?: string
    key?: unknown
  }
}

export function getTargetPlayers(info: CommitInfo): Set<string> {
  const targets = new Set<string>()
  for (const op of info.raw.ops as OpLike[]) {
    const playersMapMatch = op.container.match(/\/players\/([^/:]+):/)
    if (playersMapMatch) {
      targets.add(playersMapMatch[1])
    }
  }
  return targets
}

export function targetsPhaseOrResult(info: CommitInfo): boolean {
  return (info.raw.ops as OpLike[]).some(op => {
    if (op.container !== "cid:root-game:Map") return false
    if (op.content?.type !== "insert" || op.content.key === undefined) {
      return false
    }
    const key = String(op.content.key)
    return key === "phase" || key === "result"
  })
}

export function targetsPlayersMapInsert(info: CommitInfo): Set<string> {
  const targets = new Set<string>()
  for (const op of info.raw.ops as OpLike[]) {
    if (!op.container.includes("/players:")) continue
    if (op.content?.type !== "insert" || op.content.key === undefined) {
      continue
    }
    targets.add(String(op.content.key))
  }
  return targets
}

export function allowCommit(info: CommitInfo, playerId?: string): boolean {
  if (!playerId) return false
  if (playerId === SERVER_PLAYER_ID) return true
  if (targetsPhaseOrResult(info)) return false

  const playerTargets = getTargetPlayers(info)
  if ([...playerTargets].some(target => target !== playerId)) return false

  const insertTargets = targetsPlayersMapInsert(info)
  if ([...insertTargets].some(target => target !== playerId)) return false

  return true
}

export function getCommitPlayerId(info: CommitInfo): string | undefined {
  const identity = info.message as GameIdentity | null
  return identity?.playerId
}

export function isServerCommit(info: CommitInfo): boolean {
  return getCommitPlayerId(info) === SERVER_PLAYER_ID
}
