# Plan: Refactor PeerDocumentAwareness → PeerDocSyncState

## Problem Statement

The current `PeerDocumentAwareness` type and `ReadyState` type have misleading semantics that caused a race condition bug. The naming conflates "what we know about a peer's document" with "whether we've completed a sync handshake." This led to incorrect state transitions where receiving a `sync-request` set awareness to `"has-doc"` (implying sync complete), when it should have indicated "sync pending."

## Background

### Current Types

```typescript
// types.ts
type PeerDocumentAwareness =
  | { awareness: "unknown"; lastUpdated: Date }
  | { awareness: "no-doc"; lastUpdated: Date }
  | { awareness: "has-doc-unknown-version"; lastUpdated: Date }
  | { awareness: "has-doc"; lastKnownVersion: VersionVector; lastUpdated: Date }

type ReadyState = ReadyStateAware | ReadyStateLoaded | ReadyStateAbsent
// where state: "aware" | "loaded" | "absent"

type PeerState = {
  identity: PeerIdentityDetails
  documentAwareness: Map<DocId, PeerDocumentAwareness>
  subscriptions: Set<DocId>
  lastSeen: Date
  channels: Set<ChannelId>
}
```

### The Bug (Fixed, But Naming Still Confusing)

In `handle-sync-request.ts`, receiving a sync-request was setting `"has-doc"` which mapped to `ReadyState.state = "loaded"`, causing `waitForSync()` to resolve prematurely. The fix changed it to `"has-doc-unknown-version"` → `"aware"`, but the names are still confusing.

### Semantic Issues

| Current Name | What It Sounds Like | What It Actually Means |
|--------------|---------------------|------------------------|
| `"has-doc"` | Peer has the document | Sync handshake complete, we know their version |
| `"has-doc-unknown-version"` | Peer has doc, version unknown | Sync pending (awaiting their response) |
| `"aware"` | We're aware of something | Sync not complete, waitForSync waits |
| `"loaded"` | Document is loaded locally | Sync complete, waitForSync resolves |

## The Gap

The naming doesn't match the semantics. Developers reading the code can't intuit what these states mean or when `waitForSync()` should resolve. The `lastUpdated` field is never read anywhere in the codebase.

## Proposed Changes

### New Types

```typescript
// types.ts
type PeerDocSyncState = 
  | { status: "unknown" }
  | { status: "pending" }
  | { status: "synced"; version: VersionVector }
  | { status: "absent" }

type ReadyState = {
  docId: DocId
  identity: PeerIdentityDetails
  channels: ReadyStateChannelMeta[]
  status: "pending" | "synced" | "absent"  // renamed from "state"
}

type PeerState = {
  identity: PeerIdentityDetails
  docSyncStates: Map<DocId, PeerDocSyncState>  // renamed from documentAwareness
  subscriptions: Set<DocId>
  lastSeen: Date
  channels: Set<ChannelId>
}
```

### Mapping

| Old | New |
|-----|-----|
| `awareness: "unknown"` | `status: "unknown"` |
| `awareness: "has-doc-unknown-version"` | `status: "pending"` |
| `awareness: "has-doc"` | `status: "synced"` |
| `awareness: "no-doc"` | `status: "absent"` |
| `state: "aware"` | `status: "pending"` |
| `state: "loaded"` | `status: "synced"` |
| `state: "absent"` | `status: "absent"` |
| `documentAwareness` | `docSyncStates` |
| `lastUpdated` | (removed) |

## Success Criteria

1. All tests pass after refactoring
2. No functional behavior changes (this is a pure rename/restructure)
3. Code is self-documenting: reading `status: "pending"` clearly indicates waiting
4. `waitForSync()` logic is obvious: resolves when `status !== "pending"`
5. No unused fields (`lastUpdated` removed)

## Dependency Analysis

### Tier 1: Core Type Definitions
Files that define the types being changed:

- `packages/repo/src/types.ts` - Defines `PeerDocumentAwareness`, `PeerState`, `ReadyState`

### Tier 2: Direct Type Consumers
Files that import and use these types directly:

