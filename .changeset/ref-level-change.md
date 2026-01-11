---
"@loro-extended/change": minor
---

Add ref-level `change()` support for better encapsulation

The `change()` function now accepts any typed ref (ListRef, TextRef, CounterRef, StructRef, RecordRef, TreeRef, MovableListRef) in addition to TypedDoc. This enables passing refs around without exposing the entire document structure.

```typescript
// Before: Required access to the doc
function addStates(doc: TypedDoc<...>) {
  doc.change(draft => {
    draft.states.createNode({ name: "idle" })
  })
}

// After: Works with just the ref
function addStates(states: TreeRef<StateNodeShape>) {
  change(states, draft => {
    draft.createNode({ name: "idle" })
  })
}
```

Key features:
- All ref types supported (List, Text, Counter, Struct, Record, Tree, MovableList)
- Nested `change()` calls work correctly (Loro's commit is idempotent)
- Returns the original ref for chaining
- Find-and-mutate patterns work as expected
