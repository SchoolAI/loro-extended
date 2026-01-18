# @loro-extended/react

React hooks for building real-time collaborative applications with [Loro CRDT](https://github.com/loro-dev/loro) documents.

## What This Package Does

This package provides React-specific bindings for Loro CRDT documents with a handle-first pattern:

- **`useHandle`** - Get a stable, typed document handle
- **`useDoc`** - Subscribe to document changes with optional selectors
- **`useEphemeral`** - Subscribe to ephemeral store changes (presence, cursors, etc.)

### Key Features

- **Stable References** - Handles never change, preventing unnecessary re-renders
- **Fine-Grained Reactivity** - Use selectors to only re-render when specific data changes
- **Type Safety** - Full TypeScript support with schema-driven type inference
- **Unified Presence** - Document and presence are managed together through the handle

## Installation

```bash
npm install @loro-extended/react @loro-extended/change @loro-extended/repo loro-crdt
# or
pnpm add @loro-extended/react @loro-extended/change @loro-extended/repo loro-crdt
```

## Quick Start

```tsx
import { Shape, useHandle, useDoc, useEphemeral, RepoProvider } from "@loro-extended/react"
import type { RepoParams } from "@loro-extended/repo"

// Define your document schema
const TodoSchema = Shape.doc({
  title: Shape.text().placeholder("My Todo List"),
  todos: Shape.list(
    Shape.map({
      id: Shape.plain.string(),
      text: Shape.plain.string(),
      completed: Shape.plain.boolean(),
    })
  ),
})

// Define presence schema (optional)
const PresenceSchema = Shape.plain.object({
  cursor: Shape.plain.object({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
  name: Shape.plain.string().placeholder("Anonymous"),
})

function TodoApp() {
  // Get a stable handle (never re-renders)
  const handle = useHandle("todo-doc", TodoSchema, { presence: PresenceSchema })
  
  // Subscribe to document changes
  const doc = useDoc(handle)
  
  // Subscribe to presence changes
  const { self, peers } = useEphemeral(handle.presence)

  const addTodo = (text: string) => {
    handle.change(d => {
      d.todos.push({
        id: Date.now().toString(),
        text,
        completed: false,
      })
    })
  }

  const toggleTodo = (index: number) => {
    handle.change(d => {
      const todo = d.todos.get(index)
      if (todo) {
        todo.completed = !todo.completed
      }
    })
  }

  return (
    <div>
      <h1>{doc.title}</h1>
      
      {/* Show connected users */}
      <div>
        Online: {self?.name}, {Array.from(peers.values()).map(p => p.name).join(", ")}
      </div>

      {doc.todos.map((todo, index) => (
        <div key={todo.id}>
          <input
            type="checkbox"
            checked={todo.completed}
            onChange={() => toggleTodo(index)}
          />
          {todo.text}
        </div>
      ))}

      <button onClick={() => addTodo("New Todo")}>
        Add Todo
      </button>
    </div>
  )
}

// Wrap your app with RepoProvider
function App() {
  const config: RepoParams = {
    identity: { name: "user-1", type: "user" },
    adapters: [/* your adapters */],
  }

  return (
    <RepoProvider config={config}>
      <TodoApp />
    </RepoProvider>
  )
}
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

**Returns:** `Handle<D, E>` with:
- `handle.doc` - The typed document (TypedDoc)
- `handle.change(fn)` - Mutate the document (batched transaction)
- `handle.loroDoc` - Raw LoroDoc for untyped access
- `handle.docId` - The document ID
- `handle.readyStates` - Sync status information

### `useDoc(handle, selector?)`

Subscribes to document changes and returns the current value.

```typescript
// Full document
const doc = useDoc(handle)

// With selector (fine-grained updates)
const title = useDoc(handle, d => d.title)
const todoCount = useDoc(handle, d => d.todos.length)
```

**Parameters:**
- `handle: TypedDocHandle<D>` - The document handle
- `selector?: (doc: DeepReadonly<Infer<D>>) => R` - Optional selector

**Returns:** The document value or selected value

### `useEphemeral(ephemeral)`

Subscribes to any ephemeral store and returns the current state. This is the preferred way to subscribe to presence and other ephemeral data.

```typescript
// For presence
const { self, peers } = useEphemeral(handle.presence)

// For other ephemeral stores
const { self, peers } = useEphemeral(handle.cursors)

// Update your value
handle.presence.setSelf({ cursor: { x: 100, y: 200 } })
```

**Parameters:**
- `ephemeral: TypedEphemeral<T>` - A typed ephemeral store from the handle

**Returns:** `{ self: T | undefined, peers: Map<string, T> }`

### `usePresence(handle)` (Deprecated)

> **Deprecated:** Use `useEphemeral(handle.presence)` instead.

Subscribes to presence changes.

```typescript
const { self, peers } = usePresence(handle)
```

**Returns:** `{ self: P | undefined, peers: Map<string, P> }`

### `useRepo()`

Returns the Repo instance from context.

```typescript
const repo = useRepo()
const myPeerId = repo.identity.peerId
```

## Fine-Grained Reactivity with Selectors

Use selectors to prevent unnecessary re-renders:

```tsx
function TodoCount() {
  const handle = useHandle("todos", TodoSchema)
  
  // Only re-renders when the count changes
  const count = useDoc(handle, d => d.todos.length)
  
  return <span>Total: {count}</span>
}

function TodoTitle() {
  const handle = useHandle("todos", TodoSchema)
  
  // Only re-renders when the title changes
  const title = useDoc(handle, d => d.title)
  
  return <h1>{title}</h1>
}
```

## Presence

Presence allows you to share ephemeral state (like cursors, selections, or user status) with other connected users.

```tsx
const PresenceSchema = Shape.plain.object({
  cursor: Shape.plain.object({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
  name: Shape.plain.string().placeholder("Anonymous"),
  isTyping: Shape.plain.boolean(),
})

function CollaborativeEditor() {
  const handle = useHandle("doc", DocSchema, { presence: PresenceSchema })
  const { self, peers } = useEphemeral(handle.presence)

  // Update cursor position
  const handleMouseMove = (e: MouseEvent) => {
    handle.presence.setSelf({
      cursor: { x: e.clientX, y: e.clientY }
    })
  }

  // Show other users' cursors
  return (
    <div onMouseMove={handleMouseMove}>
      {Array.from(peers.entries()).map(([peerId, presence]) => (
        <Cursor
          key={peerId}
          x={presence.cursor.x}
          y={presence.cursor.y}
          name={presence.name}
        />
      ))}
    </div>
  )
}
```

## Setting Up the Repo

```tsx
import { RepoProvider } from "@loro-extended/react"
import { InMemoryStorageAdapter } from "@loro-extended/repo"
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client"

const config = {
  identity: { name: "user-1", type: "user" },
  adapters: [
    new InMemoryStorageAdapter(),
    new SseClientNetworkAdapter({
      postUrl: () => "/sync/post",
      eventSourceUrl: (peerId) => `/sync/subscribe?peerId=${peerId}`,
    }),
  ],
}

function App() {
  return (
    <RepoProvider config={config}>
      <YourApp />
    </RepoProvider>
  )
}
```

## Sync Status

Check the document's sync status using `readyStates`:

```tsx
function SyncStatus() {
  const handle = useHandle("doc", DocSchema)
  
  const isConnected = handle.readyStates.some(
    s => s.state === "loaded" && s.channels.some(c => c.kind === "network")
  )

  return (
    <div className={isConnected ? "connected" : "disconnected"}>
      {isConnected ? "Connected" : "Offline"}
    </div>
  )
}
```

## TypeScript Support

Full type inference from your schemas:

```typescript
const DocSchema = Shape.doc({
  title: Shape.text(),
  count: Shape.counter(),
})

const handle = useHandle("doc", DocSchema)
const doc = useDoc(handle)

// doc.title is typed as string
// doc.count is typed as number

handle.change(d => {
  d.title.insert(0, "Hello") // TypedText methods
  d.count.increment(1)       // Counter methods
})
```

## Migration from Previous API

If you're upgrading from the previous `useDocument` API:

**Before:**
```typescript
const [doc, changeDoc, handle] = useDocument(docId, schema)
changeDoc(d => { d.title.update("new") })

const { peers, self, setSelf } = usePresence(docId, PresenceSchema)
setSelf({ cursor: { x: 10, y: 20 } })
```

**After:**
```typescript
const handle = useHandle(docId, schema, { presence: PresenceSchema })
const doc = useDoc(handle)
const { self, peers } = useEphemeral(handle.presence)

handle.change(d => { d.title.update("new") })
handle.presence.setSelf({ cursor: { x: 10, y: 20 } })
```

## Examples

See the example applications for complete implementations:

- [Todo SSE Example](../../examples/todo-sse/) - Basic todo app with SSE sync
- [Todo WebSocket Example](../../examples/todo-websocket/) - Todo app with WebSocket sync
- [Chat Example](../../examples/chat/) - Real-time chat with presence
- [Bumper Cars Example](../../examples/bumper-cars/) - Multiplayer game with presence

## Related Packages

- [`@loro-extended/hooks-core`](../hooks-core/README.md) - Framework-agnostic hook implementations
- [`@loro-extended/change`](../change/README.md) - Schema definitions and typed operations
- [`@loro-extended/repo`](../repo/README.md) - Document synchronization and storage
- Network adapters: `@loro-extended/adapter-sse`, `@loro-extended/adapter-websocket`, `@loro-extended/adapter-webrtc`
- Storage adapters: `@loro-extended/adapter-indexeddb`, `@loro-extended/adapter-leveldb`, `@loro-extended/adapter-postgres`

## Testing

Core hook tests are located in `@loro-extended/hooks-core`. This package provides React-specific bindings that wrap the framework-agnostic hook implementations.

## Requirements

- React 18+
- TypeScript 5+ (recommended)

## License

MIT
