# @loro-extended/repo

`@loro-extended/repo` is a core component for building distributed local-first applications with [Loro](https://github.com/loro-dev/loro), a fast CRDTs-based state synchronization library.

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
  network: [network],
  storage,
});

// Create a new document
const docHandle = await repo.create({ documentId: "my-doc" });

// Or find an existing document
const existingHandle = await repo.find("existing-doc-id");

// Or find or create if it doesn't exist
const docHandle = await repo.findOrCreate("todo-list", {
  initialValue: () => ({ todos: [] }),
});
```

## Core Concepts

### Repo

The `Repo` class is the central orchestrator for the Loro state synchronization system. It manages the lifecycle of documents, coordinates subsystems, and provides the main public API for document operations.

- **Document Management**: Creates, finds, and deletes documents
- **Subsystem Coordination**: Wires together storage, networking, and synchronization
- **Event Handling**: Coordinates events between components
- **Peer Management**: Handles peer discovery and communication

### DocHandle

The `DocHandle` is a stateful wrapper around a single Loro document. It provides a higher-level API to manage the document's lifecycle, state, and mutations, abstracting away the complexities of the underlying CRDT.

- **State Machine**: Progresses through `idle` → `loading` → `ready` states
- **Event-Driven**: Emits events for state changes, document changes, and sync messages
- **Mutation Interface**: Provides a simple `change()` method for document updates

### Storage Adapters

Storage adapters handle the persistence of documents and their updates. The package includes:

- **InMemoryStorageAdapter**: Stores data in memory (default, for testing)
- **SimpleFileStorageAdapter**: Stores data in the filesystem (Node.js only)

### Network Adapters

Network adapters handle communication between peers. The package includes:

- **InProcessNetworkAdapter**: Enables direct in-process communication (for testing)
- **External Adapters**: Integration with `@loro-extended/network-sse` for real-world applications

## API Reference

### Repo Class

#### Constructor

```typescript
interface RepoConfig {
  storage?: StorageAdapter; // Storage adapter (defaults to InMemoryStorageAdapter)
  network?: NetworkAdapter[]; // Array of network adapters (defaults to InProcessNetworkAdapter)
  peerId?: PeerId; // Unique identifier for this peer (auto-generated if not provided)
  permissions?: Partial<PermissionAdapter>; // Permission configuration
}

const repo = new Repo(config);
```

#### Document Management

```typescript
// Create a new document
const handle = await repo.create<T>({
  documentId: DocumentId, // Optional, auto-generated if not provided
});

// Find an existing document
const handle = await repo.find<T>(documentId);

// Find or create if not found
const handle = await repo.findOrCreate<T>(documentId, {
  timeout: number, // Optional timeout in milliseconds
  initialValue: () => T, // Optional initial value function
});

// Delete a document
await repo.delete(documentId);
```

#### Accessing Subsystems

```typescript
// Get all document handles
const handles = repo.handles;

// Get the network subsystem
const network = repo.network;

// Get the permission adapter
const permissions = repo.permissions;

// Get the peer ID
const peerId = repo.peerId;
```

### DocHandle Class

#### Lifecycle Management

```typescript
// Listen for state transitions
handle.on("doc-handle-state-transition", ({ oldState, newState }) => {
  console.log(`State changed from ${oldState.state} to ${newState.state}`);
});

// Wait for the document to be ready
await handle.whenReady();

// Check current state
const state = handle.state; // "idle" | "loading" | "ready" | "unavailable"
```

#### Document Mutations

```typescript
// Make changes to the document
handle.change((doc) => {
  doc.title = "My Collaborative Document";
  doc.tasks = [{ description: "Finish the README", completed: true }];
});

// Listen for local changes
handle.on("doc-handle-local-change", (event) => {
  console.log("Local change made:", event);
});

// Listen for any changes (local or remote)
handle.on("doc-handle-change", ({ doc }) => {
  console.log("Document changed:", doc.toJSON().root);
});
```

#### Document Operations

```typescript
// Load a document (usually called internally by repo methods)
await handle.load(async () => {
  // Return a LoroDoc instance
  return new LoroDoc();
});

