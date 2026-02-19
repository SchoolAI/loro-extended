# Plan: Remove absorbPlainValues() Vestigial Code

## Background

The `absorbPlainValues()` method was originally designed to batch plain value mutations during `change()` blocks and write them to Loro containers at the end of the transaction. However, the recent RefMode refactor (commit `ouulnkxo`) introduced **eager write-back** via `PlainValueRef`, which immediately persists mutations to Loro containers through `writeValue()` and `writeListValue()`.

The comments in the current codebase explicitly acknowledge this shift:

> "Value shapes now use PlainValueRef with eager write-back, so we only need to recurse into container children"
> — `struct-ref-internals.ts`, `record-ref-internals.ts`, `list-ref-base.ts`

> "This ensures that nested mutations are immediately persisted to Loro, rather than relying on lazy absorption via absorbPlainValues()."
> — `value-writer.ts`

Despite eager writes being the reality, the `absorbPlainValues()` method and its call sites remain, creating cognitive overhead and dead code paths.

## Problem Statement

1. **Misleading naming**: `absorbPlainValues()` implies deferred absorption, but all plain values are already written eagerly
2. **Dead code**: The `absorbCachedPlainValues()` utility has a branch for writing plain values to containers that can never execute (caches only store container refs)
3. **Cognitive load**: Developers must understand a defunct batching model to reason about the code
4. **Unnecessary interface**: `RefInternalsBase.absorbPlainValues()` is an abstract contract that no longer serves its stated purpose

However, `absorbPlainValues()` still performs one useful action: **clearing the `itemCache` in list refs** to prevent stale cache issues after `change()` blocks complete.

## Success Criteria

1. ✅ All 899+ tests pass
2. ✅ No runtime behavioral changes (eager writes continue to work)
3. ✅ `RefInternalsBase` interface simplified (no absorption method)
4. ✅ Dead code paths removed
5. ✅ Cache clearing logic preserved where needed (list refs)
6. ✅ Documentation updated to reflect current architecture

## The Gap

| Current State | Target State |
|---------------|--------------|
| `absorbPlainValues()` on all ref internals classes | Method removed entirely |
| `RefInternalsBase` requires `absorbPlainValues()` | Interface has no absorption requirement |
| `change()` and `changeRef()` call `absorbPlainValues()` | These call a new `finalizeTransaction()` method |
| `absorbCachedPlainValues()` utility with dead branch | Utility removed |
| `itemCache.clear()` inside `absorbPlainValues()` | `clearCache()` method on list refs, called by `finalizeTransaction()` |

## Phases and Tasks

### Phase 1: Add `finalizeTransaction()` Method ✅

The list refs need cache clearing after `change()` to prevent stale refs. Introduce a minimal `finalizeTransaction()` method.

- ✅ **Task 1.1**: Add optional `finalizeTransaction?(): void` to `RefInternalsBase` interface in `base.ts`
- ✅ **Task 1.2**: Implement `finalizeTransaction()` in `ListRefBaseInternals` (both files) to clear `itemCache`
- ✅ **Task 1.3**: Update `changeRef()` in `functional-helpers.ts` to call `finalizeTransaction?.()` instead of `absorbPlainValues()`
- ✅ **Task 1.4**: Update `TypedDocInternal.change()` in `typed-doc.ts` similarly

### Phase 2: Remove `absorbPlainValues()` from Internals Classes ✅

Remove the method from all ref internals implementations.

- ✅ **Task 2.1**: Remove from `StructRefInternals` in `struct-ref-internals.ts`
- ✅ **Task 2.2**: Remove from `DocRefInternals` in `doc-ref-internals.ts`
- ✅ **Task 2.3**: Remove from `RecordRefInternals` in `record-ref-internals.ts`
- ✅ **Task 2.4**: Remove from `ListRefBaseInternals` in `list-ref-base-internals.ts`
- ✅ **Task 2.5**: Remove from `ListRefBaseInternals` in `list-ref-base.ts`
- ✅ **Task 2.6**: Remove from `CounterRefInternals` in `counter-ref-internals.ts`
- ✅ **Task 2.7**: Remove from `TextRefInternals` in `text-ref-internals.ts`
- ✅ **Task 2.8**: Remove from `TreeRefInternals` in `tree-ref-internals.ts`
- ✅ **Task 2.9**: Remove from `TreeNodeRefInternals` in `tree-node-ref-internals.ts`

### Phase 3: Remove Interface and Utility Code ✅

- ✅ **Task 3.1**: Remove `absorbPlainValues(): void` from `RefInternalsBase` interface in `base.ts`
- ✅ **Task 3.2**: Remove `absorbCachedPlainValues()` utility function from `utils.ts`
- ✅ **Task 3.3**: Remove `hasInternalSymbol()` helper from `utils.ts` (only used by absorption utility)
- ✅ **Task 3.4**: Update comments in `base.ts` that reference `absorbPlainValues()`

### Phase 4: Update Tests and Documentation ✅

- ✅ **Task 4.1**: Update `encapsulation.test.ts` - remove test that checks for `absorbPlainValues` existence
- ✅ **Task 4.2**: Update `tree-node.test.ts` - rename/update the `absorbPlainValues` describe block
- ✅ **Task 4.3**: Update `list-ref-value-updates.test.ts` - update comments referencing `absorbPlainValues()`
- ✅ **Task 4.4**: Update `TECHNICAL.md` - remove `absorbPlainValues()` from Key Internal Methods table
- ✅ **Task 4.5**: Update `TECHNICAL.md` - update "Draft Creation for `change()`" section
- ✅ **Task 4.6**: Update `value-writer.ts` comment that references "lazy absorption via absorbPlainValues()"
- ✅ **Task 4.7**: Update `tree-node-ref.ts` comment about `absorbPlainValues()` uniformity
- ✅ **Task 4.8**: Create changeset documenting the removal

