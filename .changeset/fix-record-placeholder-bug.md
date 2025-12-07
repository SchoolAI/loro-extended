---
"@loro-extended/change": patch
---

Fix "placeholder required" error when accessing non-existent keys in `Shape.record()` with nested `Shape.map()` values

**Before (broken):**
```typescript
const schema = Shape.doc({
  users: Shape.record(Shape.map({
    name: Shape.plain.string(),
  })),
})

const doc = new TypedDoc(schema)

// This would throw "placeholder required" instead of returning undefined
const name = doc.value.users["nonexistent-id"]?.name
```

**After (fixed):**
```typescript
// Now correctly returns undefined, allowing optional chaining to work
const name = doc.value.users["nonexistent-id"]?.name  // undefined
```

The fix ensures that accessing a key that doesn't exist in a Record returns `undefined` in readonly mode, allowing optional chaining (`?.`) to work as expected.