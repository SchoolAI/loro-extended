# @loro-extended/repo

The synchronization engine for building local-first applications with [Loro](https://github.com/loro-dev/loro). This package manages document lifecycle, network synchronization, storage persistence, and real-time presence.

## Installation

```bash
npm install @loro-extended/repo
# or
pnpm add @loro-extended/repo
```

## Quick Start

```typescript
import { Repo, Shape, sync } from "@loro-extended/repo";
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client";
import { IndexedDBStorageAdapter } from "@loro-extended/adapter-indexeddb";

// 1. Define your document schema
const TodoSchema = Shape.doc({
  title: Shape.text(),
  todos: Shape.list(
    Shape.plain.struct({
      id: Shape.plain.string(),
      text: Shape.plain.string(),
      done: Shape.plain.boolean(),
    })
  ),
});

// 2. Define ephemeral stores (optional)
const PresenceSchema = Shape.plain.struct({
  cursor: Shape.plain.struct({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
  name: Shape.plain.string(),
});

// 3. Create adapters
const network = new SseClientNetworkAdapter({
  postUrl: "/api/sync",
  eventSourceUrl: (peerId) => `/api/events?peerId=${peerId}`,
});
const storage = new IndexedDBStorageAdapter();

// 4. Create the Repo
const repo = new Repo({
  adapters: [network, storage],
  identity: { name: "my-app", type: "user" },
});

// 5. Get a typed document (Doc<D>)
const doc = repo.get("my-todos", TodoSchema, { presence: PresenceSchema });

// 6. Make type-safe mutations directly on the doc
doc.title.insert(0, "My Todo List");
doc.todos.push({
  id: crypto.randomUUID(),
  text: "Learn Loro",
  done: false,
});

// 7. Access sync capabilities via sync()
sync(doc).presence.setSelf({ cursor: { x: 100, y: 200 }, name: "Alice" });
await sync(doc).waitForSync();

// 8. Read current state
console.log(doc.toJSON());
// { title: "My Todo List", todos: [{ id: "...", text: "Learn Loro", done: false }] }
```

## Core Concepts

### The Doc-First API

The `repo.get()` method returns a `Doc<D>` - a typed document you can read and mutate directly:

```typescript
const doc = repo.get("doc-id", MySchema);

// Direct mutations (no .doc property needed)
doc.title.insert(0, "Hello");
doc.count.increment(5);
doc.items.push({ id: "1", name: "Item" });

// Read values
const snapshot = doc.toJSON();
```

### The `sync()` Function

Sync/network capabilities are accessed via the `sync()` function. This keeps the common case simple while providing full access to sync infrastructure when needed:

```typescript
import { sync } from "@loro-extended/repo";

const doc = repo.get("doc-id", MySchema, { presence: PresenceSchema });

// Access sync capabilities
sync(doc).peerId              // Your peer ID
sync(doc).docId               // Document ID  
sync(doc).readyStates         // Sync status with peers
sync(doc).loroDoc             // Raw LoroDoc for advanced use

// Wait for sync
await sync(doc).waitForSync()
await sync(doc).waitForSync({ kind: "storage" })
await sync(doc).waitForSync({ kind: "network", timeout: 5000 })

// Ephemeral stores (presence, cursors, etc.)
sync(doc).presence.setSelf({ cursor: { x: 100, y: 200 }, name: "Alice" })
sync(doc).presence.self       // Your presence value
sync(doc).presence.peers      // Map<peerId, presence>

// Subscribe to ready state changes
sync(doc).onReadyStateChange((readyStates) => {
  console.log("Sync status:", readyStates);
});
```

### Document Caching

`repo.get()` caches documents by ID. Multiple calls return the same instance:

```typescript
const doc1 = repo.get("my-doc", MySchema);
const doc2 = repo.get("my-doc", MySchema);
doc1 === doc2; // true - same instance

// Schema mismatch throws an error
repo.get("my-doc", DifferentSchema); // Error!
```

This makes it safe to call `repo.get()` without memoization in React components.

## Repo

The `Repo` class is the central orchestrator. It manages document lifecycle, coordinates adapters, and provides the main API.

```typescript
import { Repo } from "@loro-extended/repo";

// Minimal - all parameters are optional
const repo = new Repo();

// With configuration
const repo = new Repo({
  adapters: [networkAdapter, storageAdapter],
  identity: {
    name: "my-peer",           // Optional: human-readable name
    type: "user",              // Optional: "user" | "bot" | "service"
    peerId: "123456789",       // Optional: auto-generated if not provided
  },
  permissions: {
    visibility: (doc, peer) => true,   // Can peer see this doc?
    mutability: (doc, peer) => true,   // Can peer mutate this doc?
    deletion: (doc, peer) => true,     // Can peer delete this doc?
  },
});
```

### Repo Methods

```typescript
// Get a typed document
const doc = repo.get("doc-id", DocSchema);
const doc = repo.get("doc-id", DocSchema, { presence: PresenceSchema });

// Check if a document exists
repo.has("doc-id"); // boolean

// Delete a document
await repo.delete("doc-id");

// Flush pending storage writes
await repo.flush();

// Graceful shutdown (flush + disconnect)
await repo.shutdown();

// Reset (disconnect adapters, clear state)
repo.reset();

// Dynamic adapter management
await repo.addAdapter(adapter);
await repo.removeAdapter(adapterId);
repo.hasAdapter(adapterId);
repo.getAdapter(adapterId);
repo.adapters; // All current adapters
```

## Presence (Ephemeral State)

Real-time ephemeral state for collaboration features:

```typescript
const PresenceSchema = Shape.plain.struct({
  cursor: Shape.plain.struct({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
  name: Shape.plain.string(),
  status: Shape.plain.string(),
});

const doc = repo.get("doc-id", DocSchema, { presence: PresenceSchema });

// Set your presence
sync(doc).presence.setSelf({ 
  cursor: { x: 100, y: 200 }, 
  name: "Alice",
  status: "online",
});

// Read your presence
console.log(sync(doc).presence.self);

// Read other peers' presence
for (const [peerId, presence] of sync(doc).presence.peers) {
  console.log(`${peerId}: ${presence.name} at (${presence.cursor.x}, ${presence.cursor.y})`);
}

// Subscribe to presence changes
sync(doc).presence.subscribe(({ key, value, source }) => {
  console.log(`Peer ${key} updated:`, value, `(source: ${source})`);
});
```

### Multiple Ephemeral Stores

Declare multiple stores for bandwidth isolation:

```typescript
const doc = repo.get("doc-id", DocSchema, {
  mouse: MouseSchema,      // High-frequency updates
  profile: ProfileSchema,  // Low-frequency updates
});

sync(doc).mouse.setSelf({ x: 100, y: 200 });
sync(doc).profile.setSelf({ name: "Alice", avatar: "..." });
```

## Adapters

Adapters provide pluggable network and storage implementations.

### Network Adapters

| Package | Description | Use Case |
|---------|-------------|----------|
| [`@loro-extended/adapter-sse`](../../adapters/sse) | Server-Sent Events | Client-server sync |
| [`@loro-extended/adapter-websocket`](../../adapters/websocket) | WebSocket | Real-time bidirectional |
| [`@loro-extended/adapter-webrtc`](../../adapters/webrtc) | WebRTC | Peer-to-peer (no server) |
| [`@loro-extended/adapter-http-polling`](../../adapters/http-polling) | HTTP Polling | Restricted environments |

### Storage Adapters

| Package | Description | Use Case |
|---------|-------------|----------|
| [`@loro-extended/adapter-indexeddb`](../../adapters/indexeddb) | IndexedDB | Browser persistence |
| [`@loro-extended/adapter-leveldb`](../../adapters/leveldb) | LevelDB | Node.js persistence |
| [`@loro-extended/adapter-postgres`](../../adapters/postgres) | PostgreSQL | Production database |

### Built-in Adapters

```typescript
import { InMemoryStorageAdapter, BridgeAdapter, Bridge } from "@loro-extended/repo";

// In-memory storage (for testing)
const storage = new InMemoryStorageAdapter();

// Bridge adapter (for testing multi-peer scenarios)
const bridge = new Bridge();
const repo1 = new Repo({ adapters: [new BridgeAdapter({ bridge })] });
const repo2 = new Repo({ adapters: [new BridgeAdapter({ bridge })] });
```

### Multi-Adapter Setup

```typescript
import { Repo } from "@loro-extended/repo";
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client";
import { WebRTCAdapter } from "@loro-extended/adapter-webrtc";
import { IndexedDBStorageAdapter } from "@loro-extended/adapter-indexeddb";

const repo = new Repo({
  adapters: [
    // Server sync
    new SseClientNetworkAdapter({
      postUrl: "/sync",
      eventSourceUrl: (id) => `/events?id=${id}`,
    }),
    // Peer-to-peer fallback
    new WebRTCAdapter({ signaling: signalingChannel }),
    // Offline persistence
    new IndexedDBStorageAdapter(),
  ],
});
```

## Waiting for Sync

Use `sync(doc).waitForSync()` to wait for synchronization:

```typescript
const doc = repo.get("doc-id", DocSchema);

// Wait for network sync (default)
await sync(doc).waitForSync();

// Wait for storage sync
await sync(doc).waitForSync({ kind: "storage" });

// With timeout
await sync(doc).waitForSync({ timeout: 5000 });

// With abort signal
const controller = new AbortController();
await sync(doc).waitForSync({ signal: controller.signal });
```

### InitializeIfEmpty Pattern

```typescript
const doc = repo.get("doc-id", DocSchema);

// Wait for sync to know if doc exists on server
await sync(doc).waitForSync({ kind: "storage" });

// Check if doc is empty (new)
if (sync(doc).loroDoc.opCount() === 0) {
  // Initialize with default values
  doc.title.insert(0, "New Document");
  doc.items.push({ id: "1", name: "First Item" });
}
```

## Permission System

Control document access with permissions:

```typescript
const repo = new Repo({
  adapters: [network, storage],
  permissions: {
    // Control document visibility
    visibility: (doc, peer) => {
      return doc.id.startsWith("public/") || peer.peerType === "service";
    },
    
    // Control who can mutate
    mutability: (doc, peer) => {
      return peer.peerType !== "bot";
    },
    
    // Control who can delete
    deletion: (doc, peer) => {
      return peer.peerType === "service";
    },
  },
});
```

## TypeScript Support

Full type inference from schemas:

```typescript
const DocSchema = Shape.doc({
  title: Shape.text(),
  count: Shape.counter(),
  items: Shape.list(Shape.plain.string()),
});

const doc = repo.get("doc-id", DocSchema);

// All mutations are type-safe
doc.title.insert(0, "Hello");     // OK
doc.count.increment(1);           // OK
doc.items.push("new item");       // OK

// Type errors caught at compile time
doc.title.increment(1);           // Error: increment doesn't exist on TextRef
doc.count.insert(0, "x");         // Error: insert doesn't exist on CounterRef
```

## Removed in v6

The following APIs were removed in v6. If upgrading from v5, use the replacements shown:

| Removed | Replacement |
|---------|-------------|
| `repo.getHandle(id, schema)` | `repo.get(id, schema)` |
| `handle.doc.field` | `doc.field` (direct access) |
| `handle.waitForSync()` | `sync(doc).waitForSync()` |
| `handle.presence` | `sync(doc).presence` |
| `Handle<D, E>` type | `Doc<D, E>` + `sync()` |

## Logging

Uses [@logtape/logtape](https://github.com/dahlia/logtape) for structured logging:

```typescript
import { configure, getConsoleSink } from "@logtape/logtape";

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: ["@loro-extended"], level: "debug", sinks: ["console"] },
  ],
});
```

## Related Packages

- [`@loro-extended/react`](../react/README.md) - React hooks (`useDocument`, `useValue`)
- [`@loro-extended/hooks-core`](../hooks-core/README.md) - Framework-agnostic hooks
- [`@loro-extended/change`](../change/README.md) - Schema definitions and typed operations

## License

MIT