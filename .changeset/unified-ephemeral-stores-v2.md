---
"@loro-extended/repo": major
"@loro-extended/change": major
"@loro-extended/hooks-core": minor
"@loro-extended/react": minor
"@loro-extended/hono": minor
"@loro-extended/adapter-websocket": minor
---

# Unified Ephemeral Store System v2

This release implements a major refactor of the ephemeral (presence) store system, providing a unified API for managing ephemeral data across documents.

## Breaking Changes

### Handle API Changes

- **`TypedDocHandle` removed** - Use `Handle` or `HandleWithEphemerals` instead
- **`UntypedDocHandle` removed** - Use `Handle` with `Shape.any()` for untyped documents
- **`usePresence(handle)` deprecated** - Use `useEphemeral(handle.presence)` instead
- **`handle.presence.set(value)` changed** - Use `handle.presence.setSelf(value)` instead
- **`handle.presence.all` removed** - Use `{ self, peers }` from `useEphemeral()` or access `handle.presence.self` and `handle.presence.peers` directly

### Schema API Changes

- **`Shape.map()` deprecated** - Use `Shape.struct()` for CRDT container structs
- **`Shape.plain.object()` deprecated** - Use `Shape.plain.struct()` for plain value structs

### Ephemeral Declarations Format

The third argument to `repo.get()` now expects an `EphemeralDeclarations` object:

```typescript
// Before
const handle = repo.get(docId, DocSchema, PresenceSchema)

// After
const handle = repo.get(docId, DocSchema, { presence: PresenceSchema })
```

## New Features

### Unified Handle Class

All handle types are now unified into a single `Handle<D, E>` class:

- `doc` is always a `TypedDoc<D>` (use `Shape.any()` for untyped)
- Ephemeral stores are accessed as properties via the declarations
- Full sync infrastructure (readyStates, waitUntilReady, etc.)

### Multiple Ephemeral Stores

You can now declare multiple ephemeral stores per document for bandwidth isolation:

```typescript
const handle = repo.get(docId, DocSchema, {
  mouse: MouseShape,      // High-frequency updates
  profile: ProfileShape,  // Low-frequency updates
})

handle.mouse.setSelf({ x: 100, y: 200 })
handle.profile.setSelf({ name: 'Alice' })
```

### TypedEphemeral Interface

New unified interface for ephemeral stores:

```typescript
interface TypedEphemeral<T> {
  // Core API
  set(key: string, value: T): void
  get(key: string): T | undefined
  getAll(): Map<string, T>
  delete(key: string): void
  
  // Convenience API for per-peer pattern
  readonly self: T | undefined
  setSelf(value: T): void
  readonly peers: Map<string, T>
  
  // Subscription
  subscribe(cb: (event) => void): () => void
  
  // Escape hatch
  readonly raw: EphemeralStore
}
```

### External Store Integration

Libraries can register their own ephemeral stores for network sync:

```typescript
const externalStore = new LibraryEphemeralStore()
handle.addEphemeral('library-data', externalStore)
```

### useEphemeral Hook

New hook for subscribing to ephemeral store changes:

```typescript
const { self, peers } = useEphemeral(handle.presence)
```

## Migration Guide

### Updating Schema Definitions

```typescript
// Before
const MessageSchema = Shape.map({
  id: Shape.plain.string(),
  content: Shape.text(),
})

const PresenceSchema = Shape.plain.object({
  name: Shape.plain.string(),
})

// After
const MessageSchema = Shape.struct({
  id: Shape.plain.string(),
  content: Shape.text(),
})

const PresenceSchema = Shape.plain.struct({
  name: Shape.plain.string(),
})

const EphemeralDeclarations = {
  presence: PresenceSchema,
}
```

### Updating Handle Usage

```typescript
// Before
const handle = repo.get(docId, DocSchema, PresenceSchema)
const { self, peers } = usePresence(handle)
handle.presence.set({ name: 'Alice' })

// After
const handle = repo.get(docId, DocSchema, { presence: PresenceSchema })
const { self, peers } = useEphemeral(handle.presence)
handle.presence.setSelf({ name: 'Alice' })
```

### Updating Server Code

```typescript
// Before
import { TypedDocHandle } from "@loro-extended/repo"
const handle = new TypedDocHandle(untypedHandle, DocSchema, PresenceSchema)

// After
import { HandleWithEphemerals } from "@loro-extended/repo"
const handle = repo.get(docId, DocSchema, { presence: PresenceSchema })
```
