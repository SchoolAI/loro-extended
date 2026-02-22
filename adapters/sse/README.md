# @loro-extended/adapter-sse

Server-Sent Events (SSE) network adapter for [@loro-extended/repo](../../packages/repo) - enables real-time client-server document synchronization using SSE for server→client messages and HTTP POST for client→server messages.

## Overview

This adapter uses an asymmetric wire format:

- **Client → Server (POST)**: Binary CBOR encoding with transport-layer fragmentation
- **Server → Client (SSE)**: JSON encoding (SSE is a text-only protocol)

The binary POST encoding provides ~33% bandwidth savings on binary-heavy payloads compared to JSON+base64.

## Installation

```bash
pnpm add @loro-extended/adapter-sse
```

## Client Usage

```typescript
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client"
import { Repo } from "@loro-extended/repo"

const sseAdapter = new SseClientNetworkAdapter({
  postUrl: "/loro/sync",
  eventSourceUrl: (peerId) => `/loro/events?peerId=${peerId}`,
})

const repo = new Repo({
  identity: { peerId: "my-peer-id", name: "My App", type: "user" },
  adapters: [sseAdapter],
})
```

### Client Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `postUrl` | `string \| (peerId) => string` | required | URL for POST requests |
| `eventSourceUrl` | `string \| (peerId) => string` | required | URL for SSE connection |
| `fragmentThreshold` | `number` | `81920` (80KB) | Messages larger than this are fragmented |
| `reconnect.maxAttempts` | `number` | `10` | Maximum reconnection attempts |
| `postRetry.maxAttempts` | `number` | `3` | Maximum POST retry attempts |
| `postRetry.baseDelay` | `number` | `1000` | Base delay for exponential backoff (ms) |
| `postRetry.maxDelay` | `number` | `10000` | Maximum retry delay (ms) |

## Server Usage (Express)

```typescript
import { createSseExpressRouter, SseServerNetworkAdapter } from "@loro-extended/adapter-sse/express"
import { Repo } from "@loro-extended/repo"
import express from "express"

const app = express()

const sseAdapter = new SseServerNetworkAdapter()
const repo = new Repo({
  identity: { peerId: "server", name: "Server", type: "service" },
  adapters: [sseAdapter],
})

app.use("/loro", createSseExpressRouter(sseAdapter, {
  syncPath: "/sync",
  eventsPath: "/events",
  heartbeatInterval: 30000,
}))

app.listen(3000)
```

### Express Router Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `syncPath` | `string` | `"/sync"` | Path for POST endpoint |
| `eventsPath` | `string` | `"/events"` | Path for SSE endpoint |
| `heartbeatInterval` | `number` | `30000` | Heartbeat interval (ms) |
| `getPeerIdFromSyncRequest` | `(req) => PeerID` | reads `x-peer-id` header | Custom peerId extraction |
| `getPeerIdFromEventsRequest` | `(req) => PeerID` | reads `peerId` query param | Custom peerId extraction |

## Wire Format

### POST Requests (Client → Server)

POST requests use binary CBOR encoding with transport-layer prefixes:

```
Content-Type: application/octet-stream
X-Peer-Id: <peer-id>

Body: [prefix][payload...]
```

| Prefix | Name | Description |
|--------|------|-------------|
| `0x00` | MESSAGE_COMPLETE | Complete message (not fragmented) |
| `0x01` | FRAGMENT_HEADER | Start of a fragmented batch |
| `0x02` | FRAGMENT_DATA | Fragment data chunk |

### SSE Messages (Server → Client)

SSE messages are JSON-encoded (SSE is text-only):

```
data: {"type":"channel/sync-response","docId":"...","transmission":{...}}
```

### Fragmentation

Large messages are automatically fragmented into multiple POST requests. The default threshold is 80KB, providing a safety margin below the typical 100KB body-parser limit.

Each fragment is sent as a separate POST request. The server reassembles fragments using the `FragmentReassembler` in `SseConnection`.

## Custom Framework Integration

The `parsePostBody` function provides a framework-agnostic handler for POST requests:

```typescript
import { parsePostBody } from "@loro-extended/adapter-sse/express"

// In your framework's request handler
const result = parsePostBody(connection.reassembler, bodyAsUint8Array)

if (result.type === "messages") {
  for (const msg of result.messages) {
    connection.receive(msg)
  }
}

// Send response
response.status(result.response.status).json(result.response.body)
```

### Response Types

| Result Type | HTTP Status | Meaning |
|-------------|-------------|---------|
| `messages` | 200 | Message(s) decoded successfully |
| `pending` | 202 | Fragment received, waiting for more |
| `error` | 400 | Decode or reassembly error |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          Client                                 │
│  ┌─────────────────────┐        ┌─────────────────────┐        │
│  │ SseClientAdapter    │        │ EventSource         │        │
│  │ (binary POST)       │───────▶│ (JSON receive)      │        │
│  └─────────────────────┘        └─────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
              │                             ▲
              │ HTTP POST                   │ SSE
              │ (binary CBOR)               │ (JSON)
              ▼                             │
┌─────────────────────────────────────────────────────────────────┐
│                          Server                                 │
│  ┌─────────────────────┐        ┌─────────────────────┐        │
│  │ Express Router      │        │ SSE Writer          │        │
│  │ (parsePostBody)     │───────▶│ (serializeChannelMsg│        │
│  └─────────────────────┘        └─────────────────────┘        │
│              │                             ▲                    │
│              ▼                             │                    │
│  ┌─────────────────────────────────────────────────────────────┤
│  │            SseServerNetworkAdapter                          │
│  │  ┌──────────────────────────────────────────────────┐       │
│  │  │ SseConnection (per peer)                         │       │
│  │  │ - FragmentReassembler (handles large POSTs)      │       │
│  │  │ - Channel reference                              │       │
│  │  └──────────────────────────────────────────────────┘       │
│  └─────────────────────────────────────────────────────────────┤
└─────────────────────────────────────────────────────────────────┘
```

## Version Compatibility

The binary wire format (v2) is **not compatible** with the legacy JSON POST format. All clients and servers must use the same version.

## License

MIT