# React API Simplification: Doc-First Design

## Background

The loro-extended library provides React hooks for building collaborative applications with Loro CRDTs. The current architecture exposes several concepts that users must understand:

1. **Handle** — stable reference from `useHandle(docId, schema)`
2. **handle.doc** — the TypedDoc with CRDT refs
3. **useDoc(handle)** — returns JSON snapshot (confusingly named)
4. **useRefValue(ref)** — subscribe to a single ref's value
5. **useCollaborativeText(ref)** — bind text input to ref
6. **change(handle.doc, fn)** or **handle.change(fn)** — mutate the document

This is **6 concepts** for 3 fundamental tasks: get a doc, read values, mutate values.

### Type Boundary Consideration

`TypedDoc` is defined in `@loro-extended/change`, which has no knowledge of repos, sync, or network concepts. We need a distinct type `RepoDoc<D, E>` that extends `TypedDoc<D>` with sync capabilities, enabling type-safe access via `sync(doc)`.

### The Core Confusion

A user attempting to edit a document wrote:

```typescript
const doc = useDoc(handle)  // Returns JSON snapshot, NOT a doc!
change(doc, draft => { ... })  // Fails! doc is JSON, not TypedDoc
```

The name `useDoc` strongly suggests it returns "the doc" — but it returns a JSON snapshot. Meanwhile, the actual doc is `handle.doc`, accessed through an intermediary "handle" concept.

## Problem Statement

The current React API has too many concepts and confusing naming:

1. **`useDoc` returns a snapshot, not a doc** — misleading name causes runtime/type errors
2. **Handle is an unnecessary intermediary** — users want "the doc", not "a handle to the doc"
3. **`handle.doc` indirection** — extra `.doc` property access for the primary use case
4. **Sync/network/ephemeral mixed with doc concerns** — Handle conflates document access with sync infrastructure

## Success Criteria

1. **3 core concepts** for the main pattern: `useDocument`, `useValue`, direct mutation
2. **`repo.get(docId, schema)` returns `Doc<D>`** — public type alias for TypedDoc with sync capabilities
3. **`useDocument(docId, schema)` is a convenience shortcut** — internally uses `useRepo()` + `repo.get()`
4. **`useValue(ref)` and `useValue(doc)` for reactive subscriptions** — returns value directly (not wrapped)
5. **`usePlaceholder(ref)` for rare placeholder access** — separate hook for placeholder values
6. **`sync(doc)` accessor for rare sync/network needs** — type-safe, clean package boundary
7. **`useRepo()` remains available** — for direct repo access (delete, flush, identity, etc.)
8. **`repo.get()` caches docs and throws on schema mismatch** — safe to call repeatedly
9. **All existing tests pass** with updated APIs
10. **Deprecation path** for `useHandle` and old `useDoc(handle)` signature

## The Gap

### Current API
```typescript
const handle = useHandle(docId, schema)
const snapshot = useDoc(handle)  // confusing: "useDoc" returns JSON, not doc
handle.doc.title.insert(0, "Hello")  // must go through handle.doc
```

### Target API
```typescript
const doc = useDocument(docId, schema)  // returns Doc<D> (TypedDoc + sync)
const title = useValue(doc.title)       // string (reactive)
const snapshot = useValue(doc)          // Infer<D> (reactive)
doc.title.insert(0, "Hello")            // direct mutation, no .doc indirection

// Rare: placeholder access
const placeholder = usePlaceholder(doc.title)  // "Untitled" or undefined

// Rare: sync/network stuff
sync(doc).peerId
await sync(doc).waitForSync()

// Direct repo access (still available)
const repo = useRepo()
repo.delete(docId)
await repo.flush()
```

## Phases and Tasks

### Phase 1: Add `SYNC_SYMBOL`, `sync()` Accessor, and `Doc` Type ✅

Create the escape hatch for sync/network functionality and the public `Doc` type alias.

- 🔴 **Task 1.1**: Define `SYNC_SYMBOL` in `@loro-extended/repo` (`packages/repo/src/sync.ts`)
- 🔴 **Task 1.2**: Define `SyncRef<E>` interface with `peerId`, `docId`, `readyStates`, `loroDoc`, `waitForSync()`, and ephemeral store access
- 🔴 **Task 1.3**: Define internal `RepoDoc<D, E>` type that extends `TypedDoc<D>` with `[SYNC_SYMBOL]`
- 🔴 **Task 1.4**: Define public `Doc<D>` type alias (hides sync implementation detail)
- 🔴 **Task 1.5**: Implement `sync(doc)` function with type-safe overloads
- 🔴 **Task 1.6**: Export `sync`, `Doc`, and `SyncRef` from `@loro-extended/repo` (keep `SYNC_SYMBOL` and `RepoDoc` internal)
- 🔴 **Task 1.7**: Add unit tests for `sync()` function

