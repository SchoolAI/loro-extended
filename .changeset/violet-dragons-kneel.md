---
"@loro-extended/change": minor
---

The `.value` getter on TypedDoc is now optimized for reading--rather than creating a JSON doc, it allows you lightning-fast access to the underlying properties without serializing the entire document. To access JSON like before, use `.toJSON()` instead. Also fixed a bug in the LoroText and LoroCounter types where the empty-state (fallback if not defined in the document) was being ignored due to Loro's behavior where a '.getCounter' or '.getText' initializes values.
