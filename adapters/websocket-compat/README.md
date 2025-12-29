# @loro-extended/adapter-websocket-compat

> **Compatibility Adapter**: This adapter implements the [Loro Syncing Protocol](https://loro.dev/blog/loro-protocol) for interoperability with Loro servers. For loro-extended to loro-extended communication, use the native adapter `@loro-extended/adapter-websocket` instead.

WebSocket network adapter implementing the Loro Syncing Protocol for `@loro-extended/repo`.

## When to Use This Adapter

Use this adapter when you need to:
- Connect to a Loro Protocol server
- Interoperate with other Loro Protocol clients
- Maintain backward compatibility with existing Loro Protocol deployments

For new loro-extended projects, prefer `@loro-extended/adapter-websocket` which:
- Directly transmits `ChannelMsg` types without translation
- Supports all loro-extended message types natively
- Has simpler implementation and better debugging

## Features

- **Full Loro Syncing Protocol compliance** (except fragmentation >256KB)
- **Framework-agnostic design** with a WebSocket handler interface
- **Bidirectional communication** over a single WebSocket connection
- **Translation layer** between Loro Syncing Protocol and loro-extended messages
- **Room = DocId mapping** for simplicity
- **Ephemeral data integration** with existing loro-extended presence system
- **Automatic reconnection** with exponential backoff
- **Keepalive ping/pong** for connection health

## Installation

```bash
pnpm add @loro-extended/adapter-websocket-compat
```

## Usage

### Client

```typescript
import { Repo } from "@loro-extended/repo";
import { WsClientNetworkAdapter } from "@loro-extended/adapter-websocket-compat/client";

const adapter = new WsClientNetworkAdapter({
  url: "ws://localhost:3000/ws",
  reconnect: {
    enabled: true,
    maxAttempts: 10,
    baseDelay: 1000,
    maxDelay: 30000,
  },
  keepaliveInterval: 30000,
});

const repo = new Repo({
  identity: { peerId: "client-1", name: "Client", type: "user" },
  adapters: [adapter],
});
```

### Server with Express + ws

```typescript
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { Repo } from "@loro-extended/repo";
import {
  WsServerNetworkAdapter,
  wrapWsSocket,
} from "@loro-extended/adapter-websocket-compat/server";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const adapter = new WsServerNetworkAdapter();

const repo = new Repo({
  identity: { peerId: "server", name: "Server", type: "service" },
  adapters: [adapter],
});

wss.on("connection", (ws, req) => {
  // Extract peer ID from query string
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const peerId = url.searchParams.get("peerId");

  const { connection, start } = adapter.handleConnection({
    socket: wrapWsSocket(ws),
    peerId: peerId || undefined,
  });

  start();
});

server.listen(3000);
```

### Server with Hono

```typescript
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/cloudflare-workers"; // or your runtime
import { Repo } from "@loro-extended/repo";
import {
  WsServerNetworkAdapter,
  wrapStandardWebSocket,
} from "@loro-extended/adapter-websocket-compat/server";

const app = new Hono();
const adapter = new WsServerNetworkAdapter();

const repo = new Repo({
  identity: { peerId: "server", name: "Server", type: "service" },
  adapters: [adapter],
});

app.get(
  "/ws",
  upgradeWebSocket((c) => {
    let connection: ReturnType<typeof adapter.handleConnection>["connection"];

    return {
      onOpen(evt, ws) {
        const peerId = c.req.query("peerId");
        const result = adapter.handleConnection({
          socket: wrapStandardWebSocket(ws.raw as WebSocket),
          peerId: peerId || undefined,
        });
        connection = result.connection;
        result.start();
      },
      onClose() {
        // Connection cleanup is handled automatically
      },
    };
  })
);

export default app;
```

## Protocol

This adapter implements the [Loro Syncing Protocol](https://loro.dev/blog/loro-protocol) which uses binary messages over WebSocket for efficient real-time synchronization.

### Message Types

| Code | Type           | Description              |
| ---- | -------------- | ------------------------ |
| 0x00 | JoinRequest    | Request to join a room   |
| 0x01 | JoinResponseOk | Successful join response |
| 0x02 | JoinError      | Join failed              |
| 0x03 | DocUpdate      | Document update data     |
| 0x06 | UpdateError    | Update failed            |
| 0x07 | Leave          | Leave a room             |

### CRDT Types (Magic Bytes)

| Magic  | Type                | Description                        |
| ------ | ------------------- | ---------------------------------- |
| `%LOR` | Loro Document       | Persistent document data           |
| `%EPH` | Ephemeral Store     | Transient presence/cursor data     |
| `%EPS` | Persisted Ephemeral | Ephemeral data that gets persisted |

### Keepalive

The client sends `ping` text frames every 30 seconds (configurable). The server responds with `pong`. This keeps the connection alive through proxies and load balancers.

## API Reference

### WsClientNetworkAdapter

```typescript
interface WsClientOptions {
  /** WebSocket URL to connect to */
  url: string | ((peerId: PeerID) => string);

  /** Optional: Custom WebSocket implementation (for Node.js) */
  WebSocket?: typeof WebSocket;

  /** Reconnection options */
  reconnect?: {
    enabled: boolean;
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
  };

  /** Keepalive interval in ms (default: 30000) */
  keepaliveInterval?: number;
}
```

### WsServerNetworkAdapter

```typescript
class WsServerNetworkAdapter {
  /** Handle a new WebSocket connection */
  handleConnection(options: WsConnectionOptions): WsConnectionResult;

  /** Get an active connection by peer ID */
  getConnection(peerId: PeerID): WsConnection | undefined;

  /** Get all active connections */
  getAllConnections(): WsConnection[];

  /** Check if a peer is connected */
  isConnected(peerId: PeerID): boolean;

  /** Broadcast a message to all connected peers */
  broadcast(msg: ChannelMsg): void;

  /** Number of connected peers */
  readonly connectionCount: number;
}
```

### WsSocket Interface

To integrate with any WebSocket library, implement this interface:

```typescript
interface WsSocket {
  send(data: Uint8Array | string): void;
  close(code?: number, reason?: string): void;
  onMessage(handler: (data: Uint8Array | string) => void): void;
  onClose(handler: (code: number, reason: string) => void): void;
  onError(handler: (error: Error) => void): void;
  readonly readyState: "connecting" | "open" | "closing" | "closed";
}
```

Helper wrappers are provided:

- `wrapWsSocket(ws)` - For the `ws` library (Node.js)
- `wrapStandardWebSocket(ws)` - For the standard WebSocket API (browser)

## Comparison with Native Adapter

| Feature | Native Adapter | Compat Adapter |
|---------|---------------|----------------|
| Protocol | loro-extended native | Loro Syncing Protocol |
| Message translation | None | Required |
| Batch support | Native | Requires workaround |
| Semantic preservation | Full | Partial |
| Interop with Loro servers | No | Yes |

## License

MIT