- `packages/repo/src/synchronizer/peer-state-helpers.ts` - `setPeerDocumentAwareness()`, `shouldSyncWithPeer()`, `getPeersWithDocument()`, `ensurePeerState()`
- `packages/repo/src/synchronizer/state-helpers.ts` - `getReadyStates()` - converts `documentAwareness` → `ReadyState`
- `packages/repo/src/synchronizer/test-utils.ts` - `createKnownPeerState()` helper

### Tier 3: Handlers That Set State
Files that call `setPeerDocumentAwareness()`:

- `packages/repo/src/synchronizer/sync/handle-sync-request.ts` - Sets `"has-doc-unknown-version"` → `"pending"`
- `packages/repo/src/synchronizer/sync/utils.ts` - Sets `"has-doc"` or `"no-doc"` → `"synced"` or `"absent"`
- `packages/repo/src/synchronizer/sync/handle-doc-imported.ts` - Sets `"has-doc"` → `"synced"`
- `packages/repo/src/synchronizer/sync/propagate-to-peers.ts` - Sets `"has-doc"` → `"synced"`
- `packages/repo/src/synchronizer/discovery/handle-new-doc.ts` - Sets `"has-doc-unknown-version"` → `"pending"`
- `packages/repo/src/synchronizer/discovery/handle-directory-response.ts` - Sets `"has-doc-unknown-version"` → `"pending"`

### Tier 4: Handlers That Read State
Files that read `documentAwareness` or check `.awareness`:

- `packages/repo/src/synchronizer/sync/propagate-to-peers.ts` - Reads `peerAwareness?.awareness`
- `packages/repo/src/synchronizer/utils.ts` - Reads `peerAwareness?.awareness` in `getAllDocsToSync()`
- `packages/repo/src/synchronizer/connection/handle-channel-removed.ts` - Iterates `documentAwareness.keys()`

### Tier 5: ReadyState Consumers
Files that use `ReadyState` or check `.state`:

- `packages/repo/src/handle.ts` - `waitForSync()`, `readyStates` getter, `onReadyStateChange()`
- `packages/repo/src/synchronizer.ts` - `readyStates` Map, `getReadyStates()`, `waitUntilReady()`
- `packages/repo/src/synchronizer/command-executor.ts` - Emits `ready-state-changed` event

### Tier 6: Test Files (37 files)
All test files that create `PeerState` objects with `documentAwareness: new Map()` or check `.awareness`:

- `packages/repo/src/synchronizer/sync/handle-sync-response.test.ts`
- `packages/repo/src/synchronizer/sync/handle-sync-request.test.ts`
- `packages/repo/src/synchronizer/sync/handle-local-doc-change.test.ts`
- `packages/repo/src/synchronizer/sync/handle-doc-ensure.test.ts`
- `packages/repo/src/synchronizer/discovery/handle-new-doc.test.ts`
- `packages/repo/src/synchronizer/discovery/handle-directory-response.test.ts`
- `packages/repo/src/synchronizer/discovery/handle-directory-request.test.ts`
- `packages/repo/src/synchronizer/connection/handle-channel-removed.test.ts`
- `packages/repo/src/synchronizer/channel-dispatcher.test.ts`
- `packages/repo/src/synchronizer/middleware-processor.test.ts`
- `packages/repo/src/synchronizer/command-handlers/handle-remove-ephemeral-peer.test.ts`
- `packages/repo/src/tests/synchronizer-program.test.ts`
- `packages/repo/src/tests/synchronizer-echo.test.ts`
- `packages/repo/src/tests/synchronizer-permissions-edge-cases.test.ts`
- `packages/repo/src/tests/synchronizer-event-emission.test.ts`
- `packages/repo/src/tests/handle.test.ts`
- `packages/repo/src/tests/wait-for-network-timing.test.ts`

### Tier 7: Public API / Exports
Files that re-export types:

- `packages/repo/src/index.ts` - Exports from `types.ts`
- `packages/repo/src/synchronizer/index.ts` - Exports `setPeerDocumentAwareness`

## Execution Plan

