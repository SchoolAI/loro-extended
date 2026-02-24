# Plan: Fix @loro-extended/repo Tests for v6 API

## Background

The v6 release of loro-extended introduced a unified method-based API for reading and writing plain values. The core principle is:

1. **Traversal** — Dot notation for schema paths, `.get()` for dynamic/indexed access
2. **Read/Write** — Method notation (`.get()`, `.set()`, etc.) — never assignment or property getters
3. **Uniform** — Same API inside and outside `change()` blocks

The `@loro-extended/repo` package tests were not updated to reflect these changes, causing both **type errors** (26 total) and **runtime failures** (12 tests fail with `TypeError: Cannot redefine property`).

## Problem Statement

The repo package tests use outdated v5 patterns:

1. **Property assignment inside `change()`**: `draft.data.title = "My Document"` instead of `draft.data.title.set("My Document")`
2. **CounterRef `.value` property access**: `doc.counter.value` instead of `doc.counter.get()`
3. **Union type access without narrowing**: `message.bidirectional` on `ChannelMsgSyncRequest | ChannelMsgSyncResponse` without type guard

These patterns fail both at the type level and at runtime because:
- StructRef proxy has no `set` trap — assignments silently fail to update the CRDT
- DocRef uses `Object.defineProperty` with getter-only — assignments throw `TypeError: Cannot redefine property`
- `bidirectional` only exists on `ChannelMsgSyncRequest`, not `ChannelMsgSyncResponse`

## Success Criteria

1. `pnpm turbo run verify --filter=@loro-extended/repo -- types` passes (0 type errors)
2. `pnpm turbo run verify --filter=@loro-extended/repo -- logic` passes (0 test failures)
3. All tests use the v6 method-based API consistently
4. TECHNICAL.md updated to remove misleading doc comments about draft mode

## The Gap

| File | Error Count | Issue |
|------|-------------|-------|
| `e2e.test.ts` | 3 type, 1 runtime | `draft.data.title = "..."` assignment |
| `fork-and-merge-sync.test.ts` | 4 type + 9 type, 5 runtime | `draft.data.value = "..."` + `counter.value` |
| `handle-subscribe.test.ts` | 8 type, 6 runtime | `draft.config.theme = "..."` assignment |
| `storage-first-sync.test.ts` | 2 type, 0 runtime | `message.bidirectional` union access |

## Phases and Tasks

### Phase 1: Fix PlainValueRef Assignment Pattern ✅

Update tests to use `.set()` instead of property assignment.

- ✅ **Task 1.1**: Fix `e2e.test.ts` (3 locations)
  - Line 289: `draft.data.title = "My Document"` → `draft.data.title.set("My Document")`
  - Line 290: `draft.data.content = "This should persist"` → `draft.data.content.set("This should persist")`
  - Line 291: `draft.data.count = 42` → `draft.data.count.set(42)`

- ✅ **Task 1.2**: Fix `fork-and-merge-sync.test.ts` (4 locations)
  - Line 102: `draft.data.value = msg.value` → `draft.data.value.set(msg.value)`
  - Line 130: `draft.data.value = msg.value` → `draft.data.value.set(msg.value)`
  - Line 187: `draft.data.value = msg.value` → `draft.data.value.set(msg.value)`
  - Line 226: `draft.data.value = msg.value` → `draft.data.value.set(msg.value)`

- ✅ **Task 1.3**: Fix `handle-subscribe.test.ts` (8 locations)
  - Line 47: `draft.config.theme = "dark"` → `draft.config.theme.set("dark")`
  - Line 60: `draft.config.theme = "light"` → `draft.config.theme.set("light")`
  - Line 87: `draft.config.theme = "dark"` → `draft.config.theme.set("dark")`
  - Line 262: `draft.config.theme = "dark"` → `draft.config.theme.set("dark")`
  - Line 361: `draft.config.theme = "dark"` → `draft.config.theme.set("dark")`
  - Line 390: `draft.config.theme = "dark"` → `draft.config.theme.set("dark")`
  - Line 416: `draft.config.theme = "dark"` → `draft.config.theme.set("dark")`
  - Line 426: `draft.config.theme = "light"` → `draft.config.theme.set("light")`

### Phase 2: Fix CounterRef.value Access ✅

Update tests to use `.get()` instead of `.value` property.

