# @loro-extended/network-sse

Server-Sent Events (SSE) network adapter for [@loro-extended/repo](../repo) that enables real-time synchronization between clients and servers using a simple HTTP-based protocol.

## Overview

This package provides two network adapter implementations:
- **`SseClientNetworkAdapter`** - For browser/client applications
- **`SseServerNetworkAdapter`** - For Node.js/Express servers

These adapters enable real-time, bidirectional synchronization of Loro documents using Server-Sent Events for server-to-client communication and regular HTTP POST requests for client-to-server communication.

## Features

- 🔄 Real-time bidirectional sync using SSE + HTTP
- 🔌 Automatic reconnection on connection loss (client-side)
- 📦 Binary data support via base64 encoding
- 🚀 Simple Express.js integration
- 💾 Works seamlessly with storage adapters

## Installation

```bash
npm install @loro-extended/network-sse
# or
pnpm add @loro-extended/network-sse
```

## Usage

### Client-Side Setup

```typescript
import { Repo } from "@loro-extended/repo"
import { SseClientNetworkAdapter } from "@loro-extended/network-sse/client"
import { IndexedDBStorageAdapter } from "./IndexedDBStorageAdapter"

// Create the SSE network adapter pointing to your server endpoint
const network = new SseClientNetworkAdapter("/loro")

// Create a storage adapter (optional but recommended)
const storage = new IndexedDBStorageAdapter()

// Initialize the Repo with both adapters
const repo = new Repo({ 
  network: [network], 
  storage 
})
```

### Server-Side Setup

```typescript
import express from "express"
import { Repo } from "@loro-extended/repo"
import { SseServerNetworkAdapter } from "@loro-extended/network-sse/server"
import { LevelStorageAdapter } from "./LevelStorageAdapter"

const app = express()
app.use(express.json())

// 1. Create the SSE server adapter
const sseAdapter = new SseServerNetworkAdapter()

// 2. Create a storage adapter for persistence
const storageAdapter = new LevelStorageAdapter("loro-app.db")

// 3. Create the Repo with both adapters
// The repo constructor automatically sets up the listeners
new Repo({
  storage: storageAdapter,
  network: [sseAdapter],
})

// 4. Mount the adapter's Express routes
app.use("/loro", sseAdapter.getExpressRouter())

app.listen(5170, () => {
  console.log("Server listening on http://localhost:5170")
})
```

## How It Works

1. **Client connects** to the server via SSE at `/loro/events?peerId={peerId}`
2. **Server streams** document updates to connected clients in real-time
3. **Client sends** updates to the server via POST requests to `/loro/sync`
4. **Automatic serialization** handles binary data (Uint8Array) via base64 encoding

## API Reference

### SseClientNetworkAdapter

```typescript
class SseClientNetworkAdapter implements NetworkAdapter {
  constructor(serverUrl: string)
  
  // NetworkAdapter interface
  connect(peerId: PeerId, metadata: PeerMetadata): void
  disconnect(): void
  send(message: RepoMessage): Promise<void>
}
```

### SseServerNetworkAdapter

```typescript
class SseServerNetworkAdapter implements NetworkAdapter {
  // NetworkAdapter interface
  connect(peerId: PeerId, metadata: PeerMetadata): void
  disconnect(): void
  send(message: RepoMessage): void
  
  // Express integration
  getExpressRouter(): Router
}
```

## Express Routes

The server adapter provides these routes via `getExpressRouter()`:

- `GET /events?peerId={id}` - SSE endpoint for real-time updates
- `POST /sync` - Endpoint for receiving client updates

## Requirements

- Node.js 18+ (for server adapter)
- Modern browser with EventSource support (for client adapter)
- Express.js 4+ (for server integration)

## License

MIT