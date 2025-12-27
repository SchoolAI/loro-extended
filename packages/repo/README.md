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
import { Repo, Shape } from "@loro-extended/repo";
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

// 2. Define your ephemeral declarations (optional)
const EphemeralDeclarations = {
  presence: Shape.plain.struct({
    cursor: Shape.plain.struct({
      x: Shape.plain.number(),
      y: Shape.plain.number(),
    }),
    name: Shape.plain.string().placeholder("Anonymous"),
  }),
};

// 3. Create adapters
const network = new SseClientNetworkAdapter({
  postUrl: "/api/sync",
  eventSourceUrl: (peerId) => `/api/events?peerId=${peerId}`,
});
const storage = new IndexedDBStorageAdapter();

// 4. Create the Repo (identity and adapters are optional)
const repo = new Repo({
  adapters: [network, storage],
  identity: { name: "my-app", type: "user" }, // Optional - defaults provided
});

// 5. Get a typed document handle
const handle = repo.get("my-todos", TodoSchema, EphemeralDeclarations);

// 6. Make type-safe mutations
handle.change((draft) => {
  draft.title.insert(0, "My Todo List");
  draft.todos.push({
    id: crypto.randomUUID(),
    text: "Learn Loro",
    done: false,
  });
});

// 7. Use presence for real-time collaboration
handle.presence.setSelf({ cursor: { x: 100, y: 200 }, name: "Alice" });

// 8. Read current state
console.log(handle.doc.toJSON());
// { title: "My Todo List", todos: [{ id: "...", text: "Learn Loro", done: false }] }
```

## Core Concepts

### Repo

The `Repo` class is the central orchestrator. It manages document lifecycle, coordinates adapters, and provides the main API for document operations.

```typescript
import { Repo } from "@loro-extended/repo";

// Minimal - all parameters are optional
const repo = new Repo();

// With configuration
const repo = new Repo({
  adapters: [networkAdapter, storageAdapter], // Optional - defaults to []
  identity: {
    name: "my-peer", // Optional - human-readable name
    type: "user", // Optional - defaults to "user" ("user" | "bot" | "service")
    peerId: "123456789", // Optional - auto-generated if not provided
  },
  rules: {
    // Optional: permission rules
    canReveal: (ctx) => true,
    canUpdate: (ctx) => true,
    canDelete: (ctx) => true,
  },
});

// Add adapters dynamically
await repo.addAdapter(networkAdapter);

// Remove adapters at runtime
await repo.removeAdapter(networkAdapter.adapterId);
```

### Document Handles

Get typed document handles with `repo.get()`. Documents are immediately available—no loading states required.

```typescript
// Get a typed handle with doc and ephemeral schemas
const handle = repo.get("doc-id", DocSchema, { presence: PresenceSchema });

// Access the typed document
handle.doc.title.insert(0, "Hello"); // Direct mutations (auto-commit)
handle.doc.count.increment(5);

// Batch mutations for atomic operations
handle.change((draft) => {
  draft.title.insert(0, "Batched: ");
  draft.count.increment(10);
});