// Delete the document
handle.delete();
```

## Storage Adapters

### InMemoryStorageAdapter

The default storage adapter that keeps all data in memory. Useful for testing and development.

```typescript
import { InMemoryStorageAdapter } from "@loro-extended/repo";

const storage = new InMemoryStorageAdapter();
const repo = new Repo({ storage });
```

### SimpleFileStorageAdapter

A file-based storage adapter for Node.js applications.

```typescript
import { SimpleFileStorageAdapter } from "@loro-extended/repo";

const storage = new SimpleFileStorageAdapter("./data");
const repo = new Repo({ storage });
```

### Custom Storage Adapter

Implement your own storage adapter by implementing the `StorageAdapter` interface:

```typescript
import type { StorageAdapter, Chunk, StorageKey } from "@loro-extended/repo";

class CustomStorageAdapter implements StorageAdapter {
  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    // Implement loading logic
  }

  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    // Implement saving logic
  }

  async remove(key: StorageKey): Promise<void> {
    // Implement removal logic
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    // Implement range loading logic
  }

  async removeRange(keyPrefix: StorageKey): Promise<void> {
    // Implement range removal logic
  }
}
```

## Network Adapters

### InProcessNetworkAdapter

The default network adapter that enables direct communication between Repo instances in the same process. Useful for testing.

```typescript
import { InProcessNetworkAdapter } from "@loro-extended/repo";

const network = new InProcessNetworkAdapter();
const repo = new Repo({ network: [network] });
```

### External Network Adapters

For real-world applications, use external network adapters from `@loro-extended/adapters`:

```typescript
import { SseClientNetworkAdapter } from "@loro-extended/adapters/network/sse/client";
import { Repo } from "@loro-extended/repo";

const network = new SseClientNetworkAdapter("/api/sync");
const repo = new Repo({ network: [network] });
```

### Custom Network Adapter

Implement your own network adapter by implementing the `NetworkAdapter` interface:

```typescript
import type { NetworkAdapter, PeerMetadata } from "@loro-extended/repo";
import Emittery from "emittery";

class CustomNetworkAdapter
  extends Emittery<NetworkAdapterEvents>
  implements NetworkAdapter
{
  peerId?: PeerId;

  connect(peerId: PeerId, metadata: PeerMetadata): void {
    // Implement connection logic
  }

  send(message: RepoMessage): void {
    // Implement message sending logic
  }

  disconnect(): void {
    // Implement disconnection logic
  }
}
```

## Complete Example

Here's a complete example of setting up a collaborative todo application:

```typescript
import { Repo } from "@loro-extended/repo";
import { SseClientNetworkAdapter } from "@loro-extended/adapters/network/sse/client";
import { IndexedDBStorageAdapter } from "@loro-extended/adapters/storage/indexed-db/client";

// Define the document type
interface TodoDoc {
  title: string;
  todos: Array<{
    id: string;
    text: string;
    completed: boolean;
  }>;
}

// Create adapters
const network = new SseClientNetworkAdapter("/api/sync");
const storage = new IndexedDBStorageAdapter();

// Create the repo
const repo = new Repo({
  network: [network],
  storage,
});

// Get or create the todo document
const todoHandle = await repo.findOrCreate<TodoDoc>("main-todos", {
  initialValue: () => ({
    title: "My Todos",
    todos: [],
  }),
});

// Wait for the document to be ready
await todoHandle.whenReady();

// Listen for changes
todoHandle.on("doc-handle-change", ({ doc }) => {
  console.log("Todos updated:", doc.toJSON().root);
  // Update UI here
});

// Add a new todo
todoHandle.change((doc) => {
  doc.todos.push({
    id: crypto.randomUUID(),
    text: "Learn about Loro",
    completed: false,
  });
});

