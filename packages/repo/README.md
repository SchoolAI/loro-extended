# @loro-extended/repo

`@loro-extended/repo` is a core component for building distributed local-first applications with [Loro](https://github.com/loro-dev/loro), a fast CRDT-based state synchronization library.

## What is Loro?

Loro is a library of CRDTs (Conflict-free Replicated Data Types) that enables real-time collaboration and local-first applications. It allows multiple users to concurrently modify a shared JSON-like data structure, merging changes automatically without conflicts. Data is stored locally and can be synced with peers when a network connection is available.

## Installation

```bash
npm install @loro-extended/repo
# or
pnpm add @loro-extended/repo
```

## Quick Start

```typescript
import { Repo } from "@loro-extended/repo";
import { SseClientNetworkAdapter } from "@loro-extended/adapters/network/sse/client";
import { IndexedDBStorageAdapter } from "@loro-extended/adapters/storage/indexed-db/client";

// Create adapters for network and storage
const network = new SseClientNetworkAdapter("/api/sync");
const storage = new IndexedDBStorageAdapter();

// Create and configure the Repo
const repo = new Repo({
  adapters: [network, storage],
  identity: { name: "my-peer" },
});

// Get or create a document (immediately available)
const docHandle = repo.get("my-doc");
```

## Core Concepts

### Repo

The `Repo` class is the central orchestrator for the Loro state synchronization system. It manages the lifecycle of documents and coordinates the synchronization subsystem.

- **Document Management**: Gets or creates documents via [`DocHandle`](./src/doc-handle.ts)
- **Adapter Coordination**: Manages storage and network adapters through channels
- **Identity Management**: Provides peer identity for synchronization

### DocHandle

The [`DocHandle`](./src/doc-handle.ts) is an always-available wrapper around a single Loro document. It provides immediate access to the document while offering flexible readiness APIs for applications that need to coordinate loading from storage or network sources.

- **Always Available**: Documents are immediately accessible without complex loading states
- **Flexible Readiness**: Applications can define custom readiness criteria using predicates
- **Simple Mutations**: Use the [`change()`](./src/doc-handle.ts:56) method to modify documents

### Adapters

Adapters provide pluggable storage and network implementations through a unified channel-based architecture:

- **Storage Adapters**: Handle document persistence (e.g., [`InMemoryStorageAdapter`](./src/storage/in-memory-storage-adapter.ts))
- **Network Adapters**: Handle peer communication (e.g., [`InProcessNetworkAdapter`](./src/network/in-process-network-adapter.ts))
- **External Adapters**: Available in `@loro-extended/adapters` for SSE, IndexedDB, etc.

All adapters implement the [`Adapter`](./src/adapter/adapter.ts) interface and communicate via channels.

## API Reference

### Repo Class

#### Constructor

```typescript
interface RepoParams {
  adapters: AnyAdapter[]; // Array of storage and network adapters
  identity?: PeerIdentityDetails; // Peer identity (auto-generated if not provided)
  permissions?: Partial<Rules>; // Permission rules
  onUpdate?: HandleUpdateFn; // Optional callback for model updates
}

const repo = new Repo(params);
```

#### Document Management

```typescript
// Get or create a document (immediately available)
const handle = repo.get<T>(docId);

// Delete a document (TODO: not yet implemented)
await repo.delete(docId);

// Reset the repo (disconnect adapters, clear state)
repo.reset();
```

### DocHandle Class

#### Always-Available Document Access

```typescript
// Document is immediately available
const doc = handle.doc; // LoroDoc instance, always ready

// Flexible readiness API - define what "ready" means for your app
await handle.waitUntilReady((readyStates) => {
  // Wait for storage to load
  return readyStates.some(
    (s) => s.channelMeta.kind === "storage" && s.loading.state === "found"
  );
});

// Convenience methods for common patterns
await handle.waitForStorage(); // Wait for storage load
await handle.waitForNetwork(); // Wait for network sync
```

#### Document Mutations

```typescript
// Make changes using the change() method
handle.change((doc) => {
  doc.getMap("root").set("title", "My Collaborative Document");
  doc.getList("tasks").push({
    description: "Finish the README",
    completed: true
  });
});

// Or access the document directly
handle.doc.getMap("root").set("title", "Direct Access");
handle.doc.commit(); // Don't forget to commit!
```

## Adapters

### Built-in Adapters

The package includes basic adapters for testing and development:

- [`InMemoryStorageAdapter`](./src/storage/in-memory-storage-adapter.ts) - Stores data in memory
- [`InProcessNetworkAdapter`](./src/network/in-process-network-adapter.ts) - Direct in-process communication

### External Adapters

For production use, see `@loro-extended/adapters`:

- **SSE Adapters**: Server-Sent Events for client-server sync
- **IndexedDB Adapter**: Browser-based persistent storage
- **LevelDB Adapter**: Node.js persistent storage

### Custom Storage Adapters

Create custom storage adapters by extending the [`StorageAdapter`](./src/storage/storage-adapter.ts) base class. The base class handles all channel communication automatically - you only need to implement simple storage operations:

```typescript
import { StorageAdapter, type StorageKey, type Chunk } from "@loro-extended/repo";

class MyStorageAdapter extends StorageAdapter {
  constructor() {
    super({ adapterId: "my-storage" });
  }

  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    // Load data for the given key
    // Key is an array of strings, e.g., ["docId"] or ["docId", "update", "v1"]
  }

  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    // Save data for the given key
  }

  async remove(key: StorageKey): Promise<void> {
    // Remove data for the given key
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    // Load all chunks whose keys start with the given prefix
    // Returns array of { key, data } objects
  }

  async removeRange(keyPrefix: StorageKey): Promise<void> {
    // Remove all chunks whose keys start with the given prefix
  }
}
```

**Key Features:**
- **No Channel Knowledge Required**: The base class handles all channel protocol details
- **Automatic Establishment**: Storage is always "ready" - no connection handshake needed
- **Version-Aware Sync**: Automatically reconstructs documents from incremental updates
- **Hierarchical Keys**: Supports efficient incremental storage with keys like `["docId", "update", "v1"]`

### Custom Network Adapters

Create custom network adapters by extending the [`Adapter`](./src/adapter/adapter.ts) class:

```typescript
import { Adapter, type BaseChannel } from "@loro-extended/repo";

class CustomNetworkAdapter extends Adapter<MyContext> {
  protected generate(context: MyContext): BaseChannel {
    return {
      kind: "network",
      adapterId: this.adapterId,
      send: (msg) => { /* send logic */ },
      start: (receive) => { /* start logic */ },
      stop: () => { /* stop logic */ },
    };
  }

  init({ addChannel, removeChannel }) {
    // Initialize adapter, create channels
  }

  deinit() {
    // Clean up resources
  }

  start() {
    // Start listening/connecting
  }
}
```

## Complete Example

Here's a complete example of setting up a collaborative todo application:

```typescript
import { Repo } from "@loro-extended/repo";
import { SseClientNetworkAdapter } from "@loro-extended/adapters/network/sse/client";
import { IndexedDBStorageAdapter } from "@loro-extended/adapters/storage/indexed-db/client";

// Create adapters
const network = new SseClientNetworkAdapter("/api/sync");
const storage = new IndexedDBStorageAdapter();

// Create the repo
const repo = new Repo({
  adapters: [network, storage],
  identity: { name: "todo-app" },
});

// Get the todo document (immediately available)
const todoHandle = repo.get("main-todos");

// Wait for storage to load before displaying
await todoHandle.waitForStorage();

// Document is always available
const doc = todoHandle.doc;

// Add a new todo using change()
todoHandle.change((doc) => {
  const todosMap = doc.getMap("root");
  const todosList = todosMap.get("todos") || todosMap.setContainer("todos", "List");
  todosList.push({
    id: crypto.randomUUID(),
    text: "Learn about Loro",
    completed: false,
  });
});

// Subscribe to changes
doc.subscribe((event) => {
  console.log("Document changed:", doc.toJSON());
  // Update UI here
});
```

## Architecture

The Repo package follows a layered architecture:

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

### Data Flow

1. **Document Access**: [`Repo.get()`](./src/repo.ts:67) creates a [`DocHandle`](./src/doc-handle.ts) with an immediately available document
2. **Local Changes**: [`DocHandle.change()`](./src/doc-handle.ts:56) modifies the document and notifies the [`Synchronizer`](./src/synchronizer.ts)
3. **Channel Communication**: [`Synchronizer`](./src/synchronizer.ts) sends messages through channels managed by [`AdapterManager`](./src/adapter/adapter-manager.ts)
4. **Adapter Routing**: [`AdapterManager`](./src/adapter/adapter-manager.ts) routes messages to appropriate adapters
5. **Remote Changes**: Adapters receive updates via channels and dispatch to [`Synchronizer`](./src/synchronizer.ts)
6. **Document Update**: [`Synchronizer`](./src/synchronizer.ts) applies changes to the document's CRDT

## Permission System

Control document access using the [`Rules`](./src/rules.ts) interface:

```typescript
const repo = new Repo({
  adapters: [network, storage],
  permissions: {
    canList: ({ docId, peerName }) => {
      // Control which documents are visible to peers
      return !docId.startsWith("private-");
    },
    canWrite: ({ docId, peerName }) => {
      // Control who can modify documents
      return peerName === "trusted-peer";
    },
    canBeginSync: ({ docId }) => {
      // Control automatic sync initiation
      return true;
    },
    canDelete: ({ docId, peerName }) => {
      // Control document deletion
      return peerName === "admin";
    },
  },
});
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

## Architecture

This package implements a channel-based distributed document synchronization system:

### Always-Available Documents

Documents are immediately available via [`DocHandle`](./src/doc-handle.ts), embracing CRDT semantics where operations are idempotent and commutative. Applications can optionally wait for specific readiness conditions.

### The Elm Architecture (TEA)

The [`Synchronizer`](./src/synchronizer.ts) uses pure functional state machines ([`synchronizer-program.ts`](./src/synchronizer-program.ts)) with impure runtime hosts, providing:

- Predictable state transitions
- Excellent testability
- Clear separation of concerns

### Channel-Based Adapters

All storage and network operations flow through channels managed by adapters:

- [`Adapter`](./src/adapter/adapter.ts) - Base class for all adapters
- [`Channel`](./src/channel.ts) - Represents a connection to a storage or network peer
- [`AdapterManager`](./src/adapter/adapter-manager.ts) - Routes messages to appropriate adapters

### Synchronization Protocol

The protocol uses establish/sync-request/sync-response patterns with:

- Peer identity exchange via publish/consume documents
- Version vector-based incremental sync
- Hop count to prevent forwarding cascades

For detailed documentation, see:

- [`repo.md`](./src/repo.md) - Overall system architecture
- [`doc-handle.md`](./src/doc-handle.md) - Always-available document design
- [`synchronizer.md`](./src/synchronizer.md) - Synchronization protocol details
- [`adapter/adapter.md`](./src/adapter/adapter.md) - Adapter system design

## Development

Run tests:
```bash
pnpm --filter @loro-extended/repo -- test
```

Run specific test file:
```bash
pnpm --filter @loro-extended/repo -- test run src/synchronizer.test.ts
```

## Contributing

Contributions are welcome! Please see the main repository for contribution guidelines.

## License

MIT
