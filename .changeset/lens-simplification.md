---
"@loro-extended/lens": minor
---

Simplified lens architecture with re-entrancy support and debug logging

- Fixed: Calling `change(lens, ...)` inside subscription callbacks no longer causes double-propagation
- Added: `debug` option for logging internal operations (e.g., `{ debug: console.log }`)
- Changed: Replaced 4-state processing machine with queue-based change processing
- Changed: Fresh frontier capture eliminates stale state bugs
- Removed: `syncFrontiers()` and `lastKnownWorldviewFrontiers` (no longer needed)
- Reduced: Code from ~470 lines to ~460 lines
- API addition: `DebugFn` type exported for custom loggers
