# @loro-extended/adapters

A collection of network and storage adapters for [@loro-extended/repo](../repo) that enables real-time synchronization and persistence across different environments.

## Overview

This package provides adapters for:

- **Network Communication**: Server-Sent Events (SSE) for real-time bidirectional sync
- **Storage Persistence**: IndexedDB for browsers and LevelDB for servers

All adapters are designed with client/server variants to work seamlessly across different JavaScript environments.

## Features

- 🔄 **Real-time bidirectional sync** using SSE + HTTP
- 🔌 **Automatic reconnection** on connection loss (client-side)
- 📦 **Binary data support** via base64 encoding
- 🚀 **Simple Express.js integration** for servers
- 💾 **Persistent storage** with IndexedDB and LevelDB
- 🌐 **Cross-environment compatibility** (browser/Node.js)

## Installation

```bash
npm install @loro-extended/adapters
# or
pnpm add @loro-extended/adapters
```

## Network Adapters

### SSE Client Adapter (Browser)

For browser applications connecting to an SSE server:

```typescript
import { Repo } from "@loro-extended/repo";
import { SseClientNetworkAdapter } from "@loro-extended/adapters/network/sse/client";
import { IndexedDBStorageAdapter } from "@loro-extended/adapters/storage/indexed-db/client";

// Create the SSE network adapter pointing to your server endpoint
const network = new SseClientNetworkAdapter("/api/loro");

// Create a storage adapter for persistence
const storage = new IndexedDBStorageAdapter();

// Initialize the Repo with both adapters
const repo = new Repo({
  network: [network],
  storage,
});
```

### SSE Server Adapter (Node.js)

For Node.js/Express servers:

```typescript
import express from "express";
import { Repo } from "@loro-extended/repo";
import { SseServerNetworkAdapter } from "@loro-extended/adapters/network/sse/server";
import { LevelStorageAdapter } from "@loro-extended/adapters/storage/level-db/server";

const app = express();
app.use(express.json());

// 1. Create the SSE server adapter
const sseAdapter = new SseServerNetworkAdapter();

// 2. Create a storage adapter for persistence
const storageAdapter = new LevelStorageAdapter("loro-app.db");

// 3. Create the Repo with both adapters
new Repo({
  storage: storageAdapter,
  network: [sseAdapter],
});

// 4. Mount the adapter's Express routes
app.use("/api/loro", sseAdapter.getExpressRouter());

app.listen(5170, () => {
  console.log("Server listening on http://localhost:5170");
});
```

## Storage Adapters

### IndexedDB Adapter (Browser)

For persistent storage in browser environments:

```typescript
import { IndexedDBStorageAdapter } from "@loro-extended/adapters/storage/indexed-db/client";

const storage = new IndexedDBStorageAdapter("my-app-db");
const repo = new Repo({ storage });
```

### LevelDB Adapter (Node.js)

For persistent storage in Node.js environments:

```typescript
import { LevelStorageAdapter } from "@loro-extended/adapters/storage/level-db/server";

const storage = new LevelStorageAdapter("./data/loro.db");
const repo = new Repo({ storage });
```

## How SSE Communication Works

1. **Client connects** to the server via SSE at `/events?peerId={peerId}`
2. **Server streams** document updates to connected clients in real-time
3. **Client sends** updates to the server via POST requests to `/sync`
4. **Automatic serialization** handles binary data (Uint8Array) via base64 encoding
5. **Reconnection logic** automatically handles network interruptions

## API Reference

### SseClientNetworkAdapter

```typescript
class SseClientNetworkAdapter extends Adapter<void> {
  constructor(serverUrl: string);

  // Adapter interface
  protected generate(): BaseChannel;
  init({ addChannel }): void;
  deinit(): void;
  start(): void;
}
```

**Key Features:**
- Automatically generates a unique peer ID on construction
- Creates a single channel to the server
- Handles automatic reconnection via ReconnectingEventSource
- Sends messages via HTTP POST with X-Peer-Id header

### SseServerNetworkAdapter

```typescript
class SseServerNetworkAdapter extends Adapter<PeerId> {
  constructor();

  // Adapter interface
  protected generate(peerId: PeerId): BaseChannel;
  init({ addChannel, removeChannel }): void;
  deinit(): void;
  start(): void;

  // Express integration
  getExpressRouter(): Router;
}
```

**Key Features:**
- Creates channels lazily when clients connect
- One channel per connected client (identified by peerId)
- Automatic heartbeat to detect stale connections
- Express router provides `/events` (SSE) and `/sync` (POST) endpoints

### IndexedDBStorageAdapter

```typescript
class IndexedDBStorageAdapter implements StorageAdapter {
  constructor(dbName?: string);

  // StorageAdapter interface
  load(key: StorageKey): Promise<Uint8Array | undefined>;
  save(key: StorageKey, data: Uint8Array): Promise<void>;
  remove(key: StorageKey): Promise<void>;
  loadRange(keyPrefix: StorageKey): Promise<Chunk[]>;
  removeRange(keyPrefix: StorageKey): Promise<void>;
}
```

### LevelStorageAdapter

```typescript
class LevelStorageAdapter implements StorageAdapter {
  constructor(dbPath: string);

  // StorageAdapter interface
  load(key: StorageKey): Promise<Uint8Array | undefined>;
  save(key: StorageKey, data: Uint8Array): Promise<void>;
  remove(key: StorageKey): Promise<void>;
  loadRange(keyPrefix: StorageKey): Promise<Chunk[]>;
  removeRange(keyPrefix: StorageKey): Promise<void>;
}
```

## Express Routes

The SSE server adapter provides these routes via `getExpressRouter()`:

- `GET /events?peerId={id}` - SSE endpoint for real-time updates
- `POST /sync` - Endpoint for receiving client updates

## Complete Example

Here's a complete example of a collaborative application:

**Server (server.js):**

```typescript
import express from "express";
import { Repo } from "@loro-extended/repo";
import { SseServerNetworkAdapter } from "@loro-extended/adapters/network/sse/server";
import { LevelStorageAdapter } from "@loro-extended/adapters/storage/level-db/server";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const sseAdapter = new SseServerNetworkAdapter();
const storage = new LevelStorageAdapter("./data/app.db");

new Repo({ network: [sseAdapter], storage });

app.use("/api/loro", sseAdapter.getExpressRouter());
app.listen(3000);
```

**Client (app.js):**

```typescript
import { Repo } from "@loro-extended/repo";
import { SseClientNetworkAdapter } from "@loro-extended/adapters/network/sse/client";
import { IndexedDBStorageAdapter } from "@loro-extended/adapters/storage/indexed-db/client";

const network = new SseClientNetworkAdapter("/api/loro");
const storage = new IndexedDBStorageAdapter();
const repo = new Repo({ network: [network], storage });

// Create or find a document
const handle = await repo.get("my-doc");

// Listen for changes
handle.on("doc-handle-change", ({ doc }) => {
  console.log("Document updated:", doc.toJSON());
});

// Make changes
handle.change((doc) => {
  doc.content = "Hello, collaborative world!";
});
```

## Requirements

- **Node.js 18+** (for server adapters)
- **Modern browser** with EventSource and IndexedDB support (for client adapters)
- **Express.js 4+** (for server integration)

## License

MIT
