# @loro-extended/hono

Hono JSX hooks for building real-time collaborative applications with [Loro CRDT](https://github.com/loro-dev/loro) documents.

## What This Package Does

This package provides Hono JSX-specific bindings for Loro CRDT documents with a handle-first pattern:

- **`useHandle`** - Get a stable, typed document handle
- **`useDoc`** - Subscribe to document changes with optional selectors
- **`usePresence`** - Subscribe to presence state changes

This package mirrors the API of `@loro-extended/react` but uses Hono's JSX implementation (`hono/jsx`) instead of React.

### Key Features

- **Stable References** - Handles never change, preventing unnecessary re-renders
- **Fine-Grained Reactivity** - Use selectors to only re-render when specific data changes
- **Type Safety** - Full TypeScript support with schema-driven type inference
- **Unified Presence** - Document and presence are managed together through the handle

## Installation

```bash
npm install @loro-extended/hono @loro-extended/change @loro-extended/repo loro-crdt hono
# or
pnpm add @loro-extended/hono @loro-extended/change @loro-extended/repo loro-crdt hono
```

## Quick Start

```tsx
import { Shape, useHandle, useDoc, RepoProvider } from "@loro-extended/hono"
import { useMemo } from "hono/jsx"
import { render } from "hono/jsx/dom"
import type { RepoParams } from "@loro-extended/repo"

// Define your document schema
const CounterSchema = Shape.doc({
  count: Shape.counter(),
})

function Counter() {
  // Get a stable handle (never re-renders)
  const handle = useHandle("counter", CounterSchema)
  
  // Subscribe to document changes
  const doc = useDoc(handle)

  const increment = () => {
    handle.change(d => {
      d.count.increment(1)
    })
  }

  const decrement = () => {
    handle.change(d => {
      d.count.decrement(1)
    })
  }

  return (
    <div>
      <div>{doc.count}</div>
      <button onClick={decrement}>-</button>
      <button onClick={increment}>+</button>
    </div>
  )
}

// Wrap your app with RepoProvider
function App() {
  const config = useMemo<RepoParams>(() => ({
    identity: { name: "user-1", type: "user" },
    adapters: [/* your adapters */],
  }), [])

  return (
    <RepoProvider config={config}>
      <Counter />
    </RepoProvider>
  )
}

render(<App />, document.getElementById("root")!)
```

## Core Hooks

### `useHandle(docId, docSchema, presenceSchema?)`

Returns a stable `TypedDocHandle` for the given document. The handle is created synchronously and never changes.

```typescript
// Without presence
const handle = useHandle(docId, docSchema)

// With presence
const handle = useHandle(docId, docSchema, presenceSchema)
```

**Parameters:**
- `docId: DocId` - The document identifier
- `docSchema: DocShape` - The document schema
- `presenceSchema?: ValueShape` - Optional presence schema

**Returns:** `TypedDocHandle<D, P>` with:
- `handle.value` - Current document value (readonly)
- `handle.change(fn)` - Mutate the document
- `handle.presence` - Typed presence API
- `handle.docId` - The document ID
- `handle.readyStates` - Sync status information

### `useDoc(handle, selector?)`

Subscribes to document changes and returns the current value.

```typescript
// Full document
const doc = useDoc(handle)

// With selector (fine-grained updates)
const count = useDoc(handle, d => d.count)
```

**Parameters:**
- `handle: TypedDocHandle<D>` - The document handle
- `selector?: (doc: DeepReadonly<Infer<D>>) => R` - Optional selector

**Returns:** The document value or selected value

### `usePresence(handle)`

Subscribes to presence changes.

```typescript
const { self, peers } = usePresence(handle)

// Update your presence
handle.presence.set({ cursor: { x: 100, y: 200 } })
```

**Returns:** `{ self: Infer<P>, peers: Map<string, Infer<P>> }`

### `useRepo()`

Returns the Repo instance from context.

```typescript
const repo = useRepo()
const myPeerId = repo.identity.peerId
```

## Presence Example

```tsx
const DocSchema = Shape.doc({
  content: Shape.text(),
})

const PresenceSchema = Shape.plain.object({
  cursor: Shape.plain.object({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
  name: Shape.plain.string().placeholder("Anonymous"),
})

function CollaborativeEditor() {
  const handle = useHandle("doc", DocSchema, PresenceSchema)
  const doc = useDoc(handle)
  const { self, peers } = usePresence(handle)

  const handleMouseMove = (e: MouseEvent) => {
    handle.presence.set({
      cursor: { x: e.clientX, y: e.clientY }
    })
  }

  return (
    <div onMouseMove={handleMouseMove}>
      <div>Content: {doc.content}</div>
      <div>
        Users: {self.name}, {Array.from(peers.values()).map(p => p.name).join(", ")}
      </div>
    </div>
  )
}
```

## Setting Up the Repo

```tsx
import { RepoProvider } from "@loro-extended/hono"
import { IndexedDBStorageAdapter } from "@loro-extended/adapter-indexeddb"
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client"
import { useMemo } from "hono/jsx"

function App() {
  const config = useMemo(() => ({
    identity: { name: "user-1", type: "user" },
    adapters: [
      new IndexedDBStorageAdapter(),
      new SseClientNetworkAdapter({
        postUrl: () => "/sync/post",
        eventSourceUrl: (peerId) => `/sync/subscribe?peerId=${peerId}`,
      }),
    ],
  }), [])

  return (
    <RepoProvider config={config}>
      <YourApp />
    </RepoProvider>
  )
}
```

## Migration from Previous API

If you're upgrading from the previous `useDocument` API:

**Before:**
```typescript
const [doc, changeDoc, handle] = useDocument(docId, schema, emptyState)
changeDoc(d => { d.count.increment(1) })
```

**After:**
```typescript
const handle = useHandle(docId, schema)
const doc = useDoc(handle)
handle.change(d => { d.count.increment(1) })
```

## Differences from @loro-extended/react

This package is nearly identical to `@loro-extended/react`, with the following differences:

- Uses `hono/jsx` instead of `react` for JSX runtime
- Uses Hono's `useMemo`, `useEffect`, `useSyncExternalStore`, etc. from `hono/jsx`
- Designed for Hono-based applications and edge runtimes

The API surface is intentionally kept the same to make it easy to switch between React and Hono implementations.

## Complete Example

For a full collaborative Hono application, see the [Hono Counter Example](../../examples/hono-counter/README.md) which demonstrates:

- Setting up the Repo with network adapters
- Using `useHandle` and `useDoc` for reactive document state
- Building collaborative UI components with Hono JSX

## Requirements

- Hono 4+
- TypeScript 5+ (recommended)
- A Repo instance from `@loro-extended/repo`

## Related Packages

- [`@loro-extended/hooks-core`](../hooks-core/README.md) - Framework-agnostic hook implementations
- [`@loro-extended/change`](../change/README.md) - Schema definitions and typed operations
- [`@loro-extended/repo`](../repo/README.md) - Document synchronization and storage
- [`@loro-extended/react`](../react/README.md) - React version of these hooks
- Network adapters: `@loro-extended/adapter-sse`, `@loro-extended/adapter-websocket`, `@loro-extended/adapter-webrtc`
- Storage adapters: `@loro-extended/adapter-indexeddb`, `@loro-extended/adapter-leveldb`, `@loro-extended/adapter-postgres`

## License

MIT
