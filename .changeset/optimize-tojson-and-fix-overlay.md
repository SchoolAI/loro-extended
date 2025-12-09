---
"@loro-extended/change": patch
---

Optimized `toJSON()` performance for nested TypedRefs by leveraging Loro's native `toJSON()` in readonly mode. Also fixed a bug where placeholders were not correctly applied to nested items in lists and records.