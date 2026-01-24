---
"@loro-extended/change": minor
---

Add bulk update methods to `RecordRef`: `replace()`, `merge()`, and `clear()`.

These methods provide type-safe bulk operations on records:

```typescript
doc.change(draft => {
  // Replace entire contents (removes keys not in new object)
  draft.game.players.replace({
    alice: { choice: null, locked: false },
    bob: { choice: null, locked: false }
  })

  // Merge values (keeps existing keys not in new object)
  draft.game.scores.merge({
    alice: 100,
    charlie: 50
  })

  // Clear all entries
  draft.game.history.clear()
})
```

**Method semantics:**
- `replace(values)` - Sets record to exactly these entries (removes absent keys)
- `merge(values)` - Adds/updates entries without removing existing ones
- `clear()` - Removes all entries

This provides a type-safe alternative to direct object assignment, which TypeScript cannot support due to limitations in mapped type getter/setter typing.

Also improved `RecordRef` type safety:
- `values()` now returns `InferMutableType<NestedShape>[]` instead of `any[]`
- Added `entries()` method returning `[string, InferMutableType<NestedShape>][]`
- Both methods return properly typed refs for container-valued records
