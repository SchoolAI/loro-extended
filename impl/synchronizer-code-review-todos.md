# Synchronizer Code Review TODOs

Generated: 2025-11-18
Last Updated: 2025-11-18

## 🔴 Critical Issues (Must Fix)

- [x] **TODO-1: Fix broken import path in handle-channel-added.ts** ✅ DONE
  - File: `packages/repo/src/synchronizer/handle-channel-added.ts:33`
  - Issue: `import type { ConnectedChannel } from "src/channel.js"` should be `"../channel.js"`
  - Impact: Runtime error - broken import
  - Priority: CRITICAL
  - **Fixed:** Changed to relative import `"../channel.js"`

- [x] **TODO-2: Review version comparison logic in setLoadingStateWithCommand** ✅ DONE
  - File: `packages/repo/src/synchronizer/state-helpers.ts:66`
  - Issue: `status.loading.version.compare(loading.version) !== undefined` allows downgrades
  - Current: Updates version whenever comparable (even if older)
  - Expected: Should only update if new version is newer (`=== -1`)
  - Impact: Could allow version downgrades
  - Priority: HIGH
  - **Fixed:** Changed condition to `=== -1` to only update when new version is newer
  - **Test:** Added comprehensive test suite in `state-helpers.test.ts` (4 tests, all passing)

## ⚠️ Design Concerns (Should Investigate)

- [x] **TODO-3: Document unused helper functions** ✅ DONE
  - File: `packages/repo/src/synchronizer/peer-state-helpers.ts`
  - Functions: `getChannelsForPeer()`, `getPeersWithDocument()`
  - Issue: Exported but never called internally
  - Resolution: These are part of the public API (exported from index.ts)
  - **Fixed:** Added comprehensive JSDoc documentation with use cases and examples
  - Note: Not "unused" - they're utility functions for external consumers
  - Priority: MEDIUM

- [ ] **TODO-4: Add peer state garbage collection or document why not needed**
  - File: `packages/repo/src/synchronizer/handle-channel-removed.ts`
  - Issue: Peer states accumulate indefinitely (intentional for reconnection)
  - Concern: Unbounded memory growth over time
  - Options: Add TTL/cleanup, or document why acceptable
  - Priority: MEDIUM

- [ ] **TODO-5: Standardize error handling across handlers**
  - Files: All handler files
  - Issue: Inconsistent - some return `{ type: "cmd/log" }`, others return undefined
  - Impact: Unclear error handling contract
  - Priority: LOW

- [ ] **TODO-6: Document race condition handling for concurrent sync-responses**
  - File: `packages/repo/src/synchronizer/handle-local-doc-ensure.ts`
  - Issue: Multiple channels can respond with different versions simultaneously
  - Current: Last write wins (implicit)
  - Question: Is this intentional? Should we have explicit conflict resolution?
  - Priority: LOW (document existing behavior)

## Progress

- Total: 6 items
- Critical: 2 ✅ (both complete)
- High: 0
- Medium: 2 (1 complete, 1 remaining)
- Low: 2
- Completed: 3 / 6 (50%)

## Notes

- All documentation is complete and comprehensive
- These issues were discovered during code review after documentation
- Focus on critical issues first (TODO-1, TODO-2)