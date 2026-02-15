# Plan: Preserve Ephemeral Type Parameter in Doc<D, E>

## Background

The recent React API simplification introduced a `Doc<D>` type alias as the public return type from `repo.get()`. This type hides sync implementation details (the `SYNC_SYMBOL`) from users while exposing a clean `TypedDoc<D>` interface.

However, when ephemeral stores are declared via `repo.get(docId, schema, ephemeralShapes)`, the ephemeral type parameter `E` is lost at the type level. The `Doc<D>` type only carries the document shape `D`, not the ephemeral declarations `E`.

### Current Type Definitions

```typescript
// sync.ts - Current (problematic)
export type Doc<D extends DocShape> = TypedDoc<D>

// Internal type that DOES carry E
export type RepoDoc<
  D extends DocShape,
  E extends EphemeralDeclarations = Record<string, never>,
> = TypedDoc<D> & {
  readonly [SYNC_SYMBOL]: SyncRefWithEphemerals<E>
}
```

### Key Architectural Constraints

From `packages/repo/TECHNICAL.md`:
- **`TypedDoc` is a Proxy** - Custom `ownKeys` trap filters out Symbol properties
- **WeakMap beats Symbol for cross-package state** - Used for storing SyncRef
- **`Doc<D>` is just `TypedDoc<D>`** - Currently hides all sync implementation details

## Problem Statement

When users call `sync(doc)` on a document that has ephemeral stores, TypeScript cannot infer the ephemeral type `E` because `Doc<D>` doesn't carry it:

```typescript
const doc = repo.get(docId, MySchema, { presence: PresenceSchema })
// doc is Doc<typeof MySchema> - no E type

sync(doc).presence  // ❌ Type error! presence doesn't exist
sync(doc).presence.setSelf({ status: 'online' })  // ❌ Type error!

// Users must manually specify both type parameters:
sync<typeof MySchema, { presence: typeof PresenceSchema }>(doc).presence  // ✅ Works but verbose
```

This creates a poor developer experience where the ephemeral configuration passed to `repo.get()` must be repeated when calling `sync()`.

## Success Criteria

1. **Type inference flows through**: `sync(doc)` returns correctly typed `SyncRefWithEphemerals<E>` without explicit type parameters
2. **Backward compatible**: Existing code without ephemerals continues to work unchanged
3. **Clean public API**: `Doc<D>` (without ephemerals) remains a simple type for users who don't need ephemeral stores
4. **No runtime overhead**: The fix is purely at the type level; no additional runtime objects or properties

## The Gap

### Current API (broken type inference)

```typescript
const doc = repo.get(docId, MySchema, { presence: PresenceSchema })
// Type: Doc<typeof MySchema>

sync(doc).presence.setSelf({ status: 'online' })
//        ^^^^^^^^ Property 'presence' does not exist on type 'SyncRef<Record<string, never>>'
```

### Target API (working type inference)

```typescript
const doc = repo.get(docId, MySchema, { presence: PresenceSchema })
// Type: Doc<typeof MySchema, { presence: typeof PresenceSchema }>

sync(doc).presence.setSelf({ status: 'online' })  // ✅ Type checks!
```

## Phases and Tasks

### Phase 1: Update `Doc<D, E>` Type Definition ✅

Add a phantom type parameter to `Doc` that carries ephemeral information without affecting runtime behavior.

- ✅ **Task 1.1**: Update `Doc<D, E>` type alias to include phantom type for `E`
  ```typescript
  export type Doc<
    D extends DocShape,
    E extends EphemeralDeclarations = Record<string, never>
  > = TypedDoc<D> & { readonly __ephemeralType?: E }
  ```
- ✅ **Task 1.2**: Update `Repo.get()` overloads to return `Doc<D>` without ephemerals and `Doc<D, E>` with ephemerals
- ✅ **Task 1.3**: Update `useDocument` hook overloads similarly

### Phase 2: Update `sync()` Function Signature ✅

Make `sync()` extract the ephemeral type from the doc's phantom type parameter.