**Key Types:**
```typescript
// Internal
export const SYNC_SYMBOL = Symbol.for("loro-extended:sync")

export interface SyncRef<E extends EphemeralDeclarations = Record<string, never>> {
  readonly peerId: string
  readonly docId: DocId
  readonly readyStates: ReadyState[]
  readonly loroDoc: LoroDoc
  waitForSync(options?: WaitForSyncOptions): Promise<void>
  // Ephemeral stores accessed as properties when E is provided
}

// Internal - TypedDoc with sync capabilities attached
type RepoDoc<
  D extends DocShape,
  E extends EphemeralDeclarations = Record<string, never>
> = TypedDoc<D> & {
  readonly [SYNC_SYMBOL]: SyncRef<E>
}

// Public API - users see this simple type
export type Doc<D extends DocShape> = TypedDoc<D>

// Type-safe sync() - runtime checks for SYNC_SYMBOL
export function sync<D extends DocShape, E extends EphemeralDeclarations>(
  doc: Doc<D>
): SyncRef<E>
```

### Phase 2: Add Document Caching to `Repo.get()` ✅

Ensure `repo.get()` returns the same `Doc` instance for the same docId, and throws on schema mismatch.

- 🔴 **Task 2.1**: Add `docCache: Map<DocId, { doc: RepoDoc<any, any>, schema: DocShape }>` to `Repo` class
- 🔴 **Task 2.2**: Modify `Repo.get()` to check cache before creating new doc
- 🔴 **Task 2.3**: Throw error if `repo.get()` called with different schema for same docId
- 🔴 **Task 2.4**: Update `Repo.delete()` to clear cache entry
- 🔴 **Task 2.5**: Update `Repo.reset()` to clear entire cache
- 🔴 **Task 2.6**: Add unit tests for caching behavior and schema mismatch error

### Phase 3: Make `Repo.get()` Return `Doc` ✅

Invert the Handle/TypedDoc relationship so the doc is primary.

- 🔴 **Task 3.1**: Modify `Repo.get()` to create TypedDoc and attach sync ref via `SYNC_SYMBOL`
- 🔴 **Task 3.2**: Move Handle functionality (waitForSync, readyStates, subscribe, etc.) to SyncRef
- 🔴 **Task 3.3**: Attach ephemeral stores to SyncRef when ephemeralShapes provided
- 🔴 **Task 3.4**: Update return type of `Repo.get()` to `Doc<D>` (internally `RepoDoc<D, E>`)
- 🔴 **Task 3.5**: Update all Repo tests to use new API

### Phase 4: Update React Hooks ✅

Rename and simplify the React hooks.

- 🔴 **Task 4.1**: Create `useValue` that returns value directly (not wrapped in object)
- 🔴 **Task 4.2**: Add overload to `useValue` for full doc: `useValue(doc)` returns `Infer<D>`
- 🔴 **Task 4.3**: Create `usePlaceholder(ref)` for rare placeholder access
- 🔴 **Task 4.4**: Create `useDocument(docId, schema, ephemeral?)` returning `Doc<D>`
- 🔴 **Task 4.5**: Keep `useRepo()` (no named contexts — defer to future plan)
- 🔴 **Task 4.6**: Deprecate `useHandle` with console warning pointing to `useDocument`
- 🔴 **Task 4.7**: Deprecate `useDoc(handle)` with console warning pointing to `useValue(doc)`
- 🔴 **Task 4.8**: Deprecate `useRefValue` as alias for `useValue`
- 🔴 **Task 4.9**: Update `useEphemeral` to work with `sync(doc).presence` pattern
- 🔴 **Task 4.10**: Update all hook tests