// Toggle a todo completion
const toggleTodo = (id: string) => {
  todoHandle.change((doc) => {
    const todo = doc.todos.find((t) => t.id === id);
    if (todo) {
      todo.completed = !todo.completed;
    }
  });
};
```

## Architecture

The Repo package follows a layered architecture:

```
┌─────────────────────────────────────────┐
│             Application                 │
├─────────────────────────────────────────┤
│                Repo                     │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │  DocHandle  │  │ NetworkSubsystem │  │
│  └─────────────┘  └──────────────────┘  │
│         │                  │            │
│  ┌──────▼───────┐  ┌───────▼───────┐    │
│  │ Synchronizer │  │NetworkAdapters│    │
│  └──────────────┘  └───────────────┘    │
│         │                               │
│  ┌──────▼───────┐                       │
│  │StorageAdapter│                       │
│  └──────────────┘                       │
└─────────────────────────────────────────┘
```

### Data Flow

1. **Document Creation**: Repo creates a DocHandle with injected services
2. **Local Changes**: DocHandle processes mutations and notifies the Synchronizer
3. **Network Sync**: Synchronizer coordinates with NetworkSubsystem to sync changes
4. **Storage**: Changes are automatically persisted through the StorageAdapter
5. **Remote Changes**: NetworkSubsystem receives updates and routes them to the Synchronizer
6. **Document Update**: Synchronizer applies remote changes to the appropriate DocHandle

## Error Handling

The Repo package provides several ways to handle errors:

```typescript
// Handle document loading errors
try {
  const handle = await repo.find("nonexistent-doc");
} catch (error) {
  console.error("Document not found:", error);
}

// Handle state transitions
handle.on("doc-handle-state-transition", ({ oldState, newState }) => {
  if (newState.state === "unavailable") {
    console.error("Document became unavailable");
  }
});

// Handle storage errors (in custom adapters)
class SafeStorageAdapter implements StorageAdapter {
  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    try {
      // Save logic here
    } catch (error) {
      console.error("Storage error:", error);
      throw error; // Let DocHandle handle it
    }
  }
}
```

## Troubleshooting

### Common Issues

**Document not found**

- Ensure you're using the correct document ID
- Check if the document was created on another peer
- Verify network connectivity

**Sync not working**

- Check that network adapters are properly configured
- Verify that peers can connect to each other
- Check firewall and network settings

**Storage errors**

- Ensure storage adapter has proper permissions
- Check available disk space
- Verify storage path is accessible

### Debug Mode

Enable debug logging to troubleshoot issues:

```typescript
// Enable debug logging (if supported by adapters)
const repo = new Repo({
  network: [new DebugNetworkAdapter()],
  storage: new DebugStorageAdapter(),
});
```

## Architecture

This package implements a sophisticated distributed document synchronization system using several key architectural patterns:

### The Elm Architecture (TEA)

Core components like `DocHandle` and `Synchronizer` use pure functional state machines with impure runtime hosts. This provides:

- Predictable state transitions
- Excellent testability
- Clear separation of concerns

### Pluggable Adapter System

Storage and network operations are abstracted through adapter interfaces, enabling:

- Environment-specific implementations (browser vs server)
- Easy testing with in-memory adapters
- Future extensibility

### Event-Driven Protocol

The synchronization protocol uses an "Announce/Request/Sync" pattern that ensures:

- Robust peer discovery
- Reliable document exchange
- Cascade prevention in hub-and-spoke topologies

For detailed architectural documentation, see:

- [Overall Architecture](./src/repo.md) - System design and component relationships
- [DocHandle State Machine](./src/doc-handle.md) - Document lifecycle management
- [Synchronizer Protocol](./src/synchronizer.md) - Peer-to-peer synchronization details

## Future Work

While the core functionality is complete, we're working on:

- **Additional Storage Adapters**: SQLite, Redis, and cloud storage options
- **More Network Protocols**: WebRTC, WebSocket, and MQTT adapters
- **Advanced Permission Systems**: Fine-grained access control and authentication
- **Performance Optimizations**: Batch operations and delta compression
- **Developer Tools**: Debugging utilities and monitoring dashboards

## Contributing

Contributions are welcome! Please see the main repository for contribution guidelines.

## License

MIT
