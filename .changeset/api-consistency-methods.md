---
"@loro-extended/change": major
---

### API Consistency: Unify read/write using methods

**Breaking Changes:**

- `PlainValueRef`: Property assignment removed; use `.set(value)` instead
- `CounterRef`: `.value` getter removed; use `.get()` instead
- `ListRef`/`MovableListRef`: Bracket assignment removed; use `.set(index, value)` instead
- `StructRef`: Property assignment removed; use `ref.prop.set(value)` instead
- `RecordRef`: Bracket assignment removed; use `.set(key, value)` instead

**New API:**

- `PlainValueRef.get()` — read the current value
- `PlainValueRef.set(value)` — write a new value
- `ListRef.set(index, value)` — update item at index
- Uniform API inside and outside `change()` blocks

**Type System:**

- `_draft` and `_mutable` type parameters unified (both return `PlainValueRef<T>`)
- New `DeepPlainValueRef<T>` type for recursive nested property access

**Migration:**

```typescript
// Before
draft.title = "New"
draft.scores.alice = 100
list[0] = "updated"
counter.value

// After
draft.title.set("New")
draft.scores.set("alice", 100)
list.set(0, "updated")
counter.get()
```