**New Hook Signatures:**
```typescript
// Get repo
function useRepo(): Repo

// Primary hook - returns Doc (TypedDoc + sync capabilities)
function useDocument<D extends DocShape>(docId: DocId, schema: D): Doc<D>
function useDocument<D extends DocShape, E extends EphemeralDeclarations>(
  docId: DocId, 
  schema: D, 
  ephemeral: E
): Doc<D>  // ephemeral accessed via sync(doc).presence etc.

// Subscribe to values - returns value directly
function useValue<R extends AnyTypedRef>(ref: R): ReturnType<R["toJSON"]>
function useValue<D extends DocShape>(doc: Doc<D>): Infer<D>

// Placeholder access (rare)
function usePlaceholder<R extends AnyTypedRef>(ref: R): ReturnType<R["toJSON"]> | undefined

// Deprecated
/** @deprecated Use useDocument(docId, schema) instead */
function useHandle<D extends DocShape>(docId: DocId, schema: D): Handle<D, E>

/** @deprecated Use useValue(doc) instead */
function useDoc<D extends DocShape>(handle: Handle<D, any>): Infer<D>

/** @deprecated Use useValue(ref) instead */
function useRefValue<R extends AnyTypedRef>(ref: R): UseRefValueReturn<R>
```

### Phase 5: Update hooks-core Package ✅

Update the framework-agnostic hook implementations.

- 🔴 **Task 5.1**: Update `createHooks` to implement new `useDocument` signature
- 🔴 **Task 5.2**: Implement `useValue` with direct value return (not wrapped)
- 🔴 **Task 5.3**: Implement `usePlaceholder` hook
- 🔴 **Task 5.4**: Add `useValue(doc)` overload implementation using same sync store pattern
- 🔴 **Task 5.5**: Update exports in `index.ts`
- 🔴 **Task 5.6**: Update hooks-core tests

### Phase 6: Handle Deprecation and Backward Compatibility ✅

Maintain backward compatibility during transition.

- 🔴 **Task 6.1**: Keep `Handle` class but mark as `@deprecated`
- 🔴 **Task 6.2**: Add `handle.doc` getter that returns the underlying doc for migration
- 🔴 **Task 6.3**: Export `Handle` type for existing code but document migration path
- 🔴 **Task 6.4**: Add runtime deprecation warnings (dev mode only)
- 🔴 **Task 6.5**: Update README migration guide with clear before/after examples

### Phase 7: Documentation Updates ✅

Update all documentation to reflect the new API.

- 🔴 **Task 7.1**: Update `packages/react/README.md` with new patterns
- 🔴 **Task 7.2**: Update `packages/hooks-core/README.md`
- 🔴 **Task 7.3**: Update `packages/repo/README.md`
- 🔴 **Task 7.4**: Update root `TECHNICAL.md` with new architecture
- 🔴 **Task 7.5**: Create changeset for minor version bump (new API, deprecations)
- 🔴 **Task 7.6**: Document that multi-repo support is available via `repo.get()` + `useValue()` pattern

## Unit and Integration Tests

### Phase 1 Tests (sync accessor)
```typescript
describe("sync() accessor", () => {
  it("retrieves sync ref from doc created by repo.get()", () => {
    const repo = new Repo({ adapters: [new InMemoryStorageAdapter()] })
    const doc = repo.get("test", TestSchema)
    
    const s = sync(doc)
    expect(s.peerId).toBeDefined()
    expect(s.docId).toBe("test")
    expect(s.readyStates).toBeDefined()
  })
  
  it("throws for doc created without repo", () => {
    const doc = createTypedDoc(TestSchema)
    expect(() => sync(doc)).toThrow(/requires a document from repo.get/)
  })
  
  it("provides access to ephemeral stores", () => {
    const repo = new Repo({ adapters: [new InMemoryStorageAdapter()] })
    const doc = repo.get("test", TestSchema, { presence: PresenceSchema })
    
    const s = sync(doc)
    expect(s.presence).toBeDefined()
    s.presence.setSelf({ status: "online" })
    expect(s.presence.self).toEqual({ status: "online" })
  })
})
```

### Phase 2 Tests (caching)
```typescript
describe("Repo.get() caching", () => {
  it("returns same Doc instance for same docId", () => {
    const repo = new Repo({ adapters: [new InMemoryStorageAdapter()] })
    const doc1 = repo.get("test", TestSchema)
    const doc2 = repo.get("test", TestSchema)
    
    expect(doc1).toBe(doc2)  // Same instance
  })
  
  it("throws on schema mismatch for same docId", () => {
    const repo = new Repo({ adapters: [new InMemoryStorageAdapter()] })
    repo.get("test", TestSchema)
    
    expect(() => repo.get("test", OtherSchema)).toThrow(
      /Document 'test' already exists with different schema/
    )
  })
  
  it("clears cache on delete", async () => {
    const repo = new Repo({ adapters: [new InMemoryStorageAdapter()] })
    const doc1 = repo.get("test", TestSchema)
    await repo.delete("test")
    const doc2 = repo.get("test", TestSchema)
    
    expect(doc1).not.toBe(doc2)  // Different instance
  })
})
```