## Unit and Integration Tests

### Existing Tests (Verify Still Pass)

The existing test suite comprehensively covers the scenarios that `absorbPlainValues()` was designed for:

1. **`list-ref-value-updates.test.ts`**: Tests cache freshness after `change()` - must still pass after switching to `finalizeTransaction()`
2. **`tree-node.test.ts`**: Tests that tree node data persists correctly through `change()`
3. **`change.test.ts`**: Tests batched mutation patterns
4. **`functional-helpers.test.ts`**: Tests `changeRef()` behavior

### New Test

Add one test to verify the new `finalizeTransaction()` behavior:

```typescript
// In list-ref-value-updates.test.ts or a new file
describe("finalizeTransaction", () => {
  it("clears list itemCache after change() to prevent stale refs", () => {
    // This test already exists implicitly in "reads updated struct properties after modification"
    // The existing tests serve as regression tests for the cache clearing behavior
  })
})
```

No new tests required - existing tests cover the behavior. The refactor is primarily about removing dead code and renaming.

## Transitive Effect Analysis

### Direct Dependencies

| File | Change | Impact |
|------|--------|--------|
| `base.ts` | Interface change | All `*RefInternals` classes must update |
| `utils.ts` | Remove utility | Any caller must be updated |
| `functional-helpers.ts` | Change call site | None - implementation detail |
| `typed-doc.ts` | Change call site | None - implementation detail |

### Transitive Dependencies

1. **`@loro-extended/lens`**: Uses `change()` from `@loro-extended/change` - no direct use of `absorbPlainValues()` ✅ No impact
2. **`@loro-extended/repo`**: Uses `change()` and `createTypedDoc()` - no direct use of internals ✅ No impact
3. **`@loro-extended/hooks-core`**: Uses refs via public API - no direct use of internals ✅ No impact

### Risk Assessment

**Low Risk**: This is primarily a dead code removal. The only behavioral change is renaming the call site from `absorbPlainValues()` to `finalizeTransaction()`, and the actual work (cache clearing) remains identical.

## Resources for Implementation

### Files to Modify (in order)

1. `packages/change/src/typed-refs/base.ts` - Interface and comments
2. `packages/change/src/typed-refs/utils.ts` - Remove utility
3. `packages/change/src/typed-refs/struct-ref-internals.ts`
4. `packages/change/src/typed-refs/doc-ref-internals.ts`
5. `packages/change/src/typed-refs/record-ref-internals.ts`
6. `packages/change/src/typed-refs/list-ref-base-internals.ts`
7. `packages/change/src/typed-refs/list-ref-base.ts`
8. `packages/change/src/typed-refs/counter-ref-internals.ts`
9. `packages/change/src/typed-refs/text-ref-internals.ts`
10. `packages/change/src/typed-refs/tree-ref-internals.ts`
11. `packages/change/src/typed-refs/tree-node-ref-internals.ts`
12. `packages/change/src/typed-refs/tree-node-ref.ts` - Comment update
13. `packages/change/src/functional-helpers.ts` - Call site
14. `packages/change/src/typed-doc.ts` - Call site
15. `packages/change/src/plain-value-ref/value-writer.ts` - Comment update
16. `packages/change/src/typed-refs/encapsulation.test.ts`
17. `packages/change/src/typed-refs/tree-node.test.ts`
18. `packages/change/src/typed-refs/list-ref-value-updates.test.ts` - Comment update
19. `TECHNICAL.md`

### Key Type Signatures

```typescript
// New interface in base.ts
export interface RefInternalsBase {
  /** Force materialization of the container and its nested containers */
  materialize(): void
  /** Optional cleanup after change() completes (e.g., clear caches) */
  finalizeTransaction?(): void
}

// In functional-helpers.ts changeRef()
draftInternals.finalizeTransaction?.()

// In typed-doc.ts change()
draft[INTERNAL_SYMBOL].finalizeTransaction?.()
```

## Changeset

```markdown
---
"@loro-extended/change": patch
---

Remove vestigial `absorbPlainValues()` method

The `absorbPlainValues()` method was originally designed for deferred plain value writes during `change()` blocks. Since the PlainValueRef eager write-back refactor, all plain values are written immediately via `writeValue()` and `writeListValue()`.

This release removes the vestigial code:
- Removed `absorbPlainValues()` from all ref internals classes
- Removed `RefInternalsBase.absorbPlainValues()` interface requirement
- Removed `absorbCachedPlainValues()` utility function
- Added optional `finalizeTransaction()` for post-change cleanup (cache clearing)

**No behavioral changes** - this is a code cleanup only. All tests pass.
```

## Documentation Updates

### TECHNICAL.md Changes

1. Remove `absorbPlainValues()` row from "Key Internal Methods" table
2. Update "Draft Creation for `change()`" section:
   - Change step 4 from "Calling `absorbPlainValues()` to persist cached mutations" to "Calling `finalizeTransaction()` for cleanup (cache clearing)"
3. Update "Value Shape Handling" section to emphasize eager writes as the canonical pattern

### README.md

No changes needed - `absorbPlainValues()` was never part of the public API.