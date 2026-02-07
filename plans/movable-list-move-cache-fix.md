# MovableListRef Move Cache Fix

## Background

The `MovableListRef` in `@loro-extended/change` maintains an internal `itemCache` that stores typed refs (like `TextRef`, `StructRef`, etc.) by their index. This cache improves performance by avoiding recreation of typed refs on repeated access.

The cache is properly maintained for `insert` and `delete` operations via `updateCacheForInsert` and `updateCacheForDelete` methods, which remap indices appropriately. However, the `move` operation did not account for cached refs becoming stale when items are reordered.

## Problem Statement

When items in a `MovableListRef` are reordered via `move(from, to)`, cached container refs (like `TextRef`) become stale. Each cached ref has a `getContainer` closure that captures the index at creation time, so after a move:
- The cache maps indices to the wrong refs
- The refs themselves point to wrong containers due to hardcoded indices in closures

This manifests in user-facing applications as: when a list item with a `TextRef` is reordered, the text content does not move with the item—the old text appears at the new position because the stale cached ref is returned.

## Success Criteria

1. ✅ Existing failing tests in `movable-list-ref.test.ts` pass without modification
2. ✅ All existing tests in `@loro-extended/change` continue to pass (630/630)
3. ✅ The fix is minimal and surgical

## The Gap

The original code in `getMutableItem()` cached container refs unconditionally:

```typescript
// Container shapes: safe to cache (handles)
let cachedItem = this.itemCache.get(index)
if (!cachedItem) {
  cachedItem = createContainerTypedRef(...)
  this.itemCache.set(index, cachedItem)
}
return cachedItem as MutableItem
```

This was incorrect because cached refs have hardcoded indices in their `getContainer` closures, making them stale after move operations.

## Solution

The fix mirrors the existing pattern for value shapes: **only cache container refs when in `batchedMutation` mode** (inside `change()`). Outside of `change()`, always create fresh refs.

This works because:
- Outside `change()`: Each access creates a fresh ref with the correct index
- Inside `change()`: Refs are cached for the duration of the mutation (needed for consistent behavior within a single transaction)

## Phases and Tasks

### Phase 1: Implement Fix ✅

- ✅ Modify `getMutableItem()` in `ListRefBaseInternals` to skip caching for container shapes when not in `batchedMutation` mode

### Phase 2: Verify ✅

- ✅ Run `pnpm --filter @loro-extended/change -- verify logic -- -t 'move operation with container refs'` - PASSED
- ✅ Run `pnpm --filter @loro-extended/change -- verify` - PASSED (630/630 tests)

### Phase 3: Changeset ✅

- ✅ Create changeset for patch release

## Unit Tests

The failing tests that now pass are in `packages/change/src/typed-refs/movable-list-ref.test.ts`:

1. `should return correct TextRef after moving items` - tests `move(0, 1)` on 2-item list
2. `should return correct StructRef fields after moving items` - tests `move(0, 2)` on 3-item list (covers "in between" items)

## Transitive Effect Analysis

1. **Direct dependency**: `ListRefBaseInternals.getMutableItem()` is used by both `ListRef` and `MovableListRef`
   - Both benefit from the fix; both had the same latent bug

2. **Performance impact**: Container refs are no longer cached outside of `change()`, so repeated access to the same index will create new refs
   - This is acceptable because refs are lightweight wrappers
   - The alternative (stale data) is far worse

3. **Consumers of `MovableListRef.get()` and `ListRef.get()`**: Any code that accesses list items after a move/insert/delete will now correctly receive the item at the actual index
   - This is the desired fix; no breaking change

4. **`@loro-extended/react`**: The `useCollaborativeText` hook and other hooks that access refs from lists will work correctly after this fix
   - No changes needed in the react package

## Files Changed

- `packages/change/src/typed-refs/list-ref-base.ts` - Modified `getMutableItem()` to skip caching for container shapes outside `batchedMutation` mode
- `packages/change/src/typed-refs/movable-list-ref.test.ts` - Added failing tests (now passing)

## Documentation Updates

None required. This is a bug fix with no API changes.