// Get JSON snapshot
const snapshot = handle.doc.toJSON();
```

### Presence (Ephemeral State)

Real-time ephemeral state for collaboration features like cursors, selections, and user status.

```typescript
const PresenceSchema = Shape.plain.struct({
  cursor: Shape.plain.struct({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
  name: Shape.plain.string().placeholder("Anonymous"),
  status: Shape.plain.string().placeholder("online"),
});

const handle = repo.get("doc-id", DocSchema, { presence: PresenceSchema });

// Set your presence
handle.presence.setSelf({ cursor: { x: 100, y: 200 }, name: "Alice" });

// Read your presence (with placeholder defaults)
console.log(handle.presence.self);
// { cursor: { x: 100, y: 200 }, name: "Alice", status: "online" }

// Read other peers' presence
for (const [peerId, presence] of handle.presence.peers) {
  console.log(
    `${peerId}: ${presence.name} at (${presence.cursor.x}, ${presence.cursor.y})`
  );
}

// Subscribe to presence changes
handle.presence.subscribe(({ key, value, source }) => {
  console.log(`Peer ${key} updated:`, value, `(source: ${source})`);
});
```

### Multiple Ephemeral Stores

You can declare multiple ephemeral stores for bandwidth isolation:

```typescript
const handle = repo.get("doc-id", DocSchema, {
  mouse: MouseShape,      // High-frequency updates
  profile: ProfileShape,  // Low-frequency updates
});

handle.mouse.setSelf({ x: 100, y: 200 });
handle.profile.setSelf({ name: "Alice", avatar: "..." });
```

## Adapters

Adapters provide pluggable network and storage implementations. Mix and match to fit your architecture.

### Network Adapters

| Package                                                              | Description          | Use Case                                |
| -------------------------------------------------------------------- | -------------------- | --------------------------------------- |
| [`@loro-extended/adapter-sse`](../../adapters/sse)                   | Server-Sent Events   | Client-server sync with Express/Node.js |
| [`@loro-extended/adapter-websocket`](../../adapters/websocket)       | WebSocket            | Real-time bidirectional sync            |
| [`@loro-extended/adapter-webrtc`](../../adapters/webrtc)             | WebRTC Data Channels | Peer-to-peer sync (no server required)  |
| [`@loro-extended/adapter-http-polling`](../../adapters/http-polling) | HTTP Long-Polling    | Fallback for restricted environments    |

### Storage Adapters

| Package                                                        | Description | Use Case                    |
| -------------------------------------------------------------- | ----------- | --------------------------- |
| [`@loro-extended/adapter-indexeddb`](../../adapters/indexeddb) | IndexedDB   | Browser-based persistence   |
| [`@loro-extended/adapter-leveldb`](../../adapters/leveldb)     | LevelDB     | Node.js server persistence  |
| [`@loro-extended/adapter-postgres`](../../adapters/postgres)   | PostgreSQL  | Production database storage |

### Built-in Adapters

The repo package includes basic adapters for testing and development:

- **`InMemoryStorageAdapter`** - Stores data in memory (useful for testing)
- **`BridgeAdapter`** - Connects repos in-process (useful for testing multi-peer scenarios)

```typescript
import { InMemoryStorageAdapter } from "@loro-extended/repo";

const storage = new InMemoryStorageAdapter();
const repo = new Repo({
  adapters: [storage],
  identity: { name: "test", type: "user" },
});
```

### Example: Multi-Adapter Setup

Combine adapters for resilient, offline-capable applications:

```typescript
import { Repo } from "@loro-extended/repo";
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client";
import { WebRTCAdapter } from "@loro-extended/adapter-webrtc";
import { IndexedDBStorageAdapter } from "@loro-extended/adapter-indexeddb";

// SSE for server sync + WebRTC for peer-to-peer + IndexedDB for offline
const repo = new Repo({
  adapters: [
    new SseClientNetworkAdapter({
      postUrl: "/sync",
      eventSourceUrl: (id) => `/events?id=${id}`,
    }),
    new WebRTCAdapter({ signaling: signalingChannel }),
    new IndexedDBStorageAdapter(),
  ],
  identity: { name: "hybrid-client", type: "user" },
});
```

## API Reference

### Repo Class

#### Constructor

```typescript
interface RepoParams {
  identity?: {
    name?: string; // Optional: human-readable peer name
    type?: "user" | "bot" | "service"; // Optional: defaults to "user"
    peerId?: string; // Optional: auto-generated if not provided
  };
  adapters?: AnyAdapter[]; // Optional: defaults to []
  rules?: Partial<Rules>; // Optional permission rules
  onUpdate?: HandleUpdateFn; // Optional update callback, for logs/debug
}

// All parameters are optional
const repo = new Repo();
const repo = new Repo(params);
```

#### Methods

```typescript
// Get a typed document handle with ephemeral stores
const handle = repo.get("doc-id", DocSchema, { presence: PresenceSchema });

// Get a typed handle without ephemeral stores
const handle = repo.get("doc-id", DocSchema);

// Check if a document exists
repo.has("doc-id"); // boolean

// Delete a document
await repo.delete("doc-id");

// Reset the repo (disconnect adapters, clear state)
repo.reset();

// Dynamic adapter management
await repo.addAdapter(adapter); // Add adapter at runtime (idempotent)
await repo.removeAdapter(adapterId); // Remove adapter at runtime (idempotent)
repo.hasAdapter(adapterId); // Check if adapter exists
repo.getAdapter(adapterId); // Get adapter by ID
repo.adapters; // Get all current adapters
```

### Handle

The `Handle` provides typed access to documents and ephemeral stores.

#### Properties

```typescript
handle.docId; // string - The document ID
handle.peerId; // string - The local peer ID
handle.doc; // TypedDoc<D> - The typed document
handle.presence; // TypedEphemeral<P> - The typed presence (if declared)
handle.readyStates; // ReadyState[] - Current sync status
```

#### Methods

```typescript
// Batch mutations into a single commit
handle.change((draft) => {
  draft.title.insert(0, "Hello");
  draft.count.increment(5);
});

// Wait for storage to load
await handle.waitForStorage();

// Wait for network sync
await handle.waitForNetwork();

// Custom readiness check
await handle.waitUntilReady((readyStates) => {
  return readyStates.some((s) => s.state === "loaded");
});

// Subscribe to ready state changes
const unsubscribe = handle.onReadyStateChange((readyStates) => {
  console.log("Sync status changed:", readyStates);
});
```

### Subscribing to Document Changes

To react to document changes, subscribe to the underlying LoroDoc:

```typescript
import { getLoroDoc } from "@loro-extended/repo";

// Option 1: Using getLoroDoc helper
const loroDoc = getLoroDoc(handle.doc);
loroDoc.subscribe((event) => {
  console.log("Document changed:", event);
  // Update your UI here
});

// Option 2: Using $ namespace
handle.doc.$.loroDoc.subscribe((event) => {
  console.log("Document changed:", event);
});
```

## Permission System

Control document access with the `Rules` interface:

```typescript
const repo = new Repo({
  adapters: [network, storage],
  identity: { name: "server", type: "service" },
  rules: {
    // Control which documents are revealed to peers
    canReveal: (ctx) => {
      // Always reveal to storage adapters
      if (ctx.channelKind === "storage") return true;
      // Only reveal public documents to network peers
      return ctx.docId.startsWith("public-");
    },

    // Control who can update documents (use peerId or peerType for reliable checks)
    canUpdate: (ctx) => {
      return ctx.peerType === "user" || ctx.peerId === "trusted-service-123";
    },

    // Control who can delete documents
    canDelete: (ctx) => {
      return ctx.peerType === "service" || ctx.peerId === "admin-456";
    },
  },
});
```

### RuleContext

The `RuleContext` provides information about the peer and document:

```typescript
type RuleContext = {
  doc: LoroDoc;
  docId: DocId;
  peerId: PeerID;                        // Unique peer identifier
  peerName?: string;                     // Human-readable name (optional)
  peerType: "user" | "bot" | "service";  // Peer type
  channelId: ChannelId;
  channelKind: "storage" | "network" | "other";
};
```

## Complete Example

A full collaborative todo application:

```typescript
import { Repo, Shape, getLoroDoc } from "@loro-extended/repo";
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client";
import { IndexedDBStorageAdapter } from "@loro-extended/adapter-indexeddb";

// Define schemas
const TodoSchema = Shape.doc({
  todos: Shape.list(
    Shape.plain.struct({
      id: Shape.plain.string(),
      text: Shape.plain.string(),
      completed: Shape.plain.boolean(),
    })
  ),
});

const PresenceSchema = Shape.plain.struct({
  editing: Shape.plain.string().placeholder(""),
  name: Shape.plain.string().placeholder("Anonymous"),
});

// Create repo
const repo = new Repo({
  adapters: [
    new SseClientNetworkAdapter({
      postUrl: "/api/sync",
      eventSourceUrl: (peerId) => `/api/events?peerId=${peerId}`,
    }),
    new IndexedDBStorageAdapter(),
  ],
  identity: { name: "todo-app", type: "user" },
});

// Get handle
const handle = repo.get("main-todos", TodoSchema, { presence: PresenceSchema });

// Wait for storage before displaying
await handle.waitForStorage();

// Add a todo
handle.change((draft) => {
  draft.todos.push({
    id: crypto.randomUUID(),
    text: "Learn about Loro",
    completed: false,
  });
});

// Toggle a todo
handle.change((draft) => {
  const todo = draft.todos.find((t) => t.id === "some-id");
  if (todo) {
    todo.completed = !todo.completed;
  }
});

// Set presence when editing
handle.presence.setSelf({ editing: "some-id", name: "Alice" });

// Subscribe to changes
getLoroDoc(handle.doc).subscribe(() => {
  console.log("Todos updated:", handle.doc.toJSON());
});

// Subscribe to presence
handle.presence.subscribe(({ key, value }) => {
  if (value?.editing) {
    console.log(`${value.name} is editing ${value.editing}`);
  }
});
```

## Architecture

The repo package follows a layered architecture:

```
┌─────────────────────────────────────────┐
│             Application                 │
├─────────────────────────────────────────┤
│                Repo                     │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │  DocHandle  │  │  Synchronizer    │  │
│  └─────────────┘  └──────────────────┘  │
│         │                  │            │
│         │          ┌───────▼────────┐   │
│         │          │ AdapterManager │   │
│         │          └───────┬────────┘   │
│         │                  │            │
│  ┌──────▼──────────────────▼─────────┐  │
│  │         Adapters (via Channels)   │  │
│  │  ┌─────────┐      ┌────────────┐  │  │
│  │  │ Storage │      │  Network   │  │  │
│  │  └─────────┘      └────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

For detailed documentation, see:

- [`repo.md`](./src/repo.md) - System architecture
- [`synchronizer.md`](./src/synchronizer.md) - Sync protocol details
- [`adapter/adapter.md`](./src/adapter/adapter.md) - Adapter system design

## Advanced Usage

### Untyped Document Access

For dynamic schemas or direct LoroDoc access, use `Shape.any()`:

```typescript
// Get a handle with untyped document
const handle = repo.get("doc-id", Shape.any());

// Access the raw LoroDoc via escape hatch
handle.loroDoc.getMap("root").set("key", "value");
handle.loroDoc.commit();

// Or use the doc property (TypedDoc<AnyShape>)
handle.doc.$.loroDoc.getMap("root").set("title", "Hello");
```

### Custom Storage Adapters

Create custom storage by extending `StorageAdapter`:

```typescript
import {
  StorageAdapter,
  type StorageKey,
  type Chunk,
} from "@loro-extended/repo";

class MyStorageAdapter extends StorageAdapter {
  constructor() {
    super({
      adapterType: "my-storage",
      adapterId: "my-storage-instance" // Optional: auto-generated if not provided
    });
  }

  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    // Load data for the given key
  }

  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    // Save data for the given key
  }

  async remove(key: StorageKey): Promise<void> {
    // Remove data for the given key
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    // Load all chunks with the given prefix
  }

  async removeRange(keyPrefix: StorageKey): Promise<void> {
    // Remove all chunks with the given prefix
  }
}
```

### Custom Network Adapters

Create custom network adapters by extending `Adapter`:

```typescript
import { Adapter, type GeneratedChannel } from "@loro-extended/repo";

class MyNetworkAdapter extends Adapter<ConnectionContext> {
  constructor(options: { adapterId?: string }) {
    super({
      adapterType: "my-network",
      adapterId: options.adapterId // Optional: auto-generated if not provided
    });
  }

  protected generate(context: ConnectionContext): GeneratedChannel {
    return {
      kind: "network",
      adapterType: this.adapterType,
      send: (msg) => context.connection.send(JSON.stringify(msg)),
      stop: () => context.connection.close(),
    };
  }

  async onStart(): Promise<void> {
    // Set up connections and call this.addChannel()
  }

  async onStop(): Promise<void> {
    // Clean up connections
  }
}
```

## Logging

The package uses [@logtape/logtape](https://github.com/dahlia/logtape) for structured logging:

```typescript
import { configure, getConsoleSink } from "@logtape/logtape";

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: ["@loro-extended"], level: "debug", sinks: ["console"] },
  ],
});
```

## Development

Run tests:

```bash
pnpm --filter @loro-extended/repo test
```

Run specific test file:

```bash
pnpm --filter @loro-extended/repo test run src/repo.test.ts
```

## License

MIT
