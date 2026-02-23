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
    Shape.struct({
      id: Shape.plain.string(),
      text: Shape.plain.string(),
      completed: Shape.plain.boolean(),
    })
  ),
})

// Define presence (ephemeral state shared between users)
const PresenceSchema = Shape.plain.struct({
  name: Shape.plain.string(),
  cursor: Shape.plain.struct({
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

### 3. Get a Document

Use `repo.get()` to access documents. The document is immediately available:

```typescript
import { sync } from "@loro-extended/repo"

// Get a typed document
const doc = repo.get("my-todo-list", TodoSchema, { 
  presence: PresenceSchema 
})

// The document is ready to use immediately
console.log(doc.toJSON())
// { title: "My Todo List", todos: [] }

// Access sync capabilities
const syncRef = sync(doc)
await syncRef.waitForSync()
```

### 4. Mutate the Document

Mutate directly on refs or use `change()` for batched updates:

```typescript
import { change } from "@loro-extended/change"

// Direct mutation on refs
doc.todos.push({
  id: crypto.randomUUID(),
  text: "Learn Loro Extended",
  completed: false,
})

// Batched mutation with change()
change(doc, draft => {
  draft.todos.push({
    id: crypto.randomUUID(),
    text: "Build something awesome",
    completed: false,
  })
  const todo = draft.todos.get(0)
  if (todo) {
    todo.completed.set(true)
  }
})
```

### 5. Subscribe to Changes

Listen for document changes:

```typescript
import { loro } from "@loro-extended/change"

// Subscribe to all changes
const unsubscribe = loro(doc).subscribe(() => {
  console.log("Document changed:", doc.toJSON())
})

// Clean up when done
unsubscribe()
```

## React Integration

For React applications, use the provided hooks:

```tsx
import { Shape, change } from "@loro-extended/change"
import { sync } from "@loro-extended/repo"
import { useDocument, useValue, useEphemeral, RepoProvider } from "@loro-extended/react"

function TodoApp() {
  // Get a typed document (stable reference)
  const doc = useDocument("my-todos", TodoSchema, { presence: PresenceSchema })
  
  // Subscribe to document changes
  const snapshot = useValue(doc)
  
  // Subscribe to presence
  const { self, peers } = useEphemeral(sync(doc).presence)

  const addTodo = (text: string) => {
    doc.todos.push({
      id: crypto.randomUUID(),
      text,
      completed: false,
    })
  }

  return (
    <div>
      <h1>{snapshot.title}</h1>
      <ul>
        {snapshot.todos.map((todo, i) => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => {
                const t = doc.todos.get(i)
                if (t) t.completed = !t.completed
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
import { sync } from "@loro-extended/repo"

const syncRef = sync(doc)

// Update your presence
syncRef.presence.setSelf({
  name: "Alice",
  cursor: { x: 100, y: 200 },
})

// In React, use useEphemeral
const { self, peers } = useEphemeral(sync(doc).presence)

// self: your own presence state
// peers: Map<peerId, presence> of other users
```

## Waiting for Sync

Documents are immediately available, but you can wait for specific sync states:

```typescript
import { sync } from "@loro-extended/repo"

const syncRef = sync(doc)

// Wait for sync to complete
await syncRef.waitForSync()

// Check ready states
console.log(syncRef.readyStates)
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