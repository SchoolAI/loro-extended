# Creating Custom Adapters

This guide explains how to create custom storage and network adapters for `@loro-extended/repo`.

## Overview

Adapters provide the Repo with access to storage (e.g., PostgreSQL, LevelDB, Redis) and network (e.g., WebSockets, WebRTC, SSE). Each adapter implementation is specific to the storage or network layer it is "adapting" to.

## Custom Storage Adapters

Storage adapters persist document data. Create one by extending `StorageAdapter`:

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
      adapterId: "my-storage-instance", // Optional: auto-generated if not provided
    });
  }

  /**
   * Load a binary blob for a given key.
   */
  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    // StorageKey is string[] - e.g., ["doc-id", "update", "timestamp"]
    const keyString = key.join("/");
    // Load and return data, or undefined if not found
    return await myDatabase.get(keyString);
  }

  /**
   * Save a binary blob to a given key.
   */
  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    const keyString = key.join("/");
    await myDatabase.set(keyString, data);
  }

  /**
   * Remove a binary blob from a given key.
   */
  async remove(key: StorageKey): Promise<void> {
    const keyString = key.join("/");
    await myDatabase.delete(keyString);
  }

  /**
   * Load all chunks whose keys begin with the given prefix.
   * Used for loading all updates for a document.
   */
  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    const prefix = keyPrefix.join("/");
    const entries = await myDatabase.getByPrefix(prefix);
    return entries.map(([key, data]) => ({
      key: key.split("/"),
      data,
    }));
  }

  /**
   * Remove all chunks whose keys begin with the given prefix.
   * Used for deleting a document and all its updates.
   */
  async removeRange(keyPrefix: StorageKey): Promise<void> {
    const prefix = keyPrefix.join("/");
    await myDatabase.deleteByPrefix(prefix);
  }
}
```

### Storage Key Format

Storage keys are arrays of strings with the following structure:
- `[docId]` - Document root
- `[docId, "update", timestamp]` - Individual update chunks

The `loadRange` and `removeRange` methods use prefix matching to operate on all chunks for a document.

## Custom Network Adapters

Network adapters connect to peers for real-time synchronization. Create one by extending `Adapter`:

```typescript
import { Adapter, type GeneratedChannel } from "@loro-extended/repo";

// Define your connection context type
type ConnectionContext = {
  connection: WebSocket; // or any connection object
  peerId: string;
};

class MyNetworkAdapter extends Adapter<ConnectionContext> {
  private server: MyServer;

  constructor(options: { serverUrl: string; adapterId?: string }) {
    super({
      adapterType: "my-network",
      adapterId: options.adapterId, // Optional: auto-generated if not provided
    });
    this.server = new MyServer(options.serverUrl);
  }

  /**
   * Generate a channel for a given connection context.
   * Called by addChannel() to create the channel interface.
   */
  protected generate(context: ConnectionContext): GeneratedChannel {
    return {
      kind: "network", // "network" | "storage" | "other"
      adapterType: this.adapterType,
      send: (msg) => {
        // Serialize and send the message
        context.connection.send(JSON.stringify(msg));
      },
      stop: () => {
        // Clean up the connection
        context.connection.close();
      },
    };
  }

  /**
   * Start the adapter. Set up connections and listeners.
   * Call addChannel() for each connection.
   */
  async onStart(): Promise<void> {
    // Connect to server
    await this.server.connect();

    // Listen for new connections
    this.server.on("connection", (connection, peerId) => {
      // Create a channel for this connection
      const channel = this.addChannel({ connection, peerId });

      // Set up message handling
      connection.on("message", (data) => {
        const msg = JSON.parse(data);
        channel.onReceive(msg);
      });

      // Handle disconnection
      connection.on("close", () => {
        this.removeChannel(channel.channelId);
      });

      // Initiate the establishment handshake
      this.establishChannel(channel.channelId);
    });
  }