### Phase 1: Update Core Types
1. [ ] Update `types.ts`:
   - Rename `PeerDocumentAwareness` → `PeerDocSyncState`
   - Change discriminant from `awareness` → `status`
   - Rename values: `"has-doc"` → `"synced"`, `"has-doc-unknown-version"` → `"pending"`, `"no-doc"` → `"absent"`
   - Remove `lastUpdated` field
   - Rename `PeerState.documentAwareness` → `PeerState.docSyncStates`
   - Update `ReadyState` to use `status` instead of `state`
   - Remove `ReadyStateAware`, `ReadyStateLoaded`, `ReadyStateAbsent` intermediate types (simplify to single type with union status)

### Phase 2: Update Helper Functions
2. [ ] Update `peer-state-helpers.ts`:
   - Rename `setPeerDocumentAwareness` → `setPeerDocSyncState`
   - Update function signatures and implementations
   - Update `shouldSyncWithPeer()` to use new status names
   - Update `getPeersWithDocument()` to use new status names
   - Update `ensurePeerState()` to use `docSyncStates`

3. [ ] Update `state-helpers.ts`:
   - Update `getReadyStates()` to use new field/status names
   - Map `"pending"` → `status: "pending"`, `"synced"` → `status: "synced"`, etc.

4. [ ] Update `test-utils.ts`:
   - Update `createKnownPeerState()` to use new types

### Phase 3: Update Handlers (State Setters)
5. [ ] Update `handle-sync-request.ts`: Change `"has-doc-unknown-version"` → `"pending"`
6. [ ] Update `sync/utils.ts`: Change `"has-doc"` → `"synced"`, `"no-doc"` → `"absent"`
7. [ ] Update `handle-doc-imported.ts`: Change `"has-doc"` → `"synced"`
8. [ ] Update `propagate-to-peers.ts`: Change awareness checks and sets
9. [ ] Update `handle-new-doc.ts`: Change `"has-doc-unknown-version"` → `"pending"`
10. [ ] Update `handle-directory-response.ts`: Change `"has-doc-unknown-version"` → `"pending"`

### Phase 4: Update Handlers (State Readers)
11. [ ] Update `propagate-to-peers.ts`: Update all `.awareness` checks to `.status`
12. [ ] Update `synchronizer/utils.ts`: Update `getAllDocsToSync()` awareness checks
13. [ ] Update `handle-channel-removed.ts`: Update `documentAwareness` → `docSyncStates`

### Phase 5: Update ReadyState Consumers
14. [ ] Update `handle.ts`: Change `.state` checks to `.status`
15. [ ] Update `synchronizer.ts`: Update ReadyState usage
16. [ ] Update `command-executor.ts`: Update event types if needed

### Phase 6: Update Exports
17. [ ] Update `synchronizer/index.ts`: Rename exported function
18. [ ] Update `index.ts`: Ensure new type names are exported

### Phase 7: Update Tests
19. [ ] Update all test files to use new type/field names
    - Change `documentAwareness: new Map()` → `docSyncStates: new Map()`
    - Change `.awareness` checks → `.status` checks
    - Change `"has-doc"` → `"synced"`, etc.
    - Change `state: "loaded"` → `status: "synced"`, etc.

### Phase 8: Verify
20. [ ] Run `pnpm --filter @loro-extended/repo test` to verify all tests pass
21. [ ] Run `pnpm test` to verify no cross-package breakage

## Risks and Mitigations

### Risk: Breaking External Consumers
`ReadyState` is a public type exported from `@loro-extended/repo`. Changing `state` → `status` is a breaking change.

**Mitigation**: This is acceptable as the package is pre-1.0. Document in CHANGELOG.

### Risk: Missing a Reference
With 137 references across 37+ files, it's easy to miss one.

**Mitigation**: 
- TypeScript will catch type mismatches
- Run full test suite after each phase
- Use IDE "Find All References" before deleting old names

### Risk: Subtle Behavior Change
The refactor should be purely cosmetic, but there's risk of accidentally changing behavior.

**Mitigation**:
- No logic changes, only renames
- Tests should catch any behavioral regression
