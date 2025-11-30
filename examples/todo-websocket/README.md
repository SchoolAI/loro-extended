# Loro Todo App (WebSocket)

A simple todo application demonstrating real-time synchronization using `@loro-extended/repo` with WebSocket transport.

This example is identical to the `todo` example, but uses WebSocket instead of Server-Sent Events (SSE) for real-time communication.

## Features

- Real-time synchronization across multiple clients via WebSocket
- Persistent storage using LevelDB
- Automatic reconnection with exponential backoff
- Conflict-free collaborative editing using Loro CRDTs

## Architecture

```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│  React Client   │◄──────────────────►│  Express Server │
│                 │                    │                 │
│  WsClient       │                    │  WsServer       │
│  NetworkAdapter │                    │  NetworkAdapter │
└─────────────────┘                    └────────┬────────┘
                                                │
                                                ▼
                                       ┌─────────────────┐
                                       │    LevelDB      │
                                       │    Storage      │
                                       └─────────────────┘
```

## Running the Example

1. Install dependencies from the repository root:

   ```bash
   pnpm install
   ```

2. Build the workspace packages:

   ```bash
   pnpm build
   ```

3. Start the development server:

   ```bash
   cd examples/todo-websocket
   pnpm dev
   ```

4. Open http://localhost:5173 in multiple browser windows to see real-time sync in action.

## Key Differences from SSE Example

### Client (`src/main.tsx`)

Uses `WsClientNetworkAdapter` instead of `SseClientNetworkAdapter`:

```typescript
import { WsClientNetworkAdapter } from "@loro-extended/adapter-websocket/client";

const wsAdapter = new WsClientNetworkAdapter({
  url: (peerId) => `/ws?peerId=${peerId}`,
  reconnect: { enabled: true },
});
```

### Server (`src/server/server.ts`)

Uses `WsServerNetworkAdapter` with the `ws` library:

```typescript
import { WebSocketServer } from "ws";
import {
  WsServerNetworkAdapter,
  wrapWsSocket,
} from "@loro-extended/adapter-websocket/server";

const wsAdapter = new WsServerNetworkAdapter();
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const peerId = url.searchParams.get("peerId");

  const { start } = wsAdapter.handleConnection({
    socket: wrapWsSocket(ws),
    peerId: peerId as PeerID | undefined,
  });
  start();
});
```

### Vite Config (`vite.config.ts`)

Configures WebSocket proxy instead of SSE:

```typescript
server: {
  proxy: {
    "/ws": {
      target: "ws://localhost:5170",
      ws: true,
    },
  },
}
```

## WebSocket vs SSE

| Feature         | WebSocket         | SSE                  |
| --------------- | ----------------- | -------------------- |
| Direction       | Bidirectional     | Server → Client only |
| Protocol        | Binary or text    | Text only            |
| Connection      | Single persistent | HTTP long-polling    |
| Reconnection    | Manual            | Automatic            |
| Browser Support | All modern        | All modern           |

WebSocket is generally preferred when:

- You need bidirectional communication
- You want lower latency
- You're sending binary data

SSE is simpler when:

- You only need server-to-client updates
- You want automatic reconnection
- You prefer HTTP-based infrastructure

## Scripts

- `pnpm dev` - Start both client and server in development mode
- `pnpm dev:client` - Start only the Vite dev server
- `pnpm dev:server` - Start only the Express server
- `pnpm build:all` - Build both client and server
- `pnpm test:e2e` - Run end-to-end tests
