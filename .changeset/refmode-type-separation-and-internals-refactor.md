---
"@loro-extended/change": minor
---

Refactor ref internals and enhance type system

This release includes major type system improvements and internal API cleanup to better align TypeScript types with runtime behavior.

**Type System Enhancements:**

- **RefMode type separation**: Added `RefMode` generic parameter (`"mutable"` | `"draft"`) to distinguish between reactive access (outside `change()`) and plain mutation (inside `change()` callbacks)
- **Value shape types**: Value properties now return `PlainValueRef<T>` for `_mutable` and plain `T` for `_draft`, eliminating the confusing `PlainValueRef<T> | T` union
- **Container ref modes**: Updated `StructRef`, `ListRef`, `MovableListRef`, and `IndexedRecordRef` to accept a `Mode` generic parameter
- **New type helpers**: Added `Draft<T>` and `InferDraftType<T>` for extracting draft types from shapes
- **Improved type inference**: Fixed `useValue()` type inference for value properties - now correctly resolves overloads for `PlainValueRef<T>`

**Breaking Changes to Internal APIs:**

- Container ref types now have a `Mode` parameter: `StructRef<N, Mode>`, `ListRef<N, Mode>`, etc.
- The `change()` function now correctly types draft parameters using `Draft` mode
- Shape interface extended with `_draft` type parameter: `Shape<Plain, Mutable, Draft, Placeholder>`

**Internal Refactoring:**

- Removed vestigial `absorbPlainValues()` method (plain values write eagerly via `PlainValueRef`)
- Removed `RefInternalsBase.absorbPlainValues()` interface requirement
- Removed `absorbCachedPlainValues()` utility function
- Added optional `finalizeTransaction?()` for post-change cleanup (e.g., clearing list caches)

**Developer Experience:**

- Inside `change()` callbacks, value properties now type as plain `T` for ergonomic patterns like `if (draft.active)` without needing `valueOf()`
- Outside `change()`, value properties type as `PlainValueRef<T>` for reactive subscriptions
- Test files updated to use `change()` blocks for mutations (best practice pattern)

**No runtime behavioral changes** - all changes are internal refactoring and type improvements. All 899+ tests pass.