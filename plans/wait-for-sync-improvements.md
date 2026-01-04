# Plan: waitForSync Improvements

**Status: ✅ COMPLETE**

## Problem Statement

The `waitForNetwork()` and `waitForStorage()` methods on `Handle` have several issues:

1. **`waitForStorage()` has the same bug as `waitForNetwork()` had** - it only checks for `state === "loaded"`, so it hangs forever when storage responds with "unavailable"

2. **The "absent" channel lookup is awkward** - `ReadyStateAbsent` doesn't include `channels`, forcing ugly workarounds to check if a peer has network/storage channels

3. **Confusing method names** - `waitForNetwork()` sounds like "wait for network availability" but actually means "wait for sync completion with a network peer"

4. **No validation** - If no network/storage adapters are configured, the methods hang forever with no indication of the problem

5. **No timeout** - Methods can hang indefinitely if adapters never respond

6. **Test utility not reusable** - The `DelayedNetworkAdapter` created for testing is useful but not extracted

## Background

The `waitForNetwork()` method was fixed to accept both `state === "loaded"` (peer has data) and `state === "absent"` (peer confirmed no data). This enables the common "initializeIfEmpty" pattern:

```typescript
await handle.waitForNetwork()
if (handle.loroDoc.opCount() === 0) {
  initializeDocument(handle)
}
```

The fix required awkward code to check channels for "absent" states because `ReadyStateAbsent` doesn't include the `channels` property.

## The Gap

1. `waitForStorage()` still has the original bug
2. Type system doesn't support clean channel checking for absent states
3. API naming is confusing
4. No guardrails for misconfiguration or timeouts
5. Test utilities are not reusable

## Success Criteria

1. ✅ `waitForStorage()` resolves when storage confirms "unavailable"
2. ✅ `ReadyStateAbsent` includes `channels` property
3. ✅ New `waitForSync(kind)` method with clear semantics
4. ✅ `waitForNetwork()` and `waitForStorage()` marked `@deprecated`
5. ✅ Error thrown if waiting for a kind with no adapters of that kind
6. ✅ Optional timeout (default 30s) with clear error message
7. ✅ `DelayedNetworkAdapter` extracted as test utility
8. ✅ All existing tests pass
9. ✅ New tests cover all new functionality

## Dependency Analysis

### Direct Dependencies

| File | Change | Impact |
|------|--------|--------|
| [`types.ts`](../packages/repo/src/types.ts) | Add `channels` to `ReadyStateAbsent` | Type change affects all consumers |
| [`state-helpers.ts`](../packages/repo/src/synchronizer/state-helpers.ts) | Populate `channels` for absent states | Must match new type |
| [`handle.ts`](../packages/repo/src/handle.ts) | New `waitForSync()`, deprecate old methods | Public API change |

### Transitive Dependencies

| Consumer | Depends On | Impact |
|----------|------------|--------|
| [`synchronizer.ts`](../packages/repo/src/synchronizer.ts) | `ReadyState` type | Uses `getReadyStates()`, no code change needed |
| [`command-executor.ts`](../packages/repo/src/synchronizer/command-executor.ts) | `ReadyState` type | Event emission, no code change needed |
| [`handle.test.ts`](../packages/repo/src/tests/handle.test.ts) | `onReadyStateChange` | May need test updates if checking absent states |
| [`synchronizer-event-emission.test.ts`](../packages/repo/src/tests/synchronizer-event-emission.test.ts) | `getReadyStates()` | May need test updates |

### Risk Assessment

- **Low risk**: Adding `channels` to `ReadyStateAbsent` is additive - existing code that doesn't use it won't break
- **Low risk**: Deprecating methods doesn't break existing code
- **Medium risk**: Timeout behavior could break tests that rely on infinite waits (unlikely)

## Implementation Plan

### Phase 1: Type System Fix

1. Update `ReadyStateAbsent` in [`types.ts`](../packages/repo/src/types.ts:44-46) to include `channels`:
   ```typescript
   type ReadyStateAbsent = ReadyStateBase & {
     state: "absent"
     channels: ReadyStateChannelMeta[]
   }
   ```

2. Update [`state-helpers.ts`](../packages/repo/src/synchronizer/state-helpers.ts:83-88) to populate channels for absent states

### Phase 2: Prove `waitForStorage()` Bug

1. Add failing test in [`wait-for-network-timing.test.ts`](../packages/repo/src/tests/wait-for-network-timing.test.ts) for storage "unavailable" case

### Phase 3: New `waitForSync()` API

1. Add new method to [`handle.ts`](../packages/repo/src/handle.ts):
   ```typescript
   async waitForSync(options?: {
     kind?: "network" | "storage"  // default: "network"
     timeout?: number              // default: 30_000 ms
   }): Promise<Handle<D, E>>
   ```

2. Implementation:
   - Check if any adapters of the requested kind exist, throw if not
   - Use `Promise.race()` with timeout
   - Throw `TimeoutError` with clear message on timeout
   - Accept both "loaded" and "absent" states (simplified with new type)

3. Mark `waitForNetwork()` and `waitForStorage()` as `@deprecated`

### Phase 4: Extract Test Utility

1. Create [`packages/repo/src/adapter/delayed-network-adapter.ts`](../packages/repo/src/adapter/delayed-network-adapter.ts)
2. Export from [`packages/repo/src/index.ts`](../packages/repo/src/index.ts) under test utilities
3. Update test to import from new location

### Phase 5: Comprehensive Tests

1. Test `waitForSync({ kind: "network" })` with data
2. Test `waitForSync({ kind: "network" })` with unavailable
3. Test `waitForSync({ kind: "storage" })` with data
4. Test `waitForSync({ kind: "storage" })` with unavailable
5. Test timeout behavior
6. Test error when no adapters of requested kind
7. Test deprecated methods still work

## Files Modified

1. `packages/repo/src/types.ts` - Add channels to ReadyStateAbsent
2. `packages/repo/src/synchronizer/state-helpers.ts` - Populate channels for absent
3. `packages/repo/src/handle.ts` - New waitForSync with AbortSignal support, deprecate old methods
4. `packages/repo/src/tests/wait-for-network-timing.test.ts` - Comprehensive tests (13 tests)
5. `packages/repo/src/adapter/delayed-network-adapter.ts` - New test utility
6. `packages/repo/src/index.ts` - Export test utility
7. `packages/repo/src/utils/with-timeout.ts` - New utility for timeout with cleanup
8. `packages/repo/src/utils/with-timeout.test.ts` - Tests for timeout utility (9 tests)
9. `packages/repo/src/channel.ts` - Add GeneratedChannelActions type
10. `packages/repo/src/adapter/adapter.ts` - Add `kind` property to Adapter base class
11. `packages/repo/src/storage/storage-adapter.ts` - Override `kind` to "storage"

## Additional Improvements

### Adapter Kind Refactoring

The original implementation had a design smell: adapters didn't have a `kind` property - only channels did. This caused race conditions in `waitForSync()` because we couldn't check if a network adapter was configured until it generated a channel.

**Fix**: Added `kind` property to `Adapter` base class:
- Default is `"network"` for regular adapters
- `StorageAdapter` overrides to `"storage"`
- `waitForSync()` now checks adapter kind directly, eliminating race conditions

### withTimeout Utility

Extracted timeout logic into a reusable utility that:
- Properly cleans up timers to avoid unhandled rejections
- Supports AbortSignal for cancellation
- Handles timeout=0 (infinite wait) correctly

### Error Context

Enhanced error classes with additional context:
- `SyncTimeoutError` now includes `docId` and `lastSeenStates`
- `NoAdaptersError` now includes `docId`
