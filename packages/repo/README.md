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
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client";
import { IndexedDBStorageAdapter } from "@loro-extended/adapter-indexeddb";

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
- **Simple Mutations**: Use the `change()` method to modify documents

### Adapters

Adapters provide pluggable storage and network implementations through a unified channel-based architecture:

- **Storage Adapters**: Handle document persistence (e.g., [`InMemoryStorageAdapter`](./src/storage/in-memory-storage-adapter.ts))
- **Network Adapters**: Handle peer communication (e.g., [`BridgeAdapter`](./src/adapter/bridge-adapter.ts) for testing)
- **External Adapters**: Available as separate packages (`@loro-extended/adapter-sse`, `@loro-extended/adapter-indexeddb`, etc.)

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

// Delete a document
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
    completed: true,
  });
});

// Or access the document directly
handle.doc.getMap("root").set("title", "Direct Access");
handle.doc.commit(); // Don't forget to commit!
```

#### Typed Presence

For type safety and default values, you can use the `presence()` API:

```typescript
import { Shape } from "@loro-extended/change";

const PresenceSchema = Shape.plain.object({
  name: Shape.plain.string(),
});

const EmptyPresence = {
  name: "Anonymous",
};

const presence = handle.presence(PresenceSchema, EmptyPresence);
console.log(presence.self.name); // "Anonymous" (default)
```

## Adapters

Adapters are the backbone of the synchronization system, providing a pluggable architecture for network and storage.

### Channel Lifecycle

At the core of the adapter system is the concept of a **channel**, which represents a connection to a peer or a storage endpoint. Channels follow a strict lifecycle, enforced by the type system, ensuring robust communication:

1.  **`ConnectedChannel`**: The initial state when a channel is first created. In this state, only establishment messages can be exchanged to verify peer identities.
2.  **`EstablishedChannel`**: After identities are exchanged, the channel transitions to this state. It is now associated with a stable `peerId` and can be used to send and receive document synchronization messages.

This two-phase process prevents data from being sent before both sides have confirmed their identity and permissions, providing a secure foundation for synchronization.

### Peer State & Reconnection Optimization

The repo maintains a sophisticated **peer state model** that tracks the status of every known peer, including which documents they are aware of (`documentAwareness`). This enables a significant performance optimization:

- **New Peer Connections**: When connecting to a new peer for the first time, the repo performs a full discovery process, using a `directory-request` to learn which documents the peer has.
- **Reconnections**: When reconnecting to a known peer, the repo uses its cached `PeerState`. It sends an optimized sync request containing only the changes made since the last connection, dramatically reducing redundant data transfer.

This intelligent state tracking ensures that synchronization is both fast and efficient, especially in environments with intermittent connectivity.

### Built-in Adapters

The package includes basic adapters for testing and development:

- [`InMemoryStorageAdapter`](./src/storage/in-memory-storage-adapter.ts) - Stores data in memory
- [`BridgeAdapter`](./src/adapter/bridge-adapter.ts) & [`Bridge`](./src/adapter/bridge-adapter.ts) - Enables in-process testing of multiple repos by creating a "bridge" between them

### External Adapters

For production use, see `@loro-extended/adapters`:

- **SSE Adapters**: Server-Sent Events for client-server sync
- **IndexedDB Adapter**: Browser-based persistent storage
- **LevelDB Adapter**: Node.js persistent storage

### Custom Storage Adapters

Create custom storage adapters by extending the [`StorageAdapter`](./src/storage/storage-adapter.ts) base class. The base class is a powerful tool that handles **all channel protocol and synchronization logic automatically**. Subclasses only need to implement a simple key/value storage interface, with no knowledge of the underlying channel mechanics.

```typescript
import {
  StorageAdapter,
  type StorageKey,
  type Chunk,
} from "@loro-extended/repo";

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

- **Zero Channel Knowledge Required**: The base class transparently handles all channel message boilerplate, including establishment, sync requests, and responses.
- **Automatic Establishment**: The adapter automatically handles the channel establishment handshake, presenting itself as a stable peer to the repo.
- **Intelligent Version-Aware Sync**: When the repo requests a document, the base class automatically:
  1.  Loads all relevant data chunks for the document using `loadRange`.
  2.  Reconstructs the document's complete history in a temporary `LoroDoc`.
  3.  Exports only the specific updates the requester needs based on their version vector.
- **Incremental Storage**: The base class is designed for incremental storage, saving updates with keys like `["docId", "update", "timestamp"]` to support the version-aware sync process.
- **`wantsUpdates` vs `loading`**: The system distinguishes between a channel's _permission_ to receive updates (`wantsUpdates`) and its current _sync status_ (`loading`). This allows a storage adapter to persist updates for a document it doesn't have yet, ensuring it can build a complete history over time.

### Adapter Lifecycle

All adapters, whether for network or storage, follow a strict, internally managed lifecycle to ensure predictable behavior:

