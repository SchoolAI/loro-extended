# Switching from SSE to HTTP Polling

This guide explains how to swap the SSE (Server-Sent Events) adapter for the HTTP Polling adapter in the Todo example, and discusses the tradeoffs between these two approaches.

## Why Consider HTTP Polling?

### SSE Advantages

- **True real-time**: Messages arrive instantly as they're sent
- **Efficient**: Single persistent connection, no repeated handshakes
- **Browser-native**: Uses the standard `EventSource` API

### SSE Limitations

- **Proxy/Load Balancer Issues**: Some infrastructure cuts long-lived connections
- **Connection Limits**: Browsers limit concurrent SSE connections per domain (~6)
- **Serverless Unfriendly**: Doesn't work well with AWS Lambda, Vercel, etc.
- **Firewall Issues**: Some corporate firewalls block SSE

### HTTP Polling Advantages

- **Universal Compatibility**: Works with any HTTP infrastructure
- **Serverless Friendly**: Perfect for Lambda, Vercel, Cloudflare Workers
- **Firewall Friendly**: Just regular HTTP requests
- **Resilient**: Gracefully handles connection drops
- **Configurable**: Trade latency for battery life

### HTTP Polling Limitations

- **Latency**: Messages arrive on next poll (mitigated by long-polling)
- **More Requests**: Higher request volume (mitigated by long-polling)
- **Server Resources**: Long-polling holds connections open

## The Migration

### 1. Update Dependencies

```diff
// package.json
{
  "dependencies": {
-   "@loro-extended/adapter-sse": "workspace:^",
+   "@loro-extended/adapter-http-polling": "workspace:^",
  }
}
```

### 2. Update Server (`src/server/server.ts`)

```diff
-import {
-  createSseExpressRouter,
-  SseServerNetworkAdapter,
-} from "@loro-extended/adapter-sse/server"
+import {
+  createHttpPollingExpressRouter,
+  HttpPollingServerNetworkAdapter,
+} from "@loro-extended/adapter-http-polling/server"

// ... (logging config unchanged)

-const sseAdapter = new SseServerNetworkAdapter()
+const pollingAdapter = new HttpPollingServerNetworkAdapter()
const storageAdapter = new LevelDBStorageAdapter("loro-todo-app.db")

new Repo({
  identity: { name: "todo-app-server", type: "service" },
- adapters: [sseAdapter, storageAdapter],
+ adapters: [pollingAdapter, storageAdapter],
})

app.use(
  "/loro",
- createSseExpressRouter(sseAdapter, {
-   syncPath: "/sync",
-   eventsPath: "/events",
-   heartbeatInterval: 30000,
- }),
+ createHttpPollingExpressRouter(pollingAdapter, {
+   syncPath: "/sync",
+   pollPath: "/poll",
+   maxServerWait: 30000,  // Max time to hold a long-poll request
+ }),
)
```

### 3. Update Client (`src/main.tsx`)

```diff
-import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client"
+import { HttpPollingClientNetworkAdapter } from "@loro-extended/adapter-http-polling/client"

-const sseAdapter = new SseClientNetworkAdapter({
-  postUrl: "/loro/sync",
-  eventSourceUrl: peerId => `/loro/events?peerId=${peerId}`,
-})
+const pollingAdapter = new HttpPollingClientNetworkAdapter({
+  postUrl: () => "/loro/sync",
+  pollUrl: peerId => `/loro/poll?peerId=${peerId}`,
+  serverWaitHint: 30000,  // Ask server to wait up to 30s for messages
+  minPollInterval: 100,   // Rate limit: min 100ms between polls on errors
+  pollDelay: 0,           // Immediate re-poll after response (real-time feel)
+})

const config: RepoParams = {
  identity: { type: "user", name: "chat" },
- adapters: [sseAdapter],
+ adapters: [pollingAdapter],
}
```

### 4. No Changes Required!

The application logic in `src/client/todo-app.tsx` requires **zero changes**. The adapter abstraction properly encapsulates the transport mechanism, so your React components remain blissfully unaware of how sync happens.

## Configuration Options Explained

### Client Options

