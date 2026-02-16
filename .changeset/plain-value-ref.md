---
"@loro-extended/change": major
"@loro-extended/hooks-core": major
"@loro-extended/react": major
"@loro-extended/hono": major
---

# PlainValueRef: Reactive subscriptions for plain values

Plain value properties (from `Shape.plain.*`) now return `PlainValueRef<T>` instead of raw values. This enables reactive subscriptions via `useValue()` and `subscribe()`.

## New APIs

- `value(ref)` - Get current value from PlainValueRef, TypedRef, or TypedDoc
- `useValue(doc.meta.title)` - Now works with plain value properties
- `subscribe(doc.meta.title, cb)` - Now works with plain value properties

## Breaking Changes

Plain value property access now returns `PlainValueRef<T>` instead of `T`:

```typescript
// Before
const title: string = doc.meta.title

// After
const title: PlainValueRef<string> = doc.meta.title
const titleValue: string = value(doc.meta.title)
```

Strict equality comparisons become TypeScript errors (guiding correct usage):

```typescript
// Before (worked)
if (doc.meta.title === "foo") { ... }

// After (type error - use value())
if (value(doc.meta.title) === "foo") { ... }
```

## Coercion Still Works

Template literals, string concatenation, and JSON serialization work transparently:

```typescript
console.log(`Title: ${doc.meta.title}`)  // Works via valueOf()
JSON.stringify(doc.meta.title)            // Works via toJSON()
```

## Assignment Still Works

```typescript
doc.meta.title = "new value"  // Still works
```
