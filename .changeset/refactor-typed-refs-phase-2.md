---
"@loro-extended/change": patch
---

refactor: extract shared logic for typed refs (phase 2)

- Extracted `absorbCachedPlainValues` utility to consolidate logic for persisting cached values to Loro containers
- Extracted `serializeRefToJSON` utility to consolidate mutable-mode JSON serialization logic
- Updated `MapRef`, `RecordRef`, and `DocRef` to use these shared utilities