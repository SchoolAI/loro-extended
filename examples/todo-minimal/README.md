# Minimal Collaborative Todo

A **~170 line** TypeScript example showing the core of loro-extended: real-time collaborative state with React.

**No Vite. No concurrently. Just Bun.**

## Quick Start

```bash
# From the loro-extended root
pnpm install

# Start the server (builds client automatically)
cd examples/todo-minimal
bun run dev
```

Open http://localhost:3000 in two browser tabs and watch todos sync in real-time!

## What's Here

```
todo-minimal/
├── src/
│   ├── app.tsx      # 90 lines - React app with schema
│   ├── server.ts    # 78 lines - Bun server with WebSocket
│   └── styles.css   # 68 lines - Minimal styling
├── index.html       # 12 lines
└── package.json     # 21 lines
```

## The Core Pattern

### 1. Define a Schema

```tsx
const TodoSchema = Shape.doc({
  todos: Shape.list(
    Shape.plain.struct({
      id: Shape.plain.string(),
      text: Shape.plain.string(),
      done: Shape.plain.boolean(),
    })
  ),
})
```

### 2. Use the Handle

```tsx
function App() {
  const handle = useHandle("todos", TodoSchema)
  const { todos } = useDoc(handle)

  // Mutate with handle.doc (direct) or handle.change (batch)
  const add = (text: string) => {
    handle.doc.todos.push({ id: generateUUID(), text, done: false })
  }
}
```

### 3. Connect to Server

```tsx
const wsAdapter = new WsClientNetworkAdapter({
  url: () => `ws://${location.host}/ws`,
})

<RepoProvider config={{ adapters: [wsAdapter] }}>
  <App />
</RepoProvider>
```

### 4. Server (Bun)

```typescript
import { wrapBunWebSocket, type BunWsData } from "@loro-extended/adapter-websocket/bun"

const wsAdapter = new WsServerNetworkAdapter()
new Repo({ adapters: [wsAdapter] })

Bun.serve<BunWsData>({
  websocket: {
    open(ws) {
      wsAdapter.handleConnection({ socket: wrapBunWebSocket(ws) }).start()
    },
    message(ws, msg) {
      ws.data.handlers.onMessage(msg instanceof ArrayBuffer ? new Uint8Array(msg) : msg)
    },
    close(ws, code, reason) {
      ws.data.handlers.onClose(code, reason)
    },
  },
})
```

## What's NOT Here (Intentionally)

This example focuses on the essentials. For production features, see `examples/todo-websocket`:

- ❌ Persistence (LevelDB)
- ❌ Connection status indicator
- ❌ URL-based document routing
- ❌ Logging configuration
- ❌ Hot module reloading (restart server to see changes)

## How It Works

1. **On server start**: Bun builds `src/app.tsx` → `dist/app.js`
2. **Browser loads**: `index.html` → `dist/app.js`
3. **WebSocket connects**: Client ↔ Server sync via loro-extended protocol
4. **Changes sync**: Any mutation propagates to all connected clients

## Requirements

- [Bun](https://bun.sh) runtime (for server + bundler)
- pnpm (for workspace dependencies)
