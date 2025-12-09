---
"@loro-extended/change": patch
---

### Refactoring: Reduce code duplication in typed-refs

Implemented Phase 1 refactoring to improve maintainability:

1. **Extracted `containerConstructor`** to `utils.ts` - removed duplicate Loro container mappings from `map.ts` and `record.ts`

2. **Added `assertMutable()` helper** to `base.ts` - consolidated 20+ inline readonly checks into a single reusable method across all typed ref classes

3. **Extracted `unwrapReadonlyPrimitive()`** to `utils.ts` - consolidated counter/text value unwrapping logic from `map.ts`, `record.ts`, `doc.ts`, and `list-base.ts`

These changes reduce cognitive load and ensure consistent behavior across the codebase.