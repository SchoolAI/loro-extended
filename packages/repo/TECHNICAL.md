# Technical Learnings: React API Simplification for Loro-Extended

## Key Facts

### Architecture
- **`TypedDoc` is a Proxy** - The `@loro-extended/change` package creates TypedDoc instances using JavaScript Proxy with custom `ownKeys` trap that filters out Symbol properties
- **WeakMap beats Symbol for cross-package state** - When attaching metadata to proxied objects, use WeakMap instead of Symbol properties to avoid Proxy invariant violations
- **`repo.get()` returns `Doc<D>`** - The new API returns the TypedDoc directly, not a Handle wrapper
- **`sync(doc)` is the escape hatch** - Sync/network capabilities are accessed via a function call, not properties on the doc

### Type System
- **`Doc<D>` is just `TypedDoc<D>`** - The public type alias hides sync implementation details
- **`RepoDoc<D, E>` is internal** - Extends TypedDoc with `[SYNC_SYMBOL]` for sync ref storage
- **Ephemeral type parameter `E` doesn't flow through `Doc<D>`** - Users must explicitly type `sync<D, E>(doc)` calls or let inference work from the SyncRef properties

### Caching Behavior
- **Schema comparison is by reference** - `repo.get()` throws if the same docId is requested with a different schema object
- **Ephemeral shapes are compared by key names** - Not deep equality, just sorted key comparison
- **Cache cleared on delete/reset** - Both `repo.delete(docId)` and `repo.reset()` clear the document cache

## New Findings and Insights

### Proxy Invariant Violations
When using `Object.defineProperty` with `configurable: false` on a Proxy target, the property MUST appear in `ownKeys`. This caused test failures:

```
TypeError: 'ownKeys' on proxy: trap result did not include 'Symbol(loro-extended:sync)'
```

**Solution**: Use WeakMap as primary storage, or make the property `configurable: true`.

### Deprecation Warnings in Browser Environments
`process.env.NODE_ENV` isn't available in browsers. Use a global flag pattern instead:

```typescript
// Bad - fails in browsers
if (process.env.NODE_ENV !== "production") { ... }

// Good - works everywhere
if ((globalThis as any).__LORO_DEV_WARNINGS__ !== false) { ... }
```

### Hook Return Value Simplification
The old `useRefValue` returned `{ value, placeholder }` which required destructuring even when placeholder wasn't needed. The new API separates concerns:

```typescript
// Old (verbose)
const { value } = useRefValue(doc.title)

// New (direct)
const value = useValue(doc.title)
const placeholder = usePlaceholder(doc.title) // only when needed
```

### Document vs Ref Detection
To distinguish a `TypedDoc` from a `TypedRef` at runtime, check for the loro symbol:

```typescript
function isTypedDoc(value: unknown): value is TypedDoc<DocShape> {
  const loroSymbol = Symbol.for("loro-extended:loro")
  return value && typeof value === "object" && loroSymbol in value
}
```

## Corrections to Previous Assumptions

### ❌ "Attach sync via symbol property"
**Correction**: While the symbol property approach works for `in` checks and direct property access, it fails when tools (like vitest) enumerate object keys via `ownKeys`. Use WeakMap as primary storage.

### ❌ "repo.get() should return Handle for backward compatibility"
**Correction**: Breaking the return type is acceptable when:
1. A separate method (`repo.getHandle()`) maintains backward compatibility
2. The new type (`Doc<D>`) is actually a subset of what users typically need
3. Migration is straightforward (remove `.doc` accessor)

### ❌ "Deprecation warnings need build-time transforms"
**Correction**: Runtime warnings using global flags work fine and don't require bundler configuration. Users can disable via `globalThis.__LORO_DEV_WARNINGS__ = false`.

### ❌ "useDocument needs useState for stability"
**Correction**: Since `repo.get()` caches documents, the hook can use `useMemo` directly:

```typescript
// Works because repo.get() returns same instance for same docId
const doc = useMemo(() => repo.get(docId, schema), [repo, docId, schema])
```

## Migration Patterns

### From Handle to Doc
```typescript
// Before
const handle = useHandle(docId, schema)
handle.doc.title.insert(0, "Hello")
await handle.waitForSync()
handle.presence.setSelf({ ... })

// After
const doc = useDocument(docId, schema)
doc.title.insert(0, "Hello")
await sync(doc).waitForSync()
sync(doc).presence.setSelf({ ... })
```

### Test File Updates
When changing API return types, use targeted sed replacements:
```bash
sed -i '' 's/repo\.get(/repo.getHandle(/g' file.test.ts
```

But be careful not to replace in files testing the new API (like sync.test.ts).