- ✅ **Task 2.1**: Fix `fork-and-merge-sync.test.ts` (9 locations)
  - Line 117: `doc2.counter.value` → `doc2.counter.get()`
  - Line 142: `doc.counter.value` → `doc.counter.get()`
  - Line 149: `doc.counter.value` → `doc.counter.get()`
  - Line 157: `doc.counter.value` → `doc.counter.get()`
  - Line 164: `doc.counter.value` → `doc.counter.get()`
  - Line 171: `doc.counter.value` → `doc.counter.get()`
  - Line 243: `doc2.counter.value` → `doc2.counter.get()`
  - Line 285: `doc1.counter.value` → `doc1.counter.get()`
  - Line 286: `doc2.counter.value` → `doc2.counter.get()`

### Phase 3: Fix Union Type Narrowing ✅

Update tests to properly narrow union types before property access.

- ✅ **Task 3.1**: Fix `storage-first-sync.test.ts` (2 locations)
  - Line 304: Add type assertion `(networkSyncRequests[0].message as ChannelMsgSyncRequest).bidirectional`
  - Line 383: Add type assertion `(networkSyncRequests[0].message as ChannelMsgSyncRequest).bidirectional`

### Phase 4: Documentation Cleanup ✅

Remove misleading comments about draft mode supporting plain types.

- ✅ **Task 4.1**: Update `packages/change/src/typed-refs/struct-ref.ts`
  - Lines 204-206: Remove or correct the doc comment that says `"draft": Properties return plain T`
  - The correct behavior is: draft properties return `PlainValueRef<T>`, same as mutable mode

- ✅ **Task 4.2**: Update `packages/change/TECHNICAL.md`
  - Item 9 in Gotchas already correctly states: "The `_draft` shape parameter equals `_mutable`"
  - Verify consistency with this statement

### Phase 5: Verification ✅

- ✅ **Task 5.1**: Run type verification
  ```bash
  pnpm turbo run verify --filter=@loro-extended/repo -- types
  ```
  Expected: 0 type errors

- ✅ **Task 5.2**: Run logic verification
  ```bash
  pnpm turbo run verify --filter=@loro-extended/repo -- logic
  ```
  Expected: All 727 tests pass

- ✅ **Task 5.3**: Run full verification
  ```bash
  pnpm turbo run verify --filter=@loro-extended/repo
  ```
  Expected: All checks pass (format, types, logic)

## Tests

No new tests required — this plan fixes existing tests to use the correct API.

## Transitive Effect Analysis

| Change | Direct Impact | Transitive Impact |
|--------|---------------|-------------------|
| Test file fixes | `@loro-extended/repo` tests pass | None — test-only changes |
| StructRef doc comment fix | Developer understanding | Future test/code will use correct patterns |
| TECHNICAL.md consistency | Documentation accuracy | Developer onboarding |

**Risk**: None. Changes are isolated to test files and documentation. No runtime code changes.

## Resources for Implementation

### Files to Modify

```
packages/repo/src/tests/e2e.test.ts
packages/repo/src/tests/fork-and-merge-sync.test.ts
packages/repo/src/tests/handle-subscribe.test.ts
packages/repo/src/tests/storage-first-sync.test.ts
packages/change/src/typed-refs/struct-ref.ts (doc comment only)
```

### Reference Files

```
packages/change/TECHNICAL.md (Gotcha #9 confirms draft = mutable)
packages/change/src/shape.ts (StringValueShape line 332-334 shows draft = PlainValueRef)
packages/change/src/typed-refs/struct-ref.ts (line 109-114 confirms no setter support)
```

### Correct API Patterns

```typescript
// Inside change() — use .set() for plain values
change(doc, draft => {
  draft.data.title.set("New Title")
  draft.data.count.set(42)
  draft.config.theme.set("dark")
})

// CounterRef — use .get() not .value
expect(doc.counter.get()).toBe(1)

// Type narrowing for union access
const msg = networkSyncRequests[0].message as ChannelMsgSyncRequest
expect(msg.bidirectional).toBe(false)
```

## Changeset

Not required — these are test-only fixes that don't affect the public API.

## README Updates

None required — tests are internal.

## TECHNICAL.md Updates

- `packages/repo/TECHNICAL.md`: No changes needed (already accurate)
- `packages/change/src/typed-refs/struct-ref.ts`: Fix doc comment that incorrectly states draft returns plain `T`

## Other Documentation

None required.