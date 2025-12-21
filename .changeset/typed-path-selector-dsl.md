---
"@loro-extended/change": minor
"@loro-extended/repo": minor
---

Add type-safe path selector DSL for `TypedDocHandle.subscribe`

## `@loro-extended/change`

New exports for building type-safe path selectors:

- `createPathBuilder(docShape)` - Creates a path builder for a document schema
- `compileToJsonPath(segments)` - Compiles path segments to JSONPath strings
- `evaluatePath(doc, selector)` - Evaluates a path selector against a TypedDoc
- `evaluatePathOnValue(value, segments)` - Evaluates path segments against plain values
- `hasWildcard(segments)` - Checks if a path contains wildcard segments
- `PathBuilder<D>` - Type for the path builder
- `PathSelector<T>` - Type for path selectors with result type inference
- `PathSegment` - Type for individual path segments
- `PathNode<S, InArray>` - Type for path nodes in the DSL

## `@loro-extended/repo`

### New `TypedDocHandle.subscribe` overload

Type-safe path selector DSL for subscriptions with full TypeScript type inference:

```typescript
// Type-safe path selector DSL:
handle.subscribe(
  p => p.books.$each.title,           // PathSelector<string[]>
  (titles, prev) => {                  // titles: string[], prev: string[] | undefined
    console.log("Titles changed from", prev, "to", titles)
  }
)
```

**DSL constructs:**
- Property access: `p.config.theme`
- Array wildcards: `p.books.$each`
- Array indices: `p.books.$at(0)`, `p.books.$first`, `p.books.$last`
- Negative indices: `p.books.$at(-1)` (last element)
- Record wildcards: `p.users.$each`
- Record keys: `p.users.$key("alice")`

**Two-stage filtering:**
1. WASM-side: `subscribeJsonpath` NFA matcher for fast O(1) path matching
2. JS-side: Deep equality check to filter false positives from wildcard paths

### Simplified JSONPath subscription

The raw JSONPath escape hatch now has a simpler callback signature:

```typescript
// Before (deprecated getPath parameter):
handle.subscribe("$.books[*].title", (values, getPath) => { ... })

// After (simpler):
handle.subscribe("$.books[*].title", (values) => { ... })
```

### New `TypedDocHandle.jsonPath` method

General-purpose JSONPath query method for ad-hoc queries:

```typescript
const expensiveBooks = handle.jsonPath("$.books[?@.price>10]")
const allTitles = handle.jsonPath("$..title")
```

See also:
- https://loro.dev/docs/advanced/jsonpath
- https://github.com/loro-dev/loro/pull/883