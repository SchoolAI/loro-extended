# @loro-extended/react

React hooks for building real-time collaborative applications with [Loro CRDT](https://github.com/loro-dev/loro) documents.

## What This Package Does

This package provides React-specific bindings for Loro CRDT documents with a **doc-first pattern**:

- **`useDocument`** - Get a typed document directly
- **`useValue`** - Subscribe to document or ref value changes
- **`sync(doc)`** - Access sync/network capabilities when needed

### Key Features

- **Direct Document Access** - No handle intermediary, work with docs directly
- **Fine-Grained Reactivity** - Subscribe to specific refs or whole documents
- **Type Safety** - Full TypeScript support with schema-driven type inference
- **Clean Separation** - Document mutations are separate from sync infrastructure

## Installation

```bash
npm install @loro-extended/react @loro-extended/change @loro-extended/repo loro-crdt
# or
pnpm add @loro-extended/react @loro-extended/change @loro-extended/repo loro-crdt
```

## Quick Start

```tsx
import { Shape, useDocument, useValue, RepoProvider, sync } from "@loro-extended/react"
import type { RepoParams } from "@loro-extended/repo"

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

// Define presence schema (optional)
const PresenceSchema = Shape.plain.struct({
  cursor: Shape.plain.struct({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
  name: Shape.plain.string(),
})

function TodoApp() {
  // Get the document directly
  const doc = useDocument("todo-doc", TodoSchema, { presence: PresenceSchema })
  
  // Subscribe to values reactively
  const title = useValue(doc.title)
  const todos = useValue(doc.todos)
  
  // Subscribe to presence via sync()
  const { self, peers } = useEphemeral(sync(doc).presence)

  const addTodo = (text: string) => {
    // Mutate directly on the doc
    doc.todos.push({
      id: Date.now().toString(),
      text,
      completed: false,
    })
  }

  const toggleTodo = (index: number) => {
    const todo = doc.todos.get(index)
    if (todo) {
      todo.completed = !todo.completed
    }
  }

  return (
    <div>
      <h1>{title}</h1>
      
      {/* Show connected users */}
      <div>
        Online: {self?.name}, {Array.from(peers.values()).map(p => p.name).join(", ")}
      </div>

      {todos.map((todo, index) => (
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

## Core Hooks

### `useDocument(docId, schema, ephemeral?)`

Returns a `Doc<D>` for the given document. The doc is cached by the Repo, so multiple calls return the same instance.

```typescript
// Basic usage
const doc = useDocument("my-doc", MySchema)

// With ephemeral stores (presence, cursors, etc.)
const doc = useDocument("my-doc", MySchema, { presence: PresenceSchema })
```

**Parameters:**
- `docId: string` - The document identifier
- `schema: DocShape` - The document schema
- `ephemeral?: Record<string, ValueShape>` - Optional ephemeral store declarations

**Returns:** `Doc<D>` - A typed document you can read and mutate directly

### `useValue(refOrDoc)`

Subscribes to value changes and returns the current value directly.

```typescript
// Subscribe to a specific ref
const title = useValue(doc.title)      // string
const count = useValue(doc.count)      // number
const todos = useValue(doc.todos)      // array

// Subscribe to whole document
const snapshot = useValue(doc)         // Infer<D>
```

**Parameters:**
- `refOrDoc` - A typed ref (TextRef, ListRef, etc.) or a Doc

**Returns:** The current value (re-renders when it changes)

### `usePlaceholder(ref)`

Returns the placeholder value for a ref (if defined in the schema).

```typescript
const placeholder = usePlaceholder(doc.title)  // "Untitled" or undefined
```

**Parameters:**
- `ref` - A typed ref

**Returns:** The placeholder value or `undefined`

### `useEphemeral(ephemeral)`

Subscribes to ephemeral store changes (presence, cursors, etc.).

```typescript
const doc = useDocument("my-doc", MySchema, { presence: PresenceSchema })
const { self, peers } = useEphemeral(sync(doc).presence)

// Update your presence
sync(doc).presence.setSelf({ cursor: { x: 100, y: 200 } })
```

**Parameters:**
- `ephemeral: TypedEphemeral<T>` - An ephemeral store from `sync(doc)`

**Returns:** `{ self: T | undefined, peers: Map<string, T> }`

### `useRepo()`

Returns the Repo instance from context.

```typescript
const repo = useRepo()
const myPeerId = repo.identity.peerId
await repo.delete("old-doc")
```

## The `sync()` Function

The `sync()` function provides access to sync/network capabilities. This is intentionally separate from the document to keep the common case simple.

```typescript
import { sync } from "@loro-extended/react"

const doc = useDocument("my-doc", MySchema, { presence: PresenceSchema })

// Access sync capabilities
sync(doc).peerId              // Your peer ID
sync(doc).docId               // Document ID
sync(doc).readyStates         // Sync status with peers
sync(doc).loroDoc             // Raw LoroDoc for advanced use

// Wait for sync
await sync(doc).waitForSync()
await sync(doc).waitForSync({ kind: "storage" })

// Ephemeral stores
sync(doc).presence.setSelf({ ... })
sync(doc).presence.self
sync(doc).presence.peers
```

## Direct Mutations

With the doc-first API, you mutate documents directly:

```typescript
const doc = useDocument("my-doc", MySchema)

// Text operations
doc.title.insert(0, "Hello")
doc.title.delete(0, 5)
doc.title.update("New Title")

// Counter operations
doc.count.increment(1)
doc.count.decrement(1)

// List operations
doc.todos.push({ id: "1", text: "Task", completed: false })
doc.todos.insert(0, { ... })
doc.todos.delete(0)

// Struct operations
doc.settings.theme = "dark"
```

## Fine-Grained Reactivity

Use `useValue` on specific refs to minimize re-renders:

```tsx
function TodoCount() {
  const doc = useDocument("todos", TodoSchema)
  
  // Only re-renders when todos change (not title)
  const todos = useValue(doc.todos)
  
  return <span>Total: {todos.length}</span>
}

function TodoTitle() {
  const doc = useDocument("todos", TodoSchema)
  
  // Only re-renders when title changes (not todos)
  const title = useValue(doc.title)
  
  return <h1>{title}</h1>
}
```

## Presence

Share ephemeral state with other connected users:

```tsx
const PresenceSchema = Shape.plain.struct({
  cursor: Shape.plain.struct({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
  name: Shape.plain.string(),
})

function CollaborativeEditor() {
  const doc = useDocument("doc", DocSchema, { presence: PresenceSchema })
  const { self, peers } = useEphemeral(sync(doc).presence)

  const handleMouseMove = (e: MouseEvent) => {
    sync(doc).presence.setSelf({
      cursor: { x: e.clientX, y: e.clientY },
      name: "Alice",
    })
  }

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

## TypeScript Support

Full type inference from your schemas:

```typescript
const DocSchema = Shape.doc({
  title: Shape.text(),
  count: Shape.counter(),
  items: Shape.list(Shape.plain.string()),
})

const doc = useDocument("doc", DocSchema)

// Types are inferred
const title = useValue(doc.title)   // string
const count = useValue(doc.count)   // number
const items = useValue(doc.items)   // string[]

// Mutations are type-safe
doc.title.insert(0, "Hello")        // OK
doc.count.increment(1)              // OK
doc.items.push("new item")          // OK
```

## Removed in v6

The following APIs were removed in v6. If upgrading from v5, use the replacements shown:

| Removed | Replacement |
|---------|-------------|
| `useHandle(docId, schema)` | `useDocument(docId, schema)` |
| `useDoc(handle)` | `useValue(doc)` |
| `useRefValue(ref)` | `useValue(ref)` + `usePlaceholder(ref)` |
| `handle.doc.field` | `doc.field` (direct access) |
| `handle.waitForSync()` | `sync(doc).waitForSync()` |
| `handle.presence` | `sync(doc).presence` |

## Examples

See the example applications for complete implementations:

- [Todo SSE Example](../../examples/todo-sse/) - Basic todo app with SSE sync
- [Todo WebSocket Example](../../examples/todo-websocket/) - Todo app with WebSocket sync
- [Chat Example](../../examples/chat/) - Real-time chat with presence
- [RPS Demo](../../examples/rps-demo/) - Multiplayer game with presence

## Related Packages

- [`@loro-extended/hooks-core`](../hooks-core/README.md) - Framework-agnostic hook implementations
- [`@loro-extended/change`](../change/README.md) - Schema definitions and typed operations
- [`@loro-extended/repo`](../repo/README.md) - Document synchronization and storage
- Network adapters: `@loro-extended/adapter-sse`, `@loro-extended/adapter-websocket`, `@loro-extended/adapter-webrtc`
- Storage adapters: `@loro-extended/adapter-indexeddb`, `@loro-extended/adapter-leveldb`, `@loro-extended/adapter-postgres`

## Requirements

- React 18+
- TypeScript 5+ (recommended)

## License

MIT