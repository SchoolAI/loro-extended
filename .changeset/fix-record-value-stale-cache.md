---
"@loro-extended/change": patch
---

Fix: Value shapes in RecordRef, StructRef, and ListRefBase now always read fresh from the container

Previously, value shapes were cached, causing stale values to be returned when the underlying container was modified by a different ref instance (e.g., drafts created by `change()`).

The fix ensures that:
- When `autoCommit` is true (direct access outside of `change()`), value shapes are always read fresh from the CRDT container
- When `autoCommit` is false (inside `change()`), value shapes are cached to support find-and-mutate patterns where mutations to found items persist back to the CRDT

This resolves issues where:
- `record.set("key", newValue)` appeared to have no effect after the first write
- `struct.property = newValue` returned the old value on subsequent reads
- `list.get(index)` returned stale values after delete/insert operations
- `delete()` operations appeared to not work
