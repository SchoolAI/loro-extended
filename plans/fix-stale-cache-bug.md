# Plan: Fix Stale Cache Bug in Typed Refs

## Problem Statement

The `@loro-extended/change` package has a systemic bug where value shapes in container refs (`RecordRef`, `StructRef`, `ListRefBase`) return stale cached values when the underlying CRDT container is modified by a different ref instance (e.g., drafts created by `change()`).

**Symptoms:**

- `record.set("key", newValue)` appears to have no effect after the first write
- `struct.property = newValue` returns the old value on subsequent reads
- `list.get(index)` returns stale values after delete/insert operations
- `delete()` operations appear to not work

## Background

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  User Code                                                      │
│    doc.config.name = "value"  // Read via proxy                 │
│    change(doc, d => d.config.name = "new")  // Write via draft  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  TypedDoc Proxy (fixed target = original DocRef)                │
│    └── DocRef (propertyCache)                                   │
│          └── StructRef/RecordRef/ListRef (value caches)         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Loro CRDT Layer (single source of truth)                       │
│    LoroDoc → LoroMap/LoroList/LoroTree                          │
└─────────────────────────────────────────────────────────────────┘
```

### The Bug Mechanism

1. User reads `doc.config.name` → Original `StructRef` reads from container, **caches value**
2. User calls `change(doc, d => d.config.name = "new")` → Creates **new** draft `StructRef`, writes to container
3. User reads `doc.config.name` again → Original `StructRef` returns **stale cached value**

### Affected Components

| Component     | Cache           | Caches Values?       | Status       |
| ------------- | --------------- | -------------------- | ------------ |
| `RecordRef`   | `refCache`      | ~~Yes~~ No           | ✅ Fixed     |
| `StructRef`   | `propertyCache` | **Yes**              | ⚠️ Needs fix |
| `ListRefBase` | `itemCache`     | **Yes**              | ⚠️ Needs fix |
| `DocRef`      | `propertyCache` | No (containers only) | ✅ Safe      |
| `TreeRef`     | `nodeCache`     | No (nodes only)      | ✅ Safe      |
| `TreeNodeRef` | `_dataRef`      | Via StructRef        | ⚠️ Inherited |

### Test Evidence

- `record-value-updates.test.ts`: 10 tests, all passing after fix
- `struct-value-updates.test.ts`: 8 tests, **6 failing**
- `list-value-updates.test.ts`: 7 tests, **4 failing**
- `tree-node-value-updates.test.ts`: 6 tests, **5 failing** (inherited from StructRef)

## The Gap

The typed wrapper layer caches value shapes for perceived performance benefits, but this violates CRDT consistency semantics. The cache is never invalidated when:

1. A different ref instance modifies the container (draft pattern)
2. External mutations arrive via sync from other peers

## Success Criteria

1. **All failing tests pass**:

   - `struct-value-updates.test.ts`: 8/8 passing
   - `list-value-updates.test.ts`: 7/7 passing

2. **No regressions**:

   - All existing tests in `packages/change` continue to pass
   - All tests in dependent packages (`@loro-extended/repo`, `@loro-extended/react`) pass

3. **Architectural principle enforced**:
   - Value shapes are NEVER cached
   - Container refs (handles) can be cached
   - The CRDT is the single source of truth

## Dependency Analysis

### Direct Dependencies

```
StructRef ← used by:
  └── DocRef (creates StructRef for struct-shaped properties)
  └── RecordRef (creates StructRef for struct-valued records)
  └── ListRefBase (creates StructRef for struct-valued lists)
  └── TreeNodeRef (creates StructRef for node.data)

ListRefBase ← extended by:
  └── ListRef (Shape.list)
  └── MovableListRef (Shape.movableList)
```

### Transitive Dependencies

```
@loro-extended/change
  └── @loro-extended/repo (uses change() for doc mutations)
        └── @loro-extended/react (uses repo for React bindings)
        └── @loro-extended/hono (uses repo for server-side)
