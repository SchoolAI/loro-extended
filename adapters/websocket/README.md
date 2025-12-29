# @loro-extended/adapter-websocket

WebSocket network adapter for `@loro-extended/repo`.

## Installation

```bash
npm install @loro-extended/adapter-websocket
# or
pnpm add @loro-extended/adapter-websocket
```

## Client Usage

```typescript
import { Repo } from '@loro-extended/repo'
import { WsClientNetworkAdapter } from '@loro-extended/adapter-websocket/client'

const adapter = new WsClientNetworkAdapter({
  url: 'ws://localhost:3000/ws',
})

const repo = new Repo({
  identity: { peerId: 'client-1', name: 'Client', type: 'user' },
  adapters: [adapter],
})
```

### Client Options

```typescript
interface WsClientOptions {
  url: string | ((peerId: PeerID) => string)
  WebSocket?: typeof WebSocket  // For Node.js: import WebSocket from 'ws'
  reconnect?: {
    enabled: boolean      // default: true
    maxAttempts?: number  // default: 10
    baseDelay?: number    // default: 1000ms
    maxDelay?: number     // default: 30000ms
  }
  keepaliveInterval?: number  // default: 30000ms
}
```

## Server Usage

```typescript
import { Repo } from '@loro-extended/repo'
import { WsServerNetworkAdapter, wrapWsSocket } from '@loro-extended/adapter-websocket/server'
import { WebSocketServer } from 'ws'

const wss = new WebSocketServer({ port: 3000 })
const adapter = new WsServerNetworkAdapter()

const repo = new Repo({
  identity: { peerId: 'server', name: 'Server', type: 'service' },
  adapters: [adapter],
})

wss.on('connection', (ws, req) => {
  const url = new URL(req.url!, `http://localhost:3000`)
  const peerId = url.searchParams.get('peerId')

  const { start } = adapter.handleConnection({
    socket: wrapWsSocket(ws),
    peerId: peerId || undefined,
  })
  start()
})
```

## Protocol

See [PROTOCOL.md](./PROTOCOL.md) for wire format specification.

## Loro Protocol Compatibility

For interoperability with Loro Protocol servers, use `@loro-extended/adapter-websocket-compat` instead.

## License

MIT
