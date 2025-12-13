---
"@loro-extended/change": patch
---

Fix: Allow `record.set()` and indexed assignment to work with `Shape.text()` and `Shape.counter()` fields

Previously, calling `record.set(key, value)` or using indexed assignment (`record[key] = value`) would throw "Cannot set container directly, modify the typed ref instead" when the record contained `Shape.text()` or `Shape.counter()` fields. This affected both direct records of text/counter (`Shape.record(Shape.text())`) and records of maps containing text/counter fields.
