import type { CommitInfo, LensFilter } from "@loro-extended/lens"
import {
  allowCommit,
  getCommitPlayerId,
  isServerCommit,
} from "../shared/filters.js"

export function createClientLensFilter(playerId: string): LensFilter {
  return (info: CommitInfo) => {
    if (isServerCommit(info)) return true
    const commitPlayerId = getCommitPlayerId(info)
    if (!commitPlayerId) return false

    if (commitPlayerId === playerId) {
      return allowCommit(info, commitPlayerId)
    }

    // For non-server peers, only accept if they DON'T touch any player state.
    // This preserves shared state while enforcing per-player sovereignty.
    return allowCommit(info, playerId)
  }
}