1.  **`created`**: The adapter has been instantiated but not yet configured by the repo.
2.  **`initialized`**: The repo has provided the adapter with the necessary hooks for communication.
3.  **`started`**: The adapter's `onStart()` method has been called. Only in this state can an adapter add or remove channels. `onStart` is the place to set up listeners or initiate connections.
4.  **`stopped`**: The adapter has been shut down, and all its resources have been cleaned up.

Subclasses must implement `onStart()` and `onStop()` to manage their specific resources. The `Adapter` base class enforces this lifecycle, throwing errors if methods like `addChannel()` are called in the wrong state.

### Custom Network Adapters

Create custom network adapters by extending the [`Adapter`](./src/adapter/adapter.ts) class. The key is to manage channels correctly within the `onStart` and `onStop` lifecycle methods.

```typescript
import { Adapter, type GeneratedChannel } from "@loro-extended/repo";

class CustomNetworkAdapter extends Adapter<ConnectionContext> {
  // `generate` is called by `addChannel` to create the channel's core logic
  protected generate(context: ConnectionContext): GeneratedChannel {
    return {
      kind: "network",
      adapterId: this.adapterId,
      send: (msg) => {
        // Your logic to send a message over the connection
        context.connection.send(JSON.stringify(msg));
      },
      stop: () => {
        // Your logic to close the connection
        context.connection.close();
      },
    };
  }

  // `onStart` is the place to create channels
  async onStart(): Promise<void> {
    // Example: Create a channel for a new WebSocket connection
    const ws = new WebSocket("wss://example.com/sync");

    ws.onopen = () => {
      const channel = this.addChannel({ connection: ws });
      this.establishChannel(channel.channelId); // Begin the handshake
    };

    ws.onmessage = (event) => {
      // Find the channel for this connection and pass the message to the repo
      // (This requires more logic to map connections to channels)
    };
  }

  async onStop(): Promise<void> {
    // Clean up all active connections and channels
    for (const channel of this.channels) {
      this.removeChannel(channel.channelId);
    }
  }
}
```

## Complete Example

Here's a complete example of setting up a collaborative todo application:

```typescript
import { Repo } from "@loro-extended/repo";
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client";
import { IndexedDBStorageAdapter } from "@loro-extended/adapter-indexeddb";

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
  const todosList =
    todosMap.get("todos") || todosMap.setContainer("todos", "List");
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

1. **Document Access**: `Repo.get()` creates a [`DocHandle`](./src/doc-handle.ts) with an immediately available document
2. **Local Changes**: `DocHandle.change()` modifies the document and notifies the [`Synchronizer`](./src/synchronizer.ts)
3. **Channel Communication**: [`Synchronizer`](./src/synchronizer.ts) sends messages through channels managed by [`AdapterManager`](./src/adapter/adapter-manager.ts)
4. **Adapter Routing**: [`AdapterManager`](./src/adapter/adapter-manager.ts) routes messages to appropriate adapters
5. **Remote Changes**: Adapters receive updates via channels and dispatch to [`Synchronizer`](./src/synchronizer.ts)
6. **Document Update**: [`Synchronizer`](./src/synchronizer.ts) applies changes to the document's CRDT

## Permission System

Control document access using the [`Rules`](./src/rules.ts) interface. The `RuleContext` provides information about the document, peer, and channel, allowing for fine-grained control.

### `canReveal`

The `canReveal` permission is the most important for controlling document visibility. It's called whenever a new peer connects or a new document is created. If it returns `false`, the document's existence will not be revealed to the peer.

### Using `channelKind` for Storage vs. Network Rules

A key feature of the permission system is the `channelKind` property in the `RuleContext`. This allows you to define different rules for storage adapters versus network adapters. This is crucial for ensuring documents are persisted to storage even if they are not shared with network peers.

```typescript
import { Repo } from "@loro-extended/repo";

const repo = new Repo({
  adapters: [network, storage],
  permissions: {
    canReveal: (context) => {
      // Storage adapters must always be able to receive updates to persist them
      if (context.channelKind === "storage") {
        return true;
      }

      // For network peers, only reveal documents with a "public-" prefix
      return context.docId.startsWith("public-");
    },

    canUpdate: ({ docId, peerName }) => {
      // Example: only allow trusted peers to modify documents
      return peerName === "trusted-peer";
    },

    canDelete: ({ docId, peerName }) => {
      // Example: only allow admins to delete documents
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

The protocol is designed for efficiency and robustness, especially in environments with intermittent connectivity.

- **Establishment Handshake**: A two-phase handshake (`establish-request` / `establish-response`) ensures that both peers have confirmed their identity before any document data is exchanged.
- **Directory Protocol**: When connecting to a new peer, the repo sends a `directory-request` to discover which documents the peer has. The peer's response is filtered by `canReveal` permissions, ensuring private documents are not exposed. This step is skipped on reconnection to a known peer, thanks to the peer state cache.
- **Version-Vector Sync**: All synchronization is based on Loro's version vectors. When requesting a document, the repo sends its current version. The recipient uses this to calculate the precise set of updates needed, minimizing data transfer.
- **Hop Count**: Messages include a `hopsRemaining` counter to prevent infinite forwarding loops in multi-peer networks.

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
