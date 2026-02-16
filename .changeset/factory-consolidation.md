---
"@loro-extended/change": patch
---

### PlainValueRef proxy consolidation

**Refactored:**
- Extracted shared proxy boilerplate (GET preamble, SET unwrap, runtime primitive check) into reusable helpers
- Extracted shared PlainValueRef base builder to eliminate 3 duplicated construction blocks
- Replaced `setNestedValueInObject` with existing `setAtPath`; added `transformAtPath` to `utils/path-ops.ts`

**Removed:**
- Dead `absorbValueAtIndex` method from `ListRefBaseInternals`, `ListRefInternals`, and `MovableListRefInternals`
- Duplicated `setNestedValue` and `setNestedValueInObject` from `factory.ts`

**Added:**
- `transformAtPath` utility in `utils/path-ops.ts`
- Edge case tests for array values in `Shape.plain.any()`
- Runtime assertion in `getMutableItem` to guard `itemCache` type invariant

**Documentation:**
- Updated TECHNICAL.md with PlainValueRef test assertion guidance
- Updated TECHNICAL.md with proxy boilerplate extraction details
- Updated TECHNICAL.md with array-in-any behavior documentation