| Option            | Default | Description                                                                    |
| ----------------- | ------- | ------------------------------------------------------------------------------ |
| `serverWaitHint`  | 30000ms | How long to ask the server to wait for messages. Set to 0 for regular polling. |
| `minPollInterval` | 100ms   | Minimum time between polls. Prevents hammering on errors.                      |
| `pollDelay`       | 0ms     | Delay after successful response before re-polling.                             |

### Server Options

| Option              | Default  | Description                                                   |
| ------------------- | -------- | ------------------------------------------------------------- |
| `maxServerWait`     | 60000ms  | Maximum time server will hold a request (caps client's hint). |
| `connectionTimeout` | 120000ms | Remove connections inactive for this long.                    |

## Configuration Presets

### Real-Time (Long-Polling)

Best for: Collaborative apps where latency matters

```typescript
new HttpPollingClientNetworkAdapter({
  pollUrl: (peerId) => `/loro/poll?peerId=${peerId}`,
  postUrl: () => "/loro/sync",
  serverWaitHint: 30000, // Wait up to 30s
  minPollInterval: 100,
  pollDelay: 0, // Immediate re-poll
});
```

### Battery-Friendly

Best for: Mobile apps, background sync

```typescript
new HttpPollingClientNetworkAdapter({
  pollUrl: (peerId) => `/loro/poll?peerId=${peerId}`,
  postUrl: () => "/loro/sync",
  serverWaitHint: 0, // Don't wait, return immediately
  minPollInterval: 100,
  pollDelay: 5000, // Poll every 5 seconds
});
```

### Serverless-Friendly

Best for: AWS Lambda, Vercel (short timeouts)

```typescript
new HttpPollingClientNetworkAdapter({
  pollUrl: (peerId) => `/loro/poll?peerId=${peerId}`,
  postUrl: () => "/loro/sync",
  serverWaitHint: 10000, // Short wait (Lambda ~15s timeout)
  minPollInterval: 100,
  pollDelay: 0,
});
```

## How Long-Polling Works

```
Client                          Server
  |                               |
  |-- GET /poll?wait=30000 ------>|
  |                               | (waits for messages...)
  |                               | (message arrives after 5s)
  |<-- 200 OK, messages: [...] ---|
  |                               |
  |-- GET /poll?wait=30000 ------>|
  |                               | (waits...)
  |                               | (timeout after 30s)
  |<-- 200 OK, messages: [] ------|
  |                               |
  |-- GET /poll?wait=30000 ------>|
  |                               |
```

### Resilience to Infrastructure Cuts

If your load balancer or proxy cuts the connection early (e.g., 10s timeout):

```
Client                          Server
  |                               |
  |-- GET /poll?wait=30000 ------>|
  |                               | (waits...)
  |<-- CONNECTION RESET --------- | (infra cuts at 10s)
  |                               |
  | (wait minPollInterval)        |
  |                               |
  |-- GET /poll?wait=30000 ------>|
  |                               |
```

The client automatically re-polls after `minPollInterval`, making the system self-healing.

## Endpoint Comparison

| Purpose          | SSE                             | HTTP Polling                   |
| ---------------- | ------------------------------- | ------------------------------ |
| Send messages    | `POST /loro/sync`               | `POST /loro/sync`              |
| Receive messages | `GET /loro/events` (SSE stream) | `GET /loro/poll` (JSON)        |
| Disconnect       | Connection close                | `DELETE /loro/poll` (optional) |

## When to Choose Each

| Scenario                      | Recommendation                      |
| ----------------------------- | ----------------------------------- |
| Real-time collaboration       | SSE (if infrastructure supports it) |
| Serverless deployment         | HTTP Polling                        |
| Mobile app (battery concerns) | HTTP Polling with `pollDelay`       |
| Corporate network/firewalls   | HTTP Polling                        |
| Simple infrastructure         | SSE                                 |
| Maximum compatibility         | HTTP Polling                        |

## Summary

The HTTP Polling adapter provides a universal, resilient alternative to SSE that works in any environment. With long-polling enabled (`serverWaitHint > 0`), you get near-real-time performance while maintaining compatibility with restrictive infrastructure.

The migration is straightforward: change imports, swap adapter classes, and adjust configuration. Your application logic remains unchanged.
