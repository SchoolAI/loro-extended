# Plan: Typed Ref Caching Cleanup

## Problem Statement

The recent stale cache bug fix introduced inconsistencies in how value shapes are cached across different typed ref implementations. Additionally, there is dead code related to a `readonly` flag that is never used, and test file annotations that need cleanup.

## Background

### Current State After Stale Cache Fix

Three typed ref classes handle value shape caching differently:

| Class | Caching Strategy | Flag Used |
|-------|------------------|-----------|
| `RecordRef` | Never cache value shapes | None |
| `StructRef` | Cache when `autoCommit=false` | `autoCommit` |
| `ListRefBase` | Cache when `autoCommit=false` | `autoCommit` |

### The `autoCommit` Overloading Problem

The `autoCommit` flag was designed to control automatic commit behavior:
- `autoCommit: true` → Mutations auto-commit to LoroDoc
- `autoCommit: false` → Mutations batch until explicit commit

It's now also used to determine caching behavior:
- `autoCommit: true` → Don't cache value shapes (read fresh)
- `autoCommit: false` → Cache value shapes (for find-and-mutate patterns)

This dual purpose creates semantic confusion and potential bugs if someone uses `autoCommit: false` for manual commit control without expecting caching behavior.

### The `readonly` Flag is Dead Code

**Discovery**: The `readonly` flag is **never set to `true` anywhere in the codebase**.

- `readonly?: boolean` is defined in `TypedRefParams`
- `this.readonly` returns `!!this._params.readonly` which is always `false` (since `!!undefined === false`)
- All `if (this.readonly)` branches are **dead code** that never executes

Dead code locations:
- [`base.ts:63-66`](packages/change/src/typed-refs/base.ts:63) - `assertMutable()` never throws
- [`struct.ts:132-140`](packages/change/src/typed-refs/struct.ts:132) - placeholder fallback never executes
- [`struct.ts:173-178`](packages/change/src/typed-refs/struct.ts:173) - `toJSON()` fast path never executes
- [`list-base.ts:203-208`](packages/change/src/typed-refs/list-base.ts:203) - `unwrapReadonlyPrimitive()` never executes
- [`record.ts:128-133`](packages/change/src/typed-refs/record.ts:128) - `unwrapReadonlyPrimitive()` never executes
- [`record.ts:193-209`](packages/change/src/typed-refs/record.ts:193) - `toJSON()` fast path never executes
- [`doc.ts:77-86`](packages/change/src/typed-refs/doc.ts:77) - placeholder fallback never executes
- [`doc.ts:95-96`](packages/change/src/typed-refs/doc.ts:95) - `unwrapReadonlyPrimitive()` never executes

## The Gap

1. **Inconsistent caching strategies** - RecordRef uses "never cache" while StructRef/ListRefBase use conditional caching
2. **Overloaded flag semantics** - `autoCommit` now means two different things
3. **Dead code** - `readonly` flag and all related code paths are never executed
4. **Test file clutter** - Test files may still have "FAILS" annotations from before the fix

## Success Criteria

1. **Unified caching strategy** - All three classes (RecordRef, StructRef, ListRefBase) use the same approach
2. **Dedicated flag for batched mutation** - New `batchedMutation` flag with clear semantics
3. **No dead code** - Remove `readonly` flag and all related dead code
4. **Clean test files** - No stale "FAILS" annotations in test files

## Dependency Analysis

### Direct Dependencies

```
TypedRefParams (base.ts)
  └── Used by: DocRef, RecordRef, StructRef, ListRefBase, TreeRef, TreeNodeRef
```

Removing `readonly` from `TypedRefParams` affects all typed ref classes.

### Transitive Dependencies

```
TypedRefParams change
  └── DocRef (creates refs with params)
        └── TypedDocInternal (creates DocRef)
              └── createTypedDoc() (public API)
                    └── All user code
```

### Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Add `batchedMutation` flag | Low | Additive change, backward compatible |
| Remove `readonly` flag | Low | Dead code removal - no behavior change |
| Remove `readonly` code paths | Low | Dead code - never executed |
| Update RecordRef to use new flag | Low | Same pattern as StructRef/ListRefBase |
| Clean test annotations | None | Comment-only change |

