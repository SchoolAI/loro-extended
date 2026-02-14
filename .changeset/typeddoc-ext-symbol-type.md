---
"@loro-extended/change": patch
---

fix(change): Add `[EXT_SYMBOL]` to TypedDoc type for robust change() support

Fixed a TypeScript type inference issue where `change(doc, fn)` would fail to compile when `TypedDoc<T>` was "flattened" across module boundaries (e.g., in `.d.ts` files or re-exported type aliases).

**Root cause**: TypeScript's generic inference for `change<Shape>(doc: TypedDoc<Shape>, ...)` requires the argument to match the `TypedDoc<T>` pattern. When types get expanded/flattened, the wrapper is lost and inference fails, causing TypeScript to fall through to the `[EXT_SYMBOL]` fallback overload—which previously failed because `TypedDoc` didn't include `[EXT_SYMBOL]` in its type.

**The fix**: Added the `[EXT_SYMBOL]` property (with the `change` method signature) to the `TypedDoc` type. This:
1. Matches runtime behavior (the proxy already exposes this symbol)
2. Provides a fallback path when type flattening breaks the primary overload
3. Aligns with how `Lens<D>` is already typed

Before (required workaround):
```typescript
function MyComponent({ doc }: { doc: any }) {  // had to use 'any'
  change(doc, draft => { ... })
}
```

After:
```typescript
function MyComponent({ doc }: { doc: TypedDoc<MySchema> }) {
  change(doc, draft => { ... })  // ✅ Works correctly
}
```