  /**
   * Stop the adapter. Clean up all connections.
   */
  async onStop(): Promise<void> {
    await this.server.disconnect();
  }
}
```

### Adapter Lifecycle

1. **Created**: Constructor finished, not yet initialized
2. **Initialized**: `_initialize()` called by Synchronizer with context
3. **Started**: `onStart()` called, adapter is active
4. **Stopped**: `onStop()` called, adapter is inactive

### Channel Methods

Within `onStart()` and `onStop()`, you have access to:

- `addChannel(context)`: Create a new channel, returns `ConnectedChannel`
- `removeChannel(channelId)`: Remove a channel
- `establishChannel(channelId)`: Initiate the establishment handshake

### Channel Types

The `kind` field in `GeneratedChannel` determines how the channel is treated:

| Kind | Description | Example |
|------|-------------|---------|
| `"storage"` | Persistence layer | IndexedDB, PostgreSQL |
| `"network"` | Peer communication | WebSocket, WebRTC |
| `"other"` | Custom use cases | Testing, debugging |

## Best Practices

### 1. Handle Reconnection

Network adapters should handle reconnection gracefully:

```typescript
async onStart(): Promise<void> {
  this.server.on("disconnect", () => {
    // Clean up channels
    for (const channel of this.channels.all()) {
      this.removeChannel(channel.channelId);
    }
    // Attempt reconnection
    this.reconnect();
  });
}
```

### 2. Use Adapter IDs

Provide meaningful adapter IDs for debugging and idempotent operations:

```typescript
const storage = new MyStorageAdapter({
  adapterId: "primary-storage",
});

// Later, you can check or remove by ID
repo.hasAdapter("primary-storage");
await repo.removeAdapter("primary-storage");
```

### 3. Logging

Use the provided logger for consistent logging:

```typescript
async onStart(): Promise<void> {
  this.logger.debug("Starting adapter", { serverUrl: this.serverUrl });
  // ...
  this.logger.info("Adapter started successfully");
}
```

### 4. Error Handling

Handle errors gracefully and log them:

```typescript
protected generate(context: ConnectionContext): GeneratedChannel {
  return {
    kind: "network",
    adapterType: this.adapterType,
    send: (msg) => {
      try {
        context.connection.send(JSON.stringify(msg));
      } catch (error) {
        this.logger.error("Failed to send message", { error });
      }
    },
    stop: () => {
      context.connection.close();
    },
  };
}
```

### 5. Send Interceptors

Adapters support a middleware-style interceptor chain for outgoing messages. This is useful for:

- **Simulating network conditions** - Delay, packet loss, throttling
- **Debugging** - Logging message flow
- **Testing** - Verifying message sequences
- **Demos** - Showing CRDT merge behavior under network partitions

```typescript
import type { SendInterceptor } from "@loro-extended/repo";

// Delay all messages by 3 seconds
const unsubscribe = adapter.addSendInterceptor((ctx, next) => {
  setTimeout(next, 3000);
});

// Drop 10% of messages (simulate packet loss)
adapter.addSendInterceptor((ctx, next) => {
  if (Math.random() > 0.1) next();
});

// Log all messages
adapter.addSendInterceptor((ctx, next) => {
  console.log("Sending:", ctx.envelope.message.type);
  next();
});

// Remove a specific interceptor
unsubscribe();

// Clear all interceptors
adapter.clearSendInterceptors();
```

The interceptor context provides:

- `envelope` - The message envelope being sent (contains `toChannelIds` and `message`)
- `adapterType` - The adapter type (e.g., "websocket-client")
- `adapterId` - The adapter instance ID

**Important**: If `next()` is not called, the message is dropped. This allows interceptors to filter or conditionally block messages.

## Example Adapters

For complete implementations, see:

- [InMemoryStorageAdapter](../packages/repo/src/storage/in-memory-storage-adapter.ts) - Simple in-memory storage
- [BridgeAdapter](../packages/repo/src/adapter/bridge-adapter.ts) - In-process peer connection
- [WebSocket Adapter](../adapters/websocket/) - WebSocket implementation
- [SSE Adapter](../adapters/sse/) - Server-Sent Events implementation
- [IndexedDB Adapter](../adapters/indexeddb/) - Browser storage
- [PostgreSQL Adapter](../adapters/postgres/) - Server database storage
