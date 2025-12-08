---
"@loro-extended/change": patch
---

Fix "placeholder required" error when calling toJSON() on documents with Records containing Maps

When a Record contains Map entries that exist in the CRDT but not in the placeholder (which is always `{}` for Records), the nested MapRef was created with `placeholder: undefined`. When `MapRef.toJSON()` tried to access value properties that don't exist in the CRDT, it threw "placeholder required".

The fix: `RecordRef.getTypedRefParams()` now derives a placeholder from the schema's shape when the Record's placeholder doesn't have an entry for that key. This ensures nested containers always have valid placeholders to fall back to for missing values.