## Implementation Plan

### Phase 1: Add `batchedMutation` Flag

**File**: `packages/change/src/typed-refs/base.ts`

Add new flag to `TypedRefParams` and remove `readonly`:
```typescript
export type TypedRefParams<Shape extends DocShape | ContainerShape> = {
  shape: Shape
  placeholder?: Infer<Shape>
  getContainer: () => ShapeToContainer<Shape>
  autoCommit?: boolean
  batchedMutation?: boolean // True when inside change() block
  getDoc?: () => LoroDoc
}
```

Add getter and remove `readonly` getter and `assertMutable()`:
```typescript
protected get batchedMutation(): boolean {
  return !!this._params.batchedMutation
}
// Remove: readonly getter
// Remove: assertMutable() method
```

### Phase 2: Remove `readonly` from Child Ref Creation

**Files**:
- `packages/change/src/typed-refs/doc.ts` - Remove `readonly: this.readonly`
- `packages/change/src/typed-refs/struct.ts` - Remove `readonly: this.readonly`
- `packages/change/src/typed-refs/record.ts` - Remove `readonly: this.readonly`
- `packages/change/src/typed-refs/list-base.ts` - Remove `readonly: this.readonly`
- `packages/change/src/typed-refs/tree.ts` - Remove `readonly: this.readonly`

Add `batchedMutation: this.batchedMutation` to propagate the new flag.

### Phase 3: Remove Dead `readonly` Code Paths

**Files**:
- `packages/change/src/typed-refs/struct.ts` - Remove `if (this.readonly)` blocks
- `packages/change/src/typed-refs/list-base.ts` - Remove `if (this.readonly)` block
- `packages/change/src/typed-refs/record.ts` - Remove `if (this.readonly)` blocks
- `packages/change/src/typed-refs/doc.ts` - Remove `if (this.readonly)` blocks
- `packages/change/src/typed-refs/tree.ts` - Remove `assertMutable()` override

### Phase 4: Update Caching Logic

**Files**:
- `packages/change/src/typed-refs/struct.ts` - Use `batchedMutation` instead of `!autoCommit`
- `packages/change/src/typed-refs/list-base.ts` - Use `batchedMutation` instead of `!autoCommit`
- `packages/change/src/typed-refs/record.ts` - Add conditional caching using `batchedMutation`

### Phase 5: Update TypedDoc to Pass Flag

**File**: `packages/change/src/typed-doc.ts`

In `change()` method, pass `batchedMutation: true` when creating the draft DocRef.

### Phase 6: Clean Test Files

**Files**:
- `packages/change/src/typed-refs/struct-value-updates.test.ts`
- `packages/change/src/typed-refs/list-value-updates.test.ts`
- `packages/change/src/typed-refs/tree-node-value-updates.test.ts`

Remove any "FAILS" or "EXPECTED TO FAIL" annotations.

## Checklist

- [x] Add `batchedMutation` flag to `TypedRefParams` in base.ts
- [x] Add `batchedMutation` getter to `TypedRef` base class
- [x] Remove `readonly` flag from `TypedRefParams`
- [x] Remove `readonly` getter from `TypedRef` base class
- [x] Remove `assertMutable()` method from `TypedRef` base class
- [x] Remove `assertMutable()` override from `TreeRef`
- [x] Remove `readonly: this.readonly` from all `getTypedRefParams()` methods
- [x] Add `batchedMutation: this.batchedMutation` to all `getTypedRefParams()` methods
- [x] Remove all `if (this.readonly)` dead code blocks
- [x] Remove all `this.assertMutable()` calls
- [x] Update `TypedDocInternal.change()` to pass `batchedMutation: true`
- [x] Update `StructRef.getOrCreateRef()` to use `batchedMutation` instead of `!autoCommit`
- [x] Update `ListRefBase.getMutableItem()` to use `batchedMutation` instead of `!autoCommit`
- [x] Update `RecordRef.getOrCreateRef()` to use conditional caching with `batchedMutation`
- [x] Clean up test file comments (remove "FAILS" annotations) - N/A, no annotations found
- [x] Run full test suite to verify no regressions - 434/434 tests pass
