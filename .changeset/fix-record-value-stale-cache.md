---
"@loro-extended/change": patch
---

Fix: Shape.record() now correctly updates existing keys across multiple change() calls

Previously, value shapes in records were cached in `RecordRef.refCache`, causing stale values to be returned when the underlying container was modified by a different RecordRef instance (e.g., drafts created by `change()`).

The fix ensures that value shapes are always read fresh from the container, while container shapes (which are handles/references) continue to be cached safely.

This resolves issues where:
- `record.set("key", newValue)` appeared to have no effect after the first write
- `record.delete("key")` appeared to not remove the key
- `record.get("key")` returned stale values after updates in separate `change()` calls
