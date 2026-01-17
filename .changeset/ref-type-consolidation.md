---
"@loro-extended/hooks-core": patch
---

Simplify ref type definitions and fix placeholder typing

- `AnyTypedRef` is now derived from `ContainerShape["_mutable"]` instead of manually listing all ref types
- `UseRefValueReturn<R>` simplified from 8 conditional branches to a single unified type
- **Bug fix**: `placeholder` is now correctly typed for all ref types, not just `TextRef`
  (the runtime already returned placeholders for all refs, but the types didn't reflect this)
- Removed redundant individual return type interfaces (`UseCounterRefValueReturn`, etc.)

This is an internal refactoring with one bug fix. No breaking changes to the public API.