```

### Risk Assessment

| Change            | Risk   | Mitigation                                                                       |
| ----------------- | ------ | -------------------------------------------------------------------------------- |
| `StructRef` fix   | Low    | Same pattern as RecordRef fix                                                    |
| `ListRefBase` fix | Medium | More complex caching logic; need to preserve mutation tracking within `change()` |
| `TreeNodeRef`     | None   | Automatically fixed when StructRef is fixed                                      |

## Implementation Plan

### Phase 1: Fix StructRef

**File**: `packages/change/src/typed-refs/struct.ts`

**Change**: Modify `getOrCreateRef()` to never cache value shapes

```typescript
getOrCreateRef<Shape extends ContainerShape | ValueShape>(key: string, shape: Shape): any {
  // Value shapes: ALWAYS read from container
  if (isValueShape(shape)) {
    const containerValue = this.container.get(key)
    if (containerValue !== undefined) {
      return containerValue
    }
    const placeholder = (this.placeholder as any)?.[key]
    if (placeholder === undefined) {
      throw new Error("placeholder required")
    }
    return placeholder
  }

  // Container shapes: safe to cache (handles)
  let ref = this.propertyCache.get(key)
  if (!ref) {
    ref = createContainerTypedRef(this.getTypedRefParams(key, shape))
    this.propertyCache.set(key, ref)
  }
  // ... rest unchanged
}
```

**Verification**: Run `struct-value-updates.test.ts` - expect 8/8 passing

### Phase 2: Fix ListRefBase

**File**: `packages/change/src/typed-refs/list-base.ts`

**Change**: Modify `getMutableItem()` to never cache value shapes

```typescript
protected getMutableItem(index: number): any {
  const containerItem = this.container.get(index)
  if (containerItem === undefined) {
    return undefined
  }

  // Value shapes: ALWAYS read from container (NEVER cache)
  if (isValueShape(this.shape.shape)) {
    return containerItem
  }

  // Container shapes: safe to cache (handles)
  let cachedItem = this.itemCache.get(index)
  if (!cachedItem) {
    cachedItem = createContainerTypedRef(
      this.getTypedRefParams(index, this.shape.shape as ContainerShape),
    )
    this.itemCache.set(index, cachedItem)
  }
  // ... rest unchanged
}
```

**Note**: `getPredicateItem()` already reads from container, so it's safe.

**Verification**: Run `list-value-updates.test.ts` - expect 7/7 passing

### Phase 3: Verify No Regressions

1. Run full test suite for `@loro-extended/change`:

   ```bash
   pnpm --filter @loro-extended/change test run
   ```

2. Run tests for dependent packages:
   ```bash
   pnpm --filter @loro-extended/repo test run
   pnpm --filter @loro-extended/react test run
   ```

### Phase 4: Update Changeset

Update `.changeset/fix-record-value-stale-cache.md` to include all fixes:

```markdown
---
"@loro-extended/change": patch
---

Fix: Value shapes in RecordRef, StructRef, and ListRefBase now always read from the container

Previously, value shapes were cached, causing stale values when the underlying container
was modified by a different ref instance (e.g., drafts created by `change()`).

The fix ensures value shapes are always read fresh from the container, while container
shapes (handles) continue to be cached safely.
```

### Phase 5: Graduate Test Files

Rename test files to proper regression test names:

- `struct-value-updates.test.ts` → keep as regression test
- `list-value-updates.test.ts` → keep as regression test

## Checklist

- [x] Fix `StructRef.getOrCreateRef()` - don't cache value shapes when autoCommit=true
- [x] Fix `ListRefBase.getMutableItem()` - don't cache value shapes when autoCommit=true
- [x] Verify `struct-value-updates.test.ts` passes (8/8)
- [x] Verify `list-value-updates.test.ts` passes (7/7)
- [x] Verify all existing `@loro-extended/change` tests pass (434/434)
- [ ] Verify `@loro-extended/repo` tests pass (skipped per user request)
- [x] Update changeset to cover all fixes
- [ ] Clean up test file comments (remove "FAILS" annotations)
