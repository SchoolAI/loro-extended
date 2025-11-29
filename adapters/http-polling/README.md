# @loro-extended/adapter-http-polling

HTTP polling network adapter for `@loro-extended/repo` with resilient long-polling support.

## Features

- **Resilient by Default**: Long-polling gracefully degrades to regular polling when infrastructure cuts connections short
- **Unified Model**: Polling and long-polling use the same code path with configurable timing
- **Self-Healing**: Connection cuts are handled automatically with rate-limiting protection
- **Infrastructure Agnostic**: Works with any HTTP infrastructure, regardless of timeout limitations

## Installation

```bash
pnpm add @loro-extended/adapter-http-polling
```

## Usage

### Server (Express)

```typescript
import express from "express"
import {
  HttpPollingServerNetworkAdapter,
  createHttpPollingExpressRouter,
} from "@loro-extended/adapter-http-polling/server"
import { Repo } from "@loro-extended/repo"

const adapter = new HttpPollingServerNetworkAdapter()
const repo = new Repo({
  identity: { name: "server", type: "service" },
  adapters: [adapter],
})

const app = express()
app.use(express.json())
app.use("/loro", createHttpPollingExpressRouter(adapter))

app.listen(3000)
```

### Client (Browser)

```typescript
import { HttpPollingClientNetworkAdapter } from "@loro-extended/adapter-http-polling/client"
import { Repo } from "@loro-extended/repo"

const adapter = new HttpPollingClientNetworkAdapter({
  pollUrl: (peerId) => `/loro/poll?peerId=${peerId}`,
  postUrl: () => `/loro/sync`,
  serverWaitHint: 30000, // Ask server to wait up to 30s for messages
  minPollInterval: 100, // Rate limit on errors
  pollDelay: 0, // Immediate re-poll for real-time feel
})

const repo = new Repo({
  identity: { name: "client", type: "user" },
  adapters: [adapter],
})
```

## Configuration

### Client Options

```typescript
interface HttpPollingClientOptions {
  // URL for polling (GET requests) - should include peerId
  pollUrl: string | ((peerId: PeerID) => string)

  // URL for sending messages (POST requests)
  postUrl: string | ((peerId: PeerID) => string)

  // How long to ask the server to wait for messages (hint, not guarantee)
  // Server may return sooner due to: messages available, infra timeout, server config
  // Set to 0 for regular polling behavior
  // Default: 30000ms
  serverWaitHint?: number

  // Minimum time between poll requests (prevents hammering on errors/cuts)
  // Default: 100ms
  minPollInterval?: number

  // Optional delay after successful response before re-polling
  // Default: 0ms (immediate re-poll for real-time feel)
  pollDelay?: number

  // Optional fetch options (headers, credentials, etc.)
  fetchOptions?: RequestInit
}
```

### Server Router Options

```typescript
interface HttpPollingExpressRouterOptions {
  // Path for the poll endpoint (GET)
  // Default: "/poll"
  pollPath?: string

  // Path for the sync endpoint (POST)
  // Default: "/sync"
  syncPath?: string

  // Maximum time server will hold a long-poll request
  // Default: 60000ms
  maxServerWait?: number

  // Custom peer ID extraction from poll request
  getPeerIdFromPollRequest?: (req: Request) => PeerID | undefined

  // Custom peer ID extraction from sync request
  getPeerIdFromSyncRequest?: (req: Request) => PeerID | undefined
}
```

## Configuration Examples

### Real-time (Long-Polling)

Best for: Real-time collaborative apps

```typescript
new HttpPollingClientNetworkAdapter({
  pollUrl: (peerId) => `/api/poll?peerId=${peerId}`,
  postUrl: () => `/api/sync`,
  serverWaitHint: 30000, // Wait up to 30s for messages
  minPollInterval: 100, // Rate limit on errors
  pollDelay: 0, // Immediate re-poll
})
```

### Battery-Friendly (Regular Polling)

Best for: Mobile apps, background sync

```typescript
new HttpPollingClientNetworkAdapter({
  pollUrl: (peerId) => `/api/poll?peerId=${peerId}`,
  postUrl: () => `/api/sync`,
  serverWaitHint: 0, // Don't wait, return immediately
  minPollInterval: 100, // Rate limit on errors
  pollDelay: 5000, // Poll every 5 seconds
})
```

### Serverless-Friendly

Best for: AWS Lambda, Vercel (short timeouts)

```typescript
new HttpPollingClientNetworkAdapter({
  pollUrl: (peerId) => `/api/poll?peerId=${peerId}`,
  postUrl: () => `/api/sync`,
  serverWaitHint: 10000, // Short wait (Lambda timeout ~15s)
  minPollInterval: 100, // Rate limit on errors
  pollDelay: 0, // Immediate re-poll
})
```

## How It Works

### Resilient Polling Model

The adapter uses a unified polling model that gracefully handles infrastructure limitations:

1. **Client sends poll request** with a `wait` parameter indicating how long the server should wait
2. **Server waits** for messages or until timeout (whichever comes first)
3. **If infrastructure cuts the connection** (e.g., load balancer timeout), the client automatically re-polls after `minPollInterval`
4. **Messages are batched** on the server and delivered in a single response

This means:

- Works great with long-polling infrastructure ✓
- Gracefully degrades if infra cuts connections ✓
- Protects against hammering ✓
- Configurable for different use cases ✓

### Endpoints

The Express router creates these endpoints:

- `GET /poll?peerId=xxx&wait=30000` - Poll for messages (long-polling supported)
- `POST /sync` - Send messages (with `X-Peer-Id` header)
- `DELETE /poll?peerId=xxx` - Explicit disconnect (optional)

## License

MIT