### Phase 4 Tests (React hooks)
```typescript
describe("useDocument hook", () => {
  it("returns Doc directly", () => {
    const { result } = renderHook(() => useDocument("test", TestSchema), {
      wrapper: createRepoWrapper(),
    })
    
    // Can mutate directly
    act(() => {
      result.current.title.insert(0, "Hello")
    })
    
    expect(result.current.toJSON().title).toBe("Hello")
  })
})

describe("useValue hook", () => {
  it("subscribes to ref value changes and returns value directly", () => {
    const { result: docResult } = renderHook(() => useDocument("test", TestSchema), {
      wrapper: createRepoWrapper(),
    })
    
    const { result: valueResult } = renderHook(
      () => useValue(docResult.current.title),
      { wrapper: createRepoWrapper() }
    )
    
    // Returns value directly, not wrapped in { value }
    expect(valueResult.current).toBe("")
    
    act(() => {
      docResult.current.title.insert(0, "Hello")
    })
    
    expect(valueResult.current).toBe("Hello")
  })
  
  it("subscribes to whole doc changes", () => {
    const { result: docResult } = renderHook(() => useDocument("test", TestSchema), {
      wrapper: createRepoWrapper(),
    })
    
    const { result: snapshotResult } = renderHook(
      () => useValue(docResult.current),  // whole doc
      { wrapper: createRepoWrapper() }
    )
    
    expect(snapshotResult.current.title).toBe("")
    
    act(() => {
      docResult.current.title.insert(0, "Hello")
    })
    
    expect(snapshotResult.current.title).toBe("Hello")
  })
})

describe("usePlaceholder hook", () => {
  it("returns placeholder value for refs with placeholder", () => {
    const SchemaWithPlaceholder = Shape.doc({
      title: Shape.text().placeholder("Untitled"),
    })
    
    const { result: docResult } = renderHook(
      () => useDocument("test", SchemaWithPlaceholder),
      { wrapper: createRepoWrapper() }
    )
    
    const { result: placeholderResult } = renderHook(
      () => usePlaceholder(docResult.current.title),
      { wrapper: createRepoWrapper() }
    )
    
    expect(placeholderResult.current).toBe("Untitled")
  })
  
  it("returns undefined for refs without placeholder", () => {
    const { result: docResult } = renderHook(
      () => useDocument("test", TestSchema),  // no placeholder
      { wrapper: createRepoWrapper() }
    )
    
    const { result: placeholderResult } = renderHook(
      () => usePlaceholder(docResult.current.title),
      { wrapper: createRepoWrapper() }
    )
    
    expect(placeholderResult.current).toBeUndefined()
  })
})

describe("multi-repo via repo.get() + useValue()", () => {
  it("repo.get() returns cached Doc for reactivity via useValue", () => {
    const repo = new Repo({ adapters: [new InMemoryStorageAdapter()] })
    const doc = repo.get("test", TestSchema)
    
    // Reactivity comes from useValue, doc is just stable reference
    const { result } = renderHook(() => useValue(doc.title))
    
    expect(result.current).toBe("")
    
    act(() => {
      doc.title.insert(0, "Hello")
    })
    
    expect(result.current).toBe("Hello")
  })
})
```

## Transitive Effect Analysis

### Direct Dependencies

1. **`@loro-extended/repo`** → Changes to `Repo.get()` return type, new `sync()` export
2. **`@loro-extended/hooks-core`** → Hook signature changes, new `useValue` export
3. **`@loro-extended/react`** → Re-exports from hooks-core, wrapper updates

### Transitive Consumers

1. **`@loro-extended/lens`** — Uses `TypedDoc`, no changes needed (lens takes TypedDoc as input)
2. **Example apps** — Will need updates to use new API patterns
3. **User applications** — Deprecation warnings guide migration

### Breaking Change Analysis

| Change | Breaking? | Mitigation |
|--------|-----------|------------|
| `repo.get()` returns `Doc` | Yes (type change) | Keep Handle type, add `.doc` getter |
| New `useDocument` hook | No | Additive, `useHandle` still works |
| `useDoc(handle)` deprecated | No | Still works, console warning |
| `useRefValue` deprecated | No | Keep as alias for `useValue` |
| `useValue` returns value directly | Yes (for `useRefValue` users) | `useRefValue` keeps old return type during deprecation |
| `useHandle` deprecated | No | Still works, console warning |

### Package Dependency Order

Changes must be made in this order:
1. `@loro-extended/repo` (sync symbol, caching, return type)
2. `@loro-extended/hooks-core` (hook implementations)
3. `@loro-extended/react` (re-exports, wrappers)

## Resources for Implementation

### Files to Modify

**@loro-extended/repo:**
- `packages/repo/src/sync.ts` (new file — SYNC_SYMBOL, SyncRef, RepoDoc internal, Doc public, sync())
- `packages/repo/src/repo.ts` — caching, schema mismatch check, return type change to Doc
- `packages/repo/src/handle.ts` — deprecation, SyncRef extraction
- `packages/repo/src/index.ts` — exports (Doc, SyncRef, sync; NOT RepoDoc or SYNC_SYMBOL)
- `packages/repo/README.md`

**@loro-extended/hooks-core:**
- `packages/hooks-core/src/create-hooks.ts` — useDocument implementation
- `packages/hooks-core/src/create-ref-hooks.ts` — useValue (direct return), usePlaceholder
- `packages/hooks-core/src/index.ts` — exports

**@loro-extended/react:**
- `packages/react/src/hooks-core.ts` — re-exports
- `packages/react/src/index.ts` — exports
- `packages/react/README.md`

**Documentation:**
- `TECHNICAL.md` — architecture section
- `packages/repo/README.md`
- `packages/hooks-core/README.md`
- `packages/react/README.md`

### Key Existing Code References

**Current Handle class** (`packages/repo/src/handle.ts` L257-760):
- Contains `peerId`, `readyStates`, `waitForSync()`, `subscribe()`, ephemeral management
- `_doc: TypedDoc<D>` is the actual document
- Most functionality moves to `SyncRef`

**Current Repo.get()** (`packages/repo/src/repo.ts` L161-178):
- Creates new Handle each call (no caching)
- Returns `HandleWithEphemerals<D, E>`
- Will change to return `Doc<D>` with caching and schema mismatch detection

**Current useHandle** (`packages/hooks-core/src/create-hooks.ts` L48-78):
- Uses `useState` for stability (will be unnecessary with caching)
- Returns Handle
- Will be deprecated in favor of `useDocument`

**Current useDoc** (`packages/hooks-core/src/create-hooks.ts` L86-160):
- Takes Handle, returns `Infer<D>` snapshot
- Uses `useSyncExternalStore` for reactivity
- Will be deprecated in favor of `useValue(doc)`

**Current useRefValue** (`packages/hooks-core/src/create-ref-hooks.ts`):
- Returns `{ value, placeholder? }`
- Will be deprecated in favor of `useValue` (direct return) and `usePlaceholder`

**Symbol pattern** (`packages/change/src/ext.ts`):
- `EXT_SYMBOL = Symbol.for("loro-extended:ext")`
- Pattern for `sync()` should match

## Changeset

Create `.changeset/react-api-simplification.md`:

```markdown
---
"@loro-extended/repo": minor
"@loro-extended/hooks-core": minor
"@loro-extended/react": minor
---

feat: Simplified React API with doc-first design

This release simplifies the React API by making the document the primary interface:

**New API:**
```typescript
// Get doc directly (no Handle intermediary)
const doc = useDocument(docId, schema)

// Subscribe to values (returns value directly)
const title = useValue(doc.title)    // string
const snapshot = useValue(doc)       // Infer<D>

// Placeholder access (rare)
const placeholder = usePlaceholder(doc.title)

// Mutate directly
doc.title.insert(0, "Hello")

// Sync/network access (rare)
sync(doc).peerId
await sync(doc).waitForSync()
```

**Key Changes:**
- `repo.get()` now returns `Doc<D>` directly (TypedDoc with sync capabilities)
- `repo.get()` now caches documents and throws on schema mismatch
- `useDocument(docId, schema)` is the primary hook
- `useValue(ref)` returns value directly (not wrapped in object)
- `usePlaceholder(ref)` for placeholder access
- `sync(doc)` provides access to peerId, readyStates, waitForSync, ephemeral stores

**Deprecations:**
- `useHandle` — use `useDocument` instead
- `useDoc(handle)` — use `useValue(doc)` for snapshots
- `useRefValue` — use `useValue` instead (alias kept for compatibility)
- `Handle` type — still exported but deprecated

**Migration:**
```typescript
// Before
const handle = useHandle(docId, schema)
const snapshot = useDoc(handle)
const { value, placeholder } = useRefValue(handle.doc.title)
handle.doc.title.insert(0, "Hello")

// After  
const doc = useDocument(docId, schema)
const snapshot = useValue(doc)
const title = useValue(doc.title)
const placeholder = usePlaceholder(doc.title)
doc.title.insert(0, "Hello")
```
```

## TECHNICAL.md Updates

Add new section after "Symbol-Based Escape Hatches":

```markdown
### The `sync()` Function and SYNC_SYMBOL

The `sync()` function provides access to sync/network capabilities for documents obtained from `repo.get()`:

```typescript
import { sync } from "@loro-extended/repo"

const doc = repo.get(docId, schema, { presence: PresenceSchema })

// Access sync capabilities
sync(doc).peerId           // Local peer ID
sync(doc).readyStates      // Sync status with channels
await sync(doc).waitForSync()  // Wait for sync completion
sync(doc).presence.setSelf({ ... })  // Ephemeral stores
```

**Design Rationale**: The `sync()` function uses an internal `SYNC_SYMBOL` (similar to `ext()` using `EXT_SYMBOL`) to avoid polluting the TypedDoc namespace with sync-related properties. This maintains clean separation:

- `@loro-extended/change` — CRDT operations, `ext()` for forking/patches
- `@loro-extended/repo` — Sync/network, `sync()` for peerId/readyStates/ephemeral

The public type is `Doc<D>` which is simply an alias for `TypedDoc<D>`. The sync capabilities are attached at runtime via symbol, so `sync()` performs a runtime check and throws a helpful error if called on a document not created via `repo.get()`.

### Document Caching in Repo

`Repo.get()` caches TypedDoc instances by docId. Multiple calls with the same docId return the same instance:

```typescript
const doc1 = repo.get("my-doc", schema)
const doc2 = repo.get("my-doc", schema)
doc1 === doc2  // true - same instance

// Schema mismatch throws
repo.get("my-doc", DifferentSchema)  // throws Error
```

This enables the simplified React pattern where `useDoc` doesn't need internal memoization:

```typescript
function useDoc(docId, schema) {
  const repo = useRepo()
  return repo.get(docId, schema)  // Safe - returns cached instance
}
```

Cache entries are cleared when documents are deleted via `repo.delete(docId)`.
```

## README.md Updates

Update `packages/react/README.md` Quick Start section:

```markdown
## Quick Start

```tsx
import { Shape, useDoc, useValue, RepoProvider } from "@loro-extended/react"
import { sync } from "@loro-extended/repo"

// Define your document schema
const TodoSchema = Shape.doc({
  title: Shape.text().placeholder("My Todo List"),
  todos: Shape.list(
    Shape.struct({
      id: Shape.plain.string(),
      text: Shape.plain.string(),
      completed: Shape.plain.boolean(),
    })
  ),
})

function TodoApp() {
  // Get the doc directly (stable reference)
  const doc = useDoc("todo-doc", TodoSchema)
  
  // Subscribe to values reactively
  const title = useValue(doc.title)
  const todos = useValue(doc.todos)

  const addTodo = (text: string) => {
    doc.todos.push({
      id: Date.now().toString(),
      text,
      completed: false,
    })
  }

  return (
    <div>
      <h1>{title}</h1>
      {todos.map((todo, index) => (
        <div key={todo.id}>
          <input
            type="checkbox"
            checked={todo.completed}
            onChange={() => {
              const item = doc.todos.get(index)
              if (item) item.completed = !item.completed
            }}
          />
          {todo.text}
        </div>
      ))}
      <button onClick={() => addTodo("New Todo")}>Add Todo</button>
    </div>
  )
}
```

## Core Concepts

| Concept | Purpose |
|---------|---------|
| `useDocument(id, schema)` | Get the document (stable `Doc` reference) |
| `useValue(doc.field)` | Subscribe to a field's value (reactive) |
| `useValue(doc)` | Subscribe to whole doc snapshot (reactive) |
| `usePlaceholder(doc.field)` | Get placeholder value (rare) |
| `doc.field.method()` | Mutate the document directly |
| `sync(doc)` | Access sync/network features (rare) |
| `useRepo()` | Access repo directly (delete, flush, etc.) |
```
