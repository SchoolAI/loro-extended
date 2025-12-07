---
"@loro-extended/change": patch
---

Fix confusing type signature when using `Object.values()` on Records/Maps

Previously, calling `Object.values(doc.value.record)` on a Record would return a confusing union type like:
```typescript
(({ id: string; name: string } & { toJSON(): ... }) | (() => Record<...>))[]
```

This happened because the `DeepReadonly` type added `toJSON()` via intersection, which TypeScript's `Object.values()` type definition included in the values.

The fix restructures `DeepReadonly` to use separate type helpers:
- `DeepReadonlyObject<T>` for plain objects (includes `toJSON()`)
- `DeepReadonlyRecord<T>` for Record types with string index signatures

This ensures:
1. `Object.values()` returns clean types: `DeepReadonly<Participant>[]`
2. `toJSON()` is still callable on Records and Maps
3. Runtime behavior is unchanged (class methods like `toJSON` are not enumerable)