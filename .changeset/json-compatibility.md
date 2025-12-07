---
"@loro-extended/change": minor
---

# Enhanced JSON Compatibility for TypedRef

This release significantly improves the developer experience when working with `TypedRef` objects (the values returned by `.value` or inside `.change()`).

## Features

- **`JSON.stringify()` Support**: You can now directly call `JSON.stringify()` on any `TypedRef` (Doc, Map, List, Record, etc.) to get its plain JSON representation. This works recursively for nested structures.
- **Enumerable Properties**: Properties on `DocRef` and `MapRef` are now enumerable, meaning they show up in `Object.keys()`, `Object.entries()`, and `for...in` loops.
- **`toJSON()` Methods**: Added `toJSON()` methods to all `TypedRef` classes, ensuring consistent serialization behavior.
- **List Iteration**: `ListRef` now implements `Symbol.iterator`, allowing you to use `for...of` loops directly on lists.
- **`toArray()` Improvement**: `ListRef.toArray()` now returns an array of plain values (or nested plain objects) instead of raw Loro containers.
- **Consistent Placeholder Behavior**: `useDocument` now returns proxied placeholders during loading state that support `.toJSON()`, ensuring consistent API usage regardless of loading state.
- **Type Support**: `DeepReadonly` type now includes `toJSON()` method definition, improving TypeScript support for snapshotting.

## Example

```typescript
const doc = createTypedDoc(MySchema)
// ... make changes ...

// Now works as expected!
console.log(JSON.stringify(doc.value))

// Iteration works too
for (const item of doc.value.myList) {
  console.log(item)
}

// Object keys work
console.log(Object.keys(doc.value))