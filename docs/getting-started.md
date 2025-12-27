# Getting Started with Loro Extended

This guide will help you build your first real-time collaborative application with Loro Extended.

## What is Loro Extended?

Loro Extended is a toolkit for building local-first, real-time collaborative applications using [Loro CRDT](https://loro.dev). It provides:

- **Schema-driven documents** - Type-safe document definitions with automatic conflict resolution
- **Sync infrastructure** - Network and storage adapters for seamless data synchronization
- **React/Hono hooks** - Reactive UI bindings for building collaborative interfaces
- **Presence system** - Share ephemeral state like cursors and user status

## Installation

```bash
# Core packages
npm install @loro-extended/repo @loro-extended/change loro-crdt

# For React applications
npm install @loro-extended/react

# For Hono applications
npm install @loro-extended/hono
```

## Quick Start

### 1. Define Your Schema

Schemas define the structure of your collaborative documents using the `Shape` API:

```typescript
import { Shape } from "@loro-extended/change"

// Define a todo list document
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

// Define presence (ephemeral state shared between users)
const PresenceSchema = Shape.plain.object({
  name: Shape.plain.string(),
  cursor: Shape.plain.object({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
})
```

### 2. Create a Repo

The `Repo` manages document lifecycle, storage, and network synchronization:

```typescript
import { Repo } from "@loro-extended/repo"
import { InMemoryStorageAdapter } from "@loro-extended/repo"

const repo = new Repo({
  identity: { name: "user-1", type: "user" },
  adapters: [
    new InMemoryStorageAdapter(),
    // Add network adapters for real-time sync
  ],
})
```

### 3. Get a Document Handle

Use `repo.get()` to access documents. The handle is immediately available:

```typescript
// Get a typed handle
const handle = repo.get("my-todo-list", TodoSchema, { 
  presence: PresenceSchema 
})

// The document is ready to use immediately
console.log(handle.doc.toJSON())
// { title: "My Todo List", todos: [] }
```

### 4. Mutate the Document

Use `handle.change()` to make mutations:

```typescript
// Add a todo
handle.change(draft => {
  draft.todos.push({
    id: crypto.randomUUID(),
    text: "Learn Loro Extended",
    completed: false,
  })
})

// Toggle completion
handle.change(draft => {
  const todo = draft.todos.get(0)
  if (todo) {
    todo.completed = !todo.completed
  }
})
```

### 5. Subscribe to Changes

Listen for document changes:

```typescript
// Subscribe to all changes
const unsubscribe = handle.subscribe(() => {
  console.log("Document changed:", handle.doc.toJSON())
})

// Subscribe to specific paths
handle.subscribe(
  p => p.todos.$each.completed,
  (completedStates) => {
    console.log("Completion states:", completedStates)
  }
)
```

## React Integration

For React applications, use the provided hooks:

```tsx
import { Shape, useHandle, useDoc, useEphemeral, RepoProvider } from "@loro-extended/react"

function TodoApp() {
  // Get a stable handle (never re-renders)
  const handle = useHandle("my-todos", TodoSchema, { presence: PresenceSchema })
  
  // Subscribe to document changes
  const doc = useDoc(handle)
  
  // Subscribe to presence
  const { self, peers } = useEphemeral(handle.presence)

  const addTodo = (text: string) => {
    handle.change(draft => {
      draft.todos.push({
        id: crypto.randomUUID(),
        text,
        completed: false,
      })
    })
  }

  return (
    <div>
      <h1>{doc.title}</h1>
      <ul>
        {doc.todos.map((todo, i) => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => {
                handle.change(d => {
                  const t = d.todos.get(i)
                  if (t) t.completed = !t.completed
                })
              }}
            />
            {todo.text}
          </li>
        ))}
      </ul>
      <button onClick={() => addTodo("New Todo")}>Add Todo</button>
    </div>
  )
}

// Wrap your app with RepoProvider
function App() {
  return (
    <RepoProvider config={{
      identity: { name: "user-1", type: "user" },
      adapters: [new InMemoryStorageAdapter()],
    }}>
      <TodoApp />
    </RepoProvider>
  )
}
```

## Adding Network Sync

To enable real-time collaboration, add a network adapter:

### Server-Sent Events (SSE)

```typescript
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client"

const repo = new Repo({
  identity: { name: "user-1", type: "user" },
  adapters: [
    new InMemoryStorageAdapter(),
    new SseClientNetworkAdapter({
      postUrl: () => "/api/sync/post",
      eventSourceUrl: (peerId) => `/api/sync/subscribe?peerId=${peerId}`,
    }),
  ],
})
```

### WebSocket

```typescript
import { WebSocketClientAdapter } from "@loro-extended/adapter-websocket"

const repo = new Repo({
  identity: { name: "user-1", type: "user" },
  adapters: [
    new InMemoryStorageAdapter(),
    new WebSocketClientAdapter("wss://your-server.com/sync"),
  ],
})
```

## Adding Persistence

To persist documents locally:

### IndexedDB (Browser)

```typescript
import { IndexedDBStorageAdapter } from "@loro-extended/adapter-indexeddb"

const repo = new Repo({
  identity: { name: "user-1", type: "user" },
  adapters: [
    new IndexedDBStorageAdapter({ dbName: "my-app" }),
    // ... network adapters
  ],
})
```

### LevelDB (Node.js)

```typescript
import { LevelDBStorageAdapter } from "@loro-extended/adapter-leveldb"

const repo = new Repo({
  identity: { name: "server", type: "server" },
  adapters: [
    new LevelDBStorageAdapter({ path: "./data" }),
    // ... network adapters
  ],
})
```

## Presence (Ephemeral State)

Share transient state like cursors or user status:

```typescript
// Update your presence
handle.presence.setSelf({
  name: "Alice",
  cursor: { x: 100, y: 200 },
})

// Read others' presence
const { self, peers } = useEphemeral(handle.presence)

// self: your own presence state
// peers: Map<peerId, presence> of other users
```

## Waiting for Sync

Documents are immediately available, but you can wait for specific sync states:

```typescript
// Wait for storage to load
await handle.waitForStorage()

// Wait for network sync
await handle.waitForNetwork()

// Custom readiness check
await handle.waitUntilReady(readyStates =>
  readyStates.some(s => s.state === "loaded")
)
```

## Next Steps

- [@loro-extended/change README](../packages/change/README.md) - Learn about all Shape types
- [Rules System](./rules.md) - Access control for document sync
- [Repo Architecture](./repo-architecture.md) - Understand the sync system
- [Creating Adapters](./creating-adapters.md) - Build custom adapters
- [Presence System](./presence.md) - Deep dive into ephemeral state
- [Examples](../README.md#-examples) - See complete applications

## Example Applications

- **[Todo SSE](../examples/todo-sse/)** - Basic todo app with SSE sync
- **[Hono Counter](../examples/hono-counter/)** - Counter app with Hono JSX
- **[Chat](../examples/chat/)** - Real-time chat with presence
- **[Video Conference](../examples/video-conference/)** - WebRTC-based collaboration
