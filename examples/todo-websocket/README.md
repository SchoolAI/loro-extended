# Collaborative Todo with Vite

A collaborative todo app using **Node.js + Vite** instead of Bun. Same functionality as `todo-minimal`, but with Vite's hot module reloading for a better development experience.

## Quick Start

```bash
# From the loro-extended root
pnpm install

# Start the server
cd examples/todo-vite
pnpm dev
```

Open http://localhost:5173 in two browser tabs and watch todos sync in real-time!

## What's Here

```
todo-vite/
├── src/
│   ├── app.tsx      # React app with schema (same as todo-minimal)
│   ├── server.ts    # Node.js server with Vite middleware + ws
│   └── styles.css   # Minimal styling
├── index.html       # Vite entry point
├── vite.config.ts   # Vite configuration
└── package.json
```

## Architecture

This example uses a single Node.js server that:

1. **Vite middleware mode** - Serves and bundles the React frontend with HMR
2. **WebSocket server** - Uses the `ws` library for loro-extended sync
3. **Same frontend** - Identical React code to `todo-minimal`

```
┌─────────────────────────────────────────┐
│           Node.js HTTP Server           │
├─────────────────────────────────────────┤
│  /ws path → WebSocket (ws library)      │
│  /* paths → Vite middleware (HMR)       │
└─────────────────────────────────────────┘
```

## Server Code

```typescript
import http from "node:http"
import { createServer as createViteServer } from "vite"
import { WebSocketServer } from "ws"
import { WsServerNetworkAdapter, wrapWsSocket } from "@loro-extended/adapter-websocket/server"
import { Repo } from "@loro-extended/repo"

// Create loro-extended repo
const wsAdapter = new WsServerNetworkAdapter()
new Repo({ adapters: [wsAdapter] })

// Create HTTP server with Vite middleware
const httpServer = http.createServer()
const vite = await createViteServer({
  server: { middlewareMode: { server: httpServer } }
})
httpServer.on("request", vite.middlewares)

// Create WebSocket server
const wss = new WebSocketServer({ server: httpServer, path: "/ws" })
wss.on("connection", ws => {
  wsAdapter.handleConnection({ socket: wrapWsSocket(ws) }).start()
})

httpServer.listen(5173)
```

## Comparison with todo-minimal

| Aspect | todo-minimal | todo-vite |
|--------|--------------|-----------|
| Runtime | Bun | Node.js |
| Bundler | Bun.build | Vite |
| WebSocket | Bun.serve | ws library |
| Dev experience | Manual restart | Vite HMR |
| Run command | `bun --hot src/server.ts` | `tsx src/server.ts` |

## Requirements

- Node.js 18+ (for native fetch and ES modules)
- pnpm (for workspace dependencies)
