---
"@loro-extended/change": patch
"@loro-extended/repo": patch
---

# Documentation cleanup: Update READMEs to use current API

Updated all README documentation to use the current recommended APIs:

## API Function Name
- Replaced all `batch()` references with `change()` - the actual exported function name

## Struct Terminology
- Replaced `Shape.map()` with `Shape.struct()` for fixed-key objects
- Replaced `Shape.plain.object()` with `Shape.plain.struct()` for plain struct values

These changes align the documentation with the v1.0.0 API where:
- The `change()` function is the primary mutation helper
- "Struct" terminology is used for fixed-key objects to avoid confusion with JavaScript's `Map`