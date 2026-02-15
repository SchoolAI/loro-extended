# @loro-extended/hono

Hono JSX hooks for building real-time collaborative applications with [Loro CRDT](https://github.com/loro-dev/loro) documents.

## What This Package Does

This package provides Hono JSX-specific bindings for Loro CRDT documents with a Doc-first pattern:

- **`useDocument`** - Get a typed document with sync capabilities
- **`useValue`** - Subscribe to document or ref changes
- **`usePlaceholder`** - Get placeholder values from schema definitions
- **`useEphemeral`** - Subscribe to ephemeral store changes (presence, cursors, etc.)

This package mirrors the API of `@loro-extended/react` but uses Hono's JSX implementation (`hono/jsx`) instead of React.

### Key Features

- **Type Safety** - Full TypeScript support with schema-driven type inference
- **Fine-Grained Reactivity** - Subscribe to entire documents or specific refs
- **Unified Sync** - Use `sync(doc)` for sync capabilities like `waitForSync()` and presence
- **Placeholder Support** - Extract placeholders defined in your schema

## Installation

```bash
npm install @loro-extended/hono @loro-extended/change @loro-extended/repo loro-crdt hono
# or
pnpm add @loro-extended/hono @loro-extended/change @loro-extended/repo loro-crdt hono
```

## Quick Start

```tsx
import { Shape, useDocument, useValue, RepoProvider } from "@loro-extended/hono"
import { useMemo } from "hono/jsx"
import { render } from "hono/jsx/dom"
import type { RepoParams } from "@loro-extended/repo"

// Define your document schema
const CounterSchema = Shape.doc({
  count: Shape.counter(),
})

function Counter() {
  // Get a typed document
  const doc = useDocument("counter", CounterSchema)
  
  // Subscribe to document changes
  const snapshot = useValue(doc)

  const increment = () => {
    doc.count.increment(1)
  }

  const decrement = () => {
    doc.count.decrement(1)
  }

  return (
    <div>
      <div>{snapshot.count}</div>
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

### `useDocument(docId, docSchema, ephemeralDeclarations?)`

Returns a typed `Doc` for the given document. The document is created synchronously and provides direct access to typed refs.

```typescript
import { sync } from "@loro-extended/repo"

// Without ephemeral stores
const doc = useDocument(docId, docSchema)

// With ephemeral stores (e.g., presence)
const doc = useDocument(docId, docSchema, { presence: PresenceSchema })

// Access sync capabilities
await sync(doc).waitForSync()
sync(doc).presence.setSelf({ status: "online" })
```

**Parameters:**
- `docId: DocId` - The document identifier
- `docSchema: DocShape` - The document schema
- `ephemeralDeclarations?: EphemeralDeclarations` - Optional ephemeral store declarations

**Returns:** `Doc<D, E>` - A typed document with direct ref access

### `useValue(docOrRef)`

Subscribes to document or ref changes and returns the current value.

```typescript
// Full document snapshot
const snapshot = useValue(doc)

// Single ref value (fine-grained updates)
const count = useValue(doc.count)
const title = useValue(doc.title)
const items = useValue(doc.items)
```

**Parameters:**
- `docOrRef: Doc | TypedRef` - A document or typed ref

**Returns:** The current value (type inferred from input)

### `usePlaceholder(ref)`

Returns the placeholder value defined in the schema for a ref.

```typescript
const placeholder = usePlaceholder(doc.title) // From Shape.text().placeholder("...")
```

**Parameters:**
- `ref: TypedRef` - A typed ref with a placeholder defined

**Returns:** The placeholder value or `undefined`

### `useEphemeral(ephemeral)`

Subscribes to any ephemeral store and returns the current state. This is the preferred way to subscribe to presence and other ephemeral data.

```typescript
import { sync } from "@loro-extended/repo"

// For presence
const { self, peers } = useEphemeral(sync(doc).presence)

// Update your value
sync(doc).presence.setSelf({ cursor: { x: 100, y: 200 } })
```

**Parameters:**
- `ephemeral: TypedEphemeral<T>` - A typed ephemeral store

**Returns:** `{ self: T | undefined, peers: Map<string, T> }`

### `useRepo()`

Returns the Repo instance from context.

```typescript
const repo = useRepo()
const myPeerId = repo.identity.peerId
```

## Presence Example

```tsx
import { sync } from "@loro-extended/repo"

const DocSchema = Shape.doc({
  content: Shape.text(),
})

const PresenceSchema = Shape.plain.struct({
  cursor: Shape.plain.struct({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
  name: Shape.plain.string().placeholder("Anonymous"),
})

function CollaborativeEditor() {
  const doc = useDocument("doc", DocSchema, { presence: PresenceSchema })
  const snapshot = useValue(doc)
  const { self, peers } = useEphemeral(sync(doc).presence)

  const handleMouseMove = (e: MouseEvent) => {
    sync(doc).presence.setSelf({
      cursor: { x: e.clientX, y: e.clientY }
    })
  }

  return (
    <div onMouseMove={handleMouseMove}>
      <div>Content: {snapshot.content}</div>
      <div>
        Users: {self?.name}, {Array.from(peers.values()).map(p => p.name).join(", ")}
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

## Differences from @loro-extended/react

This package is nearly identical to `@loro-extended/react`, with the following differences:

- Uses `hono/jsx` instead of `react` for JSX runtime
- Uses Hono's `useMemo`, `useEffect`, `useSyncExternalStore`, etc. from `hono/jsx`
- Designed for Hono-based applications and edge runtimes

The API surface is intentionally kept the same to make it easy to switch between React and Hono implementations.

## Complete Example

For a full collaborative Hono application, see the [Hono Counter Example](../../examples/hono-counter/README.md) which demonstrates:

- Setting up the Repo with network adapters
- Using `useDocument` and `useValue` for reactive document state
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