- ✅ **Task 2.1**: Create `ExtractEphemeral<T>` utility type
  ```typescript
  type ExtractEphemeral<T> = T extends { __ephemeralType?: infer E extends EphemeralDeclarations }
    ? E
    : Record<string, never>
  ```
- ✅ **Task 2.2**: Update `sync()` function signature to use `ExtractEphemeral`
  ```typescript
  export function sync<T extends Doc<DocShape, EphemeralDeclarations>>(
    doc: T
  ): SyncRefWithEphemerals<ExtractEphemeral<T>>
  ```

### Phase 3: Update Downstream Consumers ✅

Ensure hooks-core and react packages properly propagate the new type.

- ✅ **Task 3.1**: Update `@loro-extended/hooks-core` `useDocument` overloads
- ✅ **Task 3.2**: Update `@loro-extended/react` re-exports if needed
- ✅ **Task 3.3**: Verify `useLens` and other hooks that accept `TypedDoc<D>` still work

### Phase 4: Update Tests and Documentation ✅

- ✅ **Task 4.1**: Add type-level tests verifying ephemeral type flow
- ✅ **Task 4.2**: Update existing tests to remove explicit type parameters where possible
- ✅ **Task 4.3**: Update `packages/repo/TECHNICAL.md` with new type pattern
- ✅ **Task 4.4**: Update JSDoc comments on `Doc`, `sync()`, and `Repo.get()`

## Unit and Integration Tests

### Type-Level Tests (Phase 4)

These tests verify compile-time type correctness:

```typescript
describe("Doc<D, E> type flow", () => {
  it("sync() infers ephemeral type from doc", () => {
    const doc = repo.get("test", TestSchema, { presence: PresenceSchema })

    // Should compile without explicit type parameters
    const s = sync(doc)
    s.presence.setSelf({ status: "online" })

    // Type assertion: s.presence should be TypedEphemeral<{ status: string }>
    expectTypeOf(s.presence).toMatchTypeOf<TypedEphemeral<{ status: string }>>()
  })

  it("sync() defaults to empty ephemerals for docs without ephemeral shapes", () => {
    const doc = repo.get("test", TestSchema)

    const s = sync(doc)
    // @ts-expect-error - presence should not exist
    s.presence

    expectTypeOf(s).toMatchTypeOf<SyncRef<Record<string, never>>>()
  })

  it("useDocument propagates ephemeral types", () => {
    // In a test component context
    const doc = useDocument("test", TestSchema, { presence: PresenceSchema })

    // Should compile without explicit type parameters
    sync(doc).presence.setSelf({ status: "active" })
  })
})
```

### Runtime Tests (Existing, Updated)

Update `sync.test.ts` to remove explicit type parameters:

```typescript
// Before (current)
it("provides access to ephemeral stores", () => {
  const doc = repo.get("test", TestSchema, { presence: PresenceSchema })
  const s = sync<typeof TestSchema, { presence: typeof PresenceSchema }>(doc)
  s.presence.setSelf({ status: "online" })
})

// After (updated)
it("provides access to ephemeral stores", () => {
  const doc = repo.get("test", TestSchema, { presence: PresenceSchema })
  const s = sync(doc)  // No explicit type parameters needed!
  s.presence.setSelf({ status: "online" })
})
```

## Transitive Effect Analysis

### Direct Dependencies

| Package | Impact |
|---------|--------|
| `@loro-extended/repo` | Primary change: `Doc<D, E>`, `sync()`, `Repo.get()` |
| `@loro-extended/hooks-core` | Must update `useDocument` overloads |
| `@loro-extended/react` | Re-exports from hooks-core, likely no changes needed |

### Transitive Consumers

| Package | Dependency Chain | Impact |
|---------|-----------------|--------|
| `@loro-extended/lens` | Uses `TypedDoc<D>` directly | No impact - doesn't use `Doc<D>` |
| `@loro-extended/change` | Defines `TypedDoc<D>` | No impact - unchanged |

### Breaking Change Analysis

**This is NOT a breaking change** because:

1. `Doc<D>` without the second parameter continues to work (E defaults to `Record<string, never>`)
2. Existing code using explicit `sync<D, E>(doc)` continues to work
3. The phantom property `__ephemeralType` is optional and never accessed at runtime
4. Users who don't use ephemerals see no difference

### Phantom Type Assignability

The phantom type approach preserves assignability:

```typescript
// Doc<D, E> is assignable to Doc<D> because:
// - TypedDoc<D> & { __ephemeralType?: E } is a subtype of TypedDoc<D> & { __ephemeralType?: never }
// - Optional properties with different types are covariant

const docWithEph: Doc<MySchema, { presence: PresenceSchema }> = repo.get(...)
const docPlain: Doc<MySchema> = docWithEph  // ✅ Assignable (widens E to default)
```

This means functions accepting `Doc<D>` continue to accept `Doc<D, E>` - the ephemeral type is only relevant when calling `sync()`.

### Package Dependency Order

Build/test order (unchanged):
1. `@loro-extended/change`
2. `@loro-extended/repo`
3. `@loro-extended/hooks-core`
4. `@loro-extended/react`

## Resources for Implementation

### Files to Modify

| File | Changes |
|------|---------|
| `packages/repo/src/sync.ts` | `Doc<D, E>` type, `ExtractEphemeral`, `sync()` signature |
| `packages/repo/src/repo.ts` | `Repo.get()` overloads with return type `Doc<D, E>` |
| `packages/repo/src/index.ts` | May need to export `ExtractEphemeral` if useful |
| `packages/hooks-core/src/create-hooks.ts` | `useDocument` overloads |
| `packages/repo/src/sync.test.ts` | Update tests, add type-level tests |
| `packages/repo/TECHNICAL.md` | Document phantom type pattern |

### Key Type Definitions to Reference

```typescript
// packages/repo/src/sync.ts
export type SyncRefWithEphemerals<E extends EphemeralDeclarations>
export type EphemeralDeclarations = Record<string, ValueShape>

// packages/change/src/typed-doc.ts
export type TypedDoc<D extends DocShape>
```

## Changeset

**Summary**: Preserve ephemeral type parameter `E` in `Doc<D, E>` so that `sync(doc)` can infer ephemeral store types without requiring explicit type parameters.

### Before

```typescript
const doc = repo.get(docId, MySchema, { presence: PresenceSchema })
// Must specify type parameters explicitly:
sync<typeof MySchema, { presence: typeof PresenceSchema }>(doc).presence.setSelf({ ... })
```

### After

```typescript
const doc = repo.get(docId, MySchema, { presence: PresenceSchema })
// Type inference just works:
sync(doc).presence.setSelf({ ... })
```

### Migration

No migration required. Existing code with explicit type parameters continues to work. Users can optionally remove explicit type parameters for cleaner code.

## Documentation Updates

### TECHNICAL.md Updates

Add to `packages/repo/TECHNICAL.md` under "Type System":

```markdown
### Phantom Type for Ephemeral Declarations

`Doc<D, E>` uses a phantom type property to carry ephemeral type information:

```typescript
export type Doc<
  D extends DocShape,
  E extends EphemeralDeclarations = Record<string, never>
> = TypedDoc<D> & { readonly __ephemeralType?: E }
```

This allows `sync()` to extract `E` via conditional type inference:

```typescript
type ExtractEphemeral<T> = T extends { __ephemeralType?: infer E } ? E : Record<string, never>
```

**Why phantom types?** We can't store `E` in the WeakMap (it's a type-only concept), and we can't add real properties to the Proxy without triggering invariant violations. The optional `__ephemeralType` property is never set at runtime but carries type information through the type system.
```

### Correction to Previous TECHNICAL.md

Update the existing entry:

```markdown
### ❌ "Ephemeral type parameter `E` doesn't flow through `Doc<D>`"
**Correction**: As of this update, `Doc<D, E>` carries the ephemeral type via a phantom property. Users no longer need to explicitly type `sync()` calls.
```
