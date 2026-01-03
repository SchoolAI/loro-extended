---
"@loro-extended/change": minor
---

Make `getDoc` required in TypedRefParams and unify TreeRef with TypedRef

**Internal changes:**
- `TypedRefParams.getDoc` is now required instead of optional
- `TreeRef` now extends `TypedRef` instead of being a standalone class

**Improvements:**
- `$.loroDoc` now returns `LoroDoc` instead of `LoroDoc | undefined` on all refs
- `getLoroDoc()` helper now returns `LoroDoc` instead of `LoroDoc | undefined` for refs
- Removed ~40 lines of duplicated code from TreeRef (container caching, $, autoCommit, etc.)
- Removed `TreeRefMetaNamespace` interface (now uses inherited `RefMetaNamespace`)

**Non-breaking for external consumers:**
- Existing code with `?.` on `$.loroDoc` will still work
- New code can omit `?.` for cleaner access
