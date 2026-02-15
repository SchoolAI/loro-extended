# Technical Learnings: React API for Loro-Extended

## Key Facts

### Architecture
- **`TypedDoc` is a Proxy** - The `@loro-extended/change` package creates TypedDoc instances using JavaScript Proxy with custom `ownKeys` trap that filters out Symbol properties
- **WeakMap beats Symbol for cross-package state** - When attaching metadata to proxied objects, use WeakMap instead of Symbol properties to avoid Proxy invariant violations
- **`repo.get()` returns `Doc<D>`** - The API returns the TypedDoc directly
- **`sync(doc)` is the escape hatch** - Sync/network capabilities are accessed via a function call, not properties on the doc

### Type System
- **`Doc<D, E>` uses phantom types for ephemeral inference** - The `E` type parameter is carried via an optional `__ephemeralType` property that exists only at the type level
- **`RepoDoc<D, E>` is internal** - Extends TypedDoc with `[SYNC_SYMBOL]` for sync ref storage
- **`sync()` extracts ephemeral type automatically** - Uses `ExtractEphemeral<T>` conditional type to infer `E` from `Doc<D, E>`

### Caching Behavior
- **Schema comparison is by reference** - `repo.get()` throws if the same docId is requested with a different schema object
- **Ephemeral shapes are compared by key names** - Not deep equality, just sorted key comparison
- **Cache cleared on delete/reset** - Both `repo.delete(docId)` and `repo.reset()` clear the document cache

## Findings and Insights

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
The `useValue` hook returns the value directly (not wrapped in an object):

```typescript
// Direct access
const value = useValue(doc.title)
const placeholder = usePlaceholder(doc.title) // only when needed
```

### Document vs Ref Detection
To distinguish a `TypedDoc` from a `TypedRef` at runtime, check for the loro symbol:

```typescript
function isTypedDoc(value: unknown): value is TypedDoc<DocShape> {
  const loroSymbol = Symbol.for("loro-extended:loro")
  return loroSymbol in value && hasToJSON(value)
}
```

### Phantom Type for Ephemeral Declarations

`Doc<D, E>` uses a phantom type property to carry ephemeral type information without affecting runtime:

```typescript
export type Doc<
  D extends DocShape,
  E extends EphemeralDeclarations = Record<string, never>
> = TypedDoc<D> & { readonly __ephemeralType?: E }
```

This allows `sync()` to extract `E` via conditional type inference:

```typescript
type ExtractEphemeral<T> = T extends { __ephemeralType?: infer E } ? E : Record<string, never>

export function sync<T extends Doc<DocShape, EphemeralDeclarations>>(
  doc: T
): SyncRefWithEphemerals<ExtractEphemeral<T>>
```

**Why phantom types?** We can't store `E` in the WeakMap (it's a type-only concept), and we can't add real properties to the Proxy without triggering `ownKeys` invariant violations. The optional `__ephemeralType` property is never set at runtime but carries type information through the type system.

**Usage:**
```typescript
// Type inference just works - no explicit type parameters needed
const doc = repo.get(docId, MySchema, { presence: PresenceSchema })
sync(doc).presence.setSelf({ status: 'online' })  // ✅ Type-safe!
```

### The `[EXT_SYMBOL]` Overload for change()

`Doc<D, E>` (which is `TypedDoc<D> & { __ephemeralType?: E }`) does not match a function overload expecting `TypedDoc<Shape>`. The `[EXT_SYMBOL]` overload handles all `TypedDoc`-like objects correctly because it extracts the draft type from the symbol property rather than trying to structurally match `TypedDoc<Shape>`:

```typescript
type ExtractDraft<T> = T extends {
  [EXT_SYMBOL]: { change: (fn: (draft: infer D) => void, ...) => void }
} ? D : never

// This single overload handles TypedDoc, Doc<D, E>, Lens, and anything with [EXT_SYMBOL]
export function change<T extends { [EXT_SYMBOL]: { change: ... } }>(
  target: T,
  fn: (draft: ExtractDraft<T>) => void,
): T
```

## API Reference

### From Doc to Sync
```typescript
const doc = useDocument(docId, schema)
doc.title.insert(0, "Hello")
await sync(doc).waitForSync()
sync(doc).presence.setSelf({ ... })
```

### Test File Updates
When changing API return types, use targeted sed replacements:
```bash
sed -i '' 's/repo\.getHandle(/repo.get(/g' file.test.ts
```

### change() Works with Doc<D, E>

The `[EXT_SYMBOL]` overload handles `Doc<D, E>` correctly:

```typescript
const doc = repo.get("test", Schema)

// ✅ change() works - draft is properly typed as Mutable<typeof Schema>
change(doc, draft => {
  draft.title.insert(0, "Hello")
})

// ✅ Direct mutation also works for simple cases
doc.title.insert(0, "Hello")
```

Both patterns are valid. Use `change()` when you need to batch mutations into a single commit or attach commit messages. Use direct mutation for simple one-off changes.

## Removed in v6

The following APIs were removed in v6:

### From `@loro-extended/repo`
- `Handle` class - Use `Doc<D>` from `repo.get()` instead
- `repo.getHandle()` - Use `repo.get()` instead
- `createHandle()` - Use `createRepoDoc()` instead
- `HandleWithEphemerals<D, E>` type - Use `Doc<D, E>` instead
- `EphemeralDeclarations` type (from handle.ts) - Moved to sync.ts
- `ReadinessCheck` type - Not needed with new API

### From `@loro-extended/hooks-core` and `@loro-extended/react`
- `useHandle()` - Use `useDocument()` instead
- `useDoc()` - Use `useValue()` instead
- `useRefValue()` - Use `useValue()` for value, `usePlaceholder()` for placeholder
- `UseRefValueReturn` type - Not needed with new API

### From `@loro-extended/change`
- `Shape.map()` - Use `Shape.struct()` instead
- `Shape.plain.object()` - Use `Shape.plain.struct()` instead
- `MapContainerShape` type - Use `StructContainerShape` instead
- `ObjectValueShape` type - Use `StructValueShape` instead
- `isMapShape()` - Use `isStructShape()` instead

### Migration Examples

```typescript
// Before (v5)
const handle = useHandle(docId, schema)
handle.doc.title.insert(0, "Hello")
await handle.waitForSync()
const { value, placeholder } = useRefValue(handle.doc.title)

// After (v6)
const doc = useDocument(docId, schema)
doc.title.insert(0, "Hello")
await sync(doc).waitForSync()
const value = useValue(doc.title)
const placeholder = usePlaceholder(doc.title)
```

```typescript
// Before (v5)
const Schema = Shape.doc({
  root: Shape.map({ text: Shape.text() })
})
const PresenceSchema = Shape.plain.object({
  cursor: Shape.plain.object({ x: Shape.plain.number(), y: Shape.plain.number() })
})

// After (v6)
const Schema = Shape.doc({
  root: Shape.struct({ text: Shape.text() })
})
const PresenceSchema = Shape.plain.struct({
  cursor: Shape.plain.struct({ x: Shape.plain.number(), y: Shape.plain.number() })
})
```
