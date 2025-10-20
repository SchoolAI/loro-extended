# SSE Adapter: Channel-Based Refactoring

## Overview

This document outlines the implementation plan for refactoring the SSE (Server-Sent Events) adapters from the event-based `NetworkAdapter` pattern to the channel-based `Adapter<G>` architecture. This aligns SSE adapters with the unified adapter system used by storage adapters.

## Problem Statement

The current SSE adapters ([`client.ts`](../packages/adapters/src/network/sse/client.ts) and [`server.ts`](../packages/adapters/src/network/sse/server.ts)) extend `NetworkAdapter`, which uses an event-based system (Emittery). This creates inconsistency with the new channel-based architecture where:

1. **Storage adapters** extend `Adapter<void>` and use channels
2. **Network adapters** still use events (`peer-available`, `peer-disconnected`, `message-received`)
3. **Different mental models** for essentially the same concept (connections/channels)

## Design Goals

1. **Unified Architecture**: All adapters use the same `Adapter<G>` base class
2. **Channel-Based Communication**: Replace events with channel send/receive pattern
3. **Lazy Channel Creation**: Create channels only when needed (on connection)
4. **Preserve Express Integration**: Keep `getExpressRouter()` for easy demo app setup
5. **Deprecate NetworkAdapter**: Remove the event-based abstraction entirely

## Architecture

### Type Hierarchy

```typescript
// Base adapter (existing)
abstract class Adapter<G> {
  abstract generate(context: G): BaseChannel;
  abstract init(callbacks: { addChannel; removeChannel }): void;
  abstract deinit(): void;
  abstract start(): void;
}

// SSE Client (new)
class SseClientNetworkAdapter extends Adapter<void> {
  // Single channel to server
  private serverChannel?: Channel;
  private receive?: ReceiveFn;
  private eventSource?: ReconnectingEventSource;
}

// SSE Server (new)
class SseServerNetworkAdapter extends Adapter<PeerId> {
  // One channel per connected client (lazy creation)
  private clients: Map<PeerId, Response>;
  private receiveFns: Map<PeerId, ReceiveFn>;
  private channelsByPeer: Map<PeerId, Channel>;
}
```

### Key Design Decisions

#### 1. Context Types

**SSE Client: `Adapter<void>`**

- Only one server connection
- Similar to `StorageAdapter` pattern
- No per-channel context needed

**SSE Server: `Adapter<PeerId>`**

- One channel per connected client
- Context identifies which client the channel represents
- Enables lazy channel creation

**Rationale**: Matches the cardinality of connections. Client has one, server has many.

#### 2. Peer Identity Management

**Important**: `publishDocId` is a sidechannel for future purposes and should NOT be used as the `peerId`.

**Client Identity**:

```typescript
// Client generates its own peerId
constructor(serverUrl: string) {
  super({ adapterId: "sse-client" })
  this.peerId = uuid() // Generate unique ID
  this.serverUrl = serverUrl
}

// Send peerId in connection URL
start() {
  const url = `${this.serverUrl}/events?peerId=${this.peerId}`
  this.eventSource = new ReconnectingEventSource(url)
}
```

**Server Identity**:

```typescript
// Server extracts peerId from connection
#setupSseConnection(req: Request, res: Response) {
  const peerId = req.query.peerId as PeerId
  if (!peerId) {
    res.status(400).end("peerId query parameter is required")
    return
  }

  // Create channel for this specific peer
  const channel = this.addChannel!(peerId)
}
```

**Rationale**:

- Peer identity is separate from channel identity
- `publishDocId` is for future channel-level features
- `peerId` identifies the peer across reconnections

#### 3. Lazy Channel Creation (Server)

**Decision**: Create channels when clients connect, not eagerly.

**Implementation**:

```typescript
#setupSseConnection(req: Request, res: Response) {
  const peerId = req.query.peerId as PeerId

  // Create channel lazily when client connects
  const channel = this.addChannel!(peerId)
  this.channelsByPeer.set(peerId, channel)
  this.clients.set(peerId, res)

  // Cleanup on disconnect
  req.on("close", () => {
    this.removeChannel!(channel.channelId)
    this.channelsByPeer.delete(peerId)
  })
}
```

**Rationale**:

- Matches current behavior
- No wasted resources for disconnected clients
- Simpler lifecycle management

#### 4. Express Router Integration

**Decision**: Keep `getExpressRouter()` method for easy setup.

**Rationale**:

- Makes demo app setup trivial
- Familiar pattern for Express users
- Can be extracted to separate package later if needed

## Implementation Plan

### Phase 1: Deprecate NetworkAdapter

#### 1.1 Mark NetworkAdapter as Deprecated

**File**: `packages/repo/src/network/network-adapter.ts`

**Changes**:

```typescript
/**
 * @deprecated Use Adapter<G> directly instead. This class will be removed in a future version.
 *
 * NetworkAdapter provided an event-based abstraction that is no longer needed.
 * Extend Adapter<G> and implement the channel-based pattern instead.
 */
export abstract class NetworkAdapter {
  // ... existing code
}
```

#### 1.2 Plan for Removal

- Add deprecation notices to documentation
- Update examples to not use NetworkAdapter
- Schedule removal for next major version

### Phase 2: Refactor SSE Client

#### 2.1 Update Class Declaration

**File**: `packages/adapters/src/network/sse/client.ts`

**Before**:

```typescript
export class SseClientNetworkAdapter extends NetworkAdapter {
  peerId?: PeerId
  #serverUrl: string
  #eventSource?: ReconnectingEventSource
```

**After**:

```typescript
export class SseClientNetworkAdapter extends Adapter<void> {
  private peerId: PeerId
  private serverUrl: string
  private serverChannel?: Channel
  private receive?: ReceiveFn
  private eventSource?: ReconnectingEventSource
```

#### 2.2 Update Constructor

```typescript
constructor(serverUrl: string) {
  super({ adapterId: "sse-client" })
  this.peerId = uuid() // Generate unique peer ID
  this.serverUrl = serverUrl
}
```

#### 2.3 Implement generate()

```typescript
protected generate(): BaseChannel {
  return {
    kind: "network",
    adapterId: this.adapterId,
    send: async (msg: ChannelMsg) => {
      // Serialize and send via HTTP POST
      const serialized = this.#serializeMessage(msg)
      const response = await fetch(`${this.serverUrl}/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Peer-Id": this.peerId, // Include peerId in header
        },
        body: JSON.stringify(serialized),
      })

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`)
      }
    },
    start: (receive) => {
      this.receive = receive
    },
    stop: () => {
      this.receive = undefined
    },
  }
}
```

#### 2.4 Implement init()

```typescript
init({ addChannel }) {
  // Create single channel for server connection
  this.serverChannel = addChannel()
}
```

#### 2.5 Implement deinit()

```typescript
deinit() {
  this.eventSource?.close()
  this.eventSource = undefined
  this.serverChannel = undefined
  this.receive = undefined
}
```

#### 2.6 Implement start()

```typescript
start() {
  // Connect to server with peerId
  const url = `${this.serverUrl}/events?peerId=${this.peerId}`
  this.eventSource = new ReconnectingEventSource(url)

  this.eventSource.onmessage = (event) => {
    const serialized = JSON.parse(event.data)
    const message = this.#deserializeMessage(serialized) as ChannelMsg

    // Send to channel via receive function
    this.receive?.(message)
  }

  this.eventSource.onerror = (err) => {
    this.logger.warn("SSE connection error", { error: err })
    // Connection will auto-reconnect via ReconnectingEventSource
  }

  this.eventSource.onopen = () => {
    this.logger.debug("SSE connection established")
  }
}
```

#### 2.7 Remove Event-Based Methods

**Remove**:

- `peerAvailable()`
- `peerDisconnected()`
- `messageReceived()`
- All Emittery-related code

### Phase 3: Refactor SSE Server

#### 3.1 Update Class Declaration

**File**: `packages/adapters/src/network/sse/server.ts`

**Before**:

```typescript
export class SseServerNetworkAdapter extends NetworkAdapter {
  #clients = new Map<PeerId, Response>()
  #heartbeats = new Map<PeerId, NodeJS.Timeout>()
```

**After**:

```typescript
export class SseServerNetworkAdapter extends Adapter<PeerId> {
  private clients = new Map<PeerId, Response>()
  private receiveFns = new Map<PeerId, ReceiveFn>()
  private heartbeats = new Map<PeerId, NodeJS.Timeout>()
  private channelsByPeer = new Map<PeerId, Channel>()
  private addChannel?: (context: PeerId) => Channel
  private removeChannel?: (channelId: ChannelId) => Channel | undefined
```

#### 3.2 Update Constructor

```typescript
constructor() {
  super({ adapterId: "sse-server" })
}
```

#### 3.3 Implement generate()

```typescript
protected generate(peerId: PeerId): BaseChannel {
  return {
    kind: "network",
    adapterId: this.adapterId,
    send: async (msg: ChannelMsg) => {
      const clientRes = this.clients.get(peerId)
      if (clientRes) {
        const serialized = this.#serializeMessage(msg)
        clientRes.write(`data: ${JSON.stringify(serialized)}\n\n`)
      } else {
        this.logger.warn("Tried to send to disconnected peer", { peerId })
      }
    },
    start: (receive) => {
      // Store receive function for this peer
      this.receiveFns.set(peerId, receive)
    },
    stop: () => {
      // Cleanup receive function
      this.receiveFns.delete(peerId)
      this.#cleanupConnection(peerId)
    },
  }
}
```

#### 3.4 Implement init()

```typescript
init({ addChannel, removeChannel }) {
  // Store callbacks for lazy channel creation
  this.addChannel = addChannel
  this.removeChannel = removeChannel
}
```

#### 3.5 Implement deinit()

```typescript
deinit() {
  // Close all active client connections
  for (const [peerId, res] of this.clients) {
    res.end()
  }

  // Clear all heartbeats
  for (const timeout of this.heartbeats.values()) {
    clearTimeout(timeout)
  }

  // Clear all maps
  this.clients.clear()
  this.receiveFns.clear()
  this.heartbeats.clear()
  this.channelsByPeer.clear()

  this.logger.info("SSE server adapter deinitialized")
}
```

#### 3.6 Implement start()

```typescript
start() {
  // Nothing to do - server waits for connections
  this.logger.info("SSE server adapter started")
}
```

#### 3.7 Update Express Router

```typescript
public getExpressRouter(): Router {
  const router = express.Router()

  // Endpoint for clients to send messages TO the server
  router.post("/sync", (req, res) => {
    const serialized = req.body
    const message = this.#deserializeMessage(serialized) as ChannelMsg

    // Extract peerId from header or message
    const peerId = req.headers["x-peer-id"] as PeerId

    if (!peerId) {
      res.status(400).send({ error: "Missing X-Peer-Id header" })
      return
    }

    // Route to appropriate channel's receive function
    const receive = this.receiveFns.get(peerId)

    if (receive) {
      receive(message)
      res.status(200).send({ ok: true })
    } else {
      this.logger.warn("Received message from unknown peer", { peerId })
      res.status(404).send({ error: "Peer not connected" })
    }
  })

  // Endpoint for clients to connect and listen for events FROM the server
  router.get("/events", (req, res) => {
    this.#setupSseConnection(req, res)
  })

  return router
}
```

#### 3.8 Update Connection Setup

```typescript
#setupSseConnection(req: Request, res: Response) {
  // Set headers for SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })
  res.flushHeaders()

  const peerId = req.query.peerId as PeerId
  if (!peerId) {
    res.status(400).end("peerId query parameter is required")
    return
  }

  // Lazy channel creation
  const channel = this.addChannel!(peerId)
  this.channelsByPeer.set(peerId, channel)
  this.clients.set(peerId, res)

  this.logger.info("Client connected", {
    peerId,
    channelId: channel.channelId,
    totalClients: this.clients.size
  })

  // Setup heartbeat to detect stale connections
  this.#setupHeartbeat(peerId, res)

  // Handle client disconnect
  req.on("close", () => {
    this.logger.info("Client disconnected", {
      peerId,
      totalClients: this.clients.size - 1
    })

    // Remove channel
    this.removeChannel!(channel.channelId)
    this.channelsByPeer.delete(peerId)
    this.#cleanupConnection(peerId)
  })
}
```

#### 3.9 Keep Heartbeat Logic

```typescript
#setupHeartbeat(peerId: PeerId, res: Response) {
  // Clear any existing heartbeat for this peer
  const existingHeartbeat = this.heartbeats.get(peerId)
  if (existingHeartbeat) {
    clearTimeout(existingHeartbeat)
  }

  // Setup new heartbeat
  const heartbeat = setInterval(() => {
    try {
      // Send a heartbeat comment (SSE comments are ignored by clients)
      res.write(": heartbeat\n\n")
    } catch (err) {
      // If we can't write to the response, the connection is dead
      this.logger.warn("Heartbeat failed, cleaning up connection", { peerId })
      const channel = this.channelsByPeer.get(peerId)
      if (channel) {
        this.removeChannel!(channel.channelId)
      }
      this.channelsByPeer.delete(peerId)
      this.#cleanupConnection(peerId)
    }
  }, 30000) // 30 seconds

  this.heartbeats.set(peerId, heartbeat)
}

#cleanupConnection(peerId: PeerId) {
  // Clear heartbeat
  const heartbeat = this.heartbeats.get(peerId)
  if (heartbeat) {
    clearTimeout(heartbeat)
    this.heartbeats.delete(peerId)
  }

  // Remove client
  this.clients.delete(peerId)
}
```

#### 3.10 Remove Event-Based Methods

**Remove**:

- `peerAvailable()`
- `peerDisconnected()`
- `messageReceived()`
- All Emittery-related code

### Phase 4: Update Integration Points

#### 4.1 Update Repo Integration

**File**: `packages/repo/src/repo.ts`

**Changes**:

- Remove any NetworkAdapter-specific event handling
- Ensure AdapterManager handles all adapter types uniformly
- Update type constraints if needed

#### 4.2 Update NetworkSubsystem (if exists)

**File**: `packages/repo/src/network/network-subsystem.ts`

**Changes**:

- Remove event-based integration
- Use channel-based communication only
- May be able to remove this file entirely if it's just a wrapper

#### 4.3 Update Documentation

**Files**:

- `packages/repo/README.md`
- `packages/adapters/README.md`

**Changes**:

- Remove NetworkAdapter examples
- Show Adapter<G> pattern for network adapters
- Update SSE adapter examples

### Phase 5: Testing

#### 5.1 Unit Tests for SSE Client

**File**: `packages/adapters/src/network/sse/client.test.ts` (new)

**Test Cases**:

1. **Channel Creation**: Verify single channel is created
2. **Connection Lifecycle**: Test start/stop/reconnect
3. **Message Sending**: Verify HTTP POST with correct headers
4. **Message Receiving**: Verify EventSource messages are routed to receive function
5. **Serialization**: Test Uint8Array conversion
6. **Error Handling**: Test connection failures

**Example Test**:

```typescript
describe("SseClientNetworkAdapter", () => {
  it("creates single channel on init", () => {
    const adapter = new SseClientNetworkAdapter("http://localhost:3000");
    const channels: Channel[] = [];

    adapter.init({
      addChannel: () => {
        const channel = { channelId: 1 } as Channel;
        channels.push(channel);
        return channel;
      },
      removeChannel: () => undefined,
    });

    expect(channels).toHaveLength(1);
  });

  it("sends messages via HTTP POST", async () => {
    const adapter = new SseClientNetworkAdapter("http://localhost:3000");
    // ... setup mock fetch
    // ... test send
  });
});
```

#### 5.2 Unit Tests for SSE Server

**File**: `packages/adapters/src/network/sse/server.test.ts` (new)

**Test Cases**:

1. **Lazy Channel Creation**: Verify channels created on connection
2. **Multiple Clients**: Test multiple simultaneous connections
3. **Message Routing**: Verify messages route to correct peer
4. **Heartbeat**: Test heartbeat mechanism
5. **Disconnect Handling**: Test cleanup on disconnect
6. **Express Router**: Test router endpoints

#### 5.3 Integration Tests

**File**: `packages/adapters/src/network/sse/integration.test.ts` (new)

**Test Cases**:

1. **Client-Server Communication**: Full round-trip message test
2. **Multiple Clients**: Test multiple clients syncing
3. **Reconnection**: Test client reconnection handling
4. **Error Recovery**: Test error scenarios

#### 5.4 E2E Tests

**File**: `examples/todo-app/tests/e2e/sse-sync.spec.ts` (new)

**Test Cases**:

1. **Todo Sync**: Verify todos sync between clients via SSE
2. **Persistence**: Verify SSE + storage work together
3. **Offline/Online**: Test offline changes sync when reconnected

## After (Adapter<G>)

```typescript
class MyNetworkAdapter extends Adapter<PeerId> {
  protected generate(peerId: PeerId): BaseChannel {
    return {
      kind: "network",
      adapterId: this.adapterId,
      send: async (msg) => {
        /* send logic */
      },
      start: (receive) => {
        /* store receive fn */
      },
      stop: () => {
        /* cleanup */
      },
    };
  }

  init({ addChannel, removeChannel }) {
    // Store callbacks for lazy channel creation
  }

  deinit() {
    // Cleanup all resources
  }

  start() {
    // Start listening/connecting
  }
}
```

## Key Differences

1. **No Events**: Replace `peerAvailable()`, `peerDisconnected()`, `messageReceived()` with channel receive functions
2. **Channel-Based**: Each connection is a channel with send/receive
3. **Lazy Creation**: Create channels when needed via `addChannel(context)`
4. **Unified Pattern**: Same pattern as storage adapters

## Benefits

- Consistent architecture across all adapter types
- Better type safety with context parameter
- Simpler mental model (channels vs events)
- Easier testing and debugging

````

## Success Criteria

1. ✅ SSE client extends `Adapter<void>` and creates single channel
2. ✅ SSE server extends `Adapter<PeerId>` and creates channels lazily
3. ✅ All messages flow through channels (no events)
4. ✅ `publishDocId` is NOT used as `peerId`
5. ✅ `getExpressRouter()` preserved for easy setup
6. ✅ NetworkAdapter marked as deprecated
7. ✅ All tests pass (unit, integration, E2E)
8. ✅ Documentation updated

## Implementation Checklist

### Phase 1: Deprecate NetworkAdapter
- [ ] Add deprecation notice to NetworkAdapter class
- [ ] Update documentation to not recommend NetworkAdapter
- [ ] Plan removal timeline

### Phase 2: SSE Client Refactor
- [ ] Change from `extends NetworkAdapter` to `extends Adapter<void>`
- [ ] Add `peerId` generation in constructor
- [ ] Implement `generate()` method
- [ ] Implement `init()` method (create single channel)
- [ ] Implement `deinit()` method
- [ ] Implement `start()` method (connect EventSource)
- [ ] Update message sending to use channel
- [ ] Update message receiving to use receive function
- [ ] Remove all event-based code
- [ ] Add `X-Peer-Id` header to HTTP requests

### Phase 3: SSE Server Refactor
- [ ] Change from `extends NetworkAdapter` to `extends Adapter<PeerId>`
- [ ] Add channel tracking maps
- [ ] Implement `generate(peerId)` method
- [ ] Implement `init()` method (store callbacks)
- [ ] Implement `deinit()` method (cleanup all)
- [ ] Implement `start()` method (no-op)
- [ ] Update `getExpressRouter()` to use channels
- [ ] Update `/sync` endpoint to route via receive functions
- [ ] Update `/events` endpoint to create channels lazily
- [ ] Add `X-Peer-Id` header handling
- [ ] Update connection cleanup to remove channels
- [ ] Remove all event-based code

### Phase 4: Integration Updates
- [ ] Update Repo to not use NetworkAdapter events
- [ ] Update AdapterManager if needed
- [ ] Remove NetworkSubsystem if it's just a wrapper
- [ ] Update all documentation

### Phase 5: Testing
- [ ] Write unit tests for SSE client
- [ ] Write unit tests for SSE server
- [ ] Write integration tests for client-server communication
- [ ] Update E2E tests in todo-app
- [ ] Verify all existing tests still pass

### Phase 6: Documentation
- [ ] Update packages/repo/README.md
- [ ] Update packages/adapters/README.md
- [ ] Update inline code comments
- [ ] Review and merge

## Additional Considerations

### Peer Identity vs Channel Identity

**Critical Distinction**:
- **`peerId`**: Identifies the peer (client/server) across reconnections
- **`publishDocId`**: Channel-level identifier for future features (sidechannel)
- **`channelId`**: Local identifier for this specific channel instance

**Usage**:
```typescript
// Client generates peerId once
constructor(serverUrl: string) {
  this.peerId = uuid() // Stable across reconnections
}

// Channel gets its own publishDocId
const channel = addChannel() // channel.publishDocId is unique per channel

// Use peerId for routing, not publishDocId
const url = `${this.serverUrl}/events?peerId=${this.peerId}`
````

### Error Handling

**Connection Failures**:

- Client: ReconnectingEventSource handles reconnection automatically
- Server: Heartbeat detects stale connections and cleans up

**Message Send Failures**:

- Throw errors from `channel.send()` to allow retry logic
- Log warnings for disconnected peers

**Serialization Errors**:

- Catch and log serialization errors
- Don't crash the adapter

### Performance Considerations

**Memory Management**:

- Clean up receive functions when channels stop
- Clear all maps in deinit()
- Cancel heartbeat timers

**Connection Pooling**:

- Server maintains one channel per peer
- Reuse connections when possible
- Clean up on disconnect

**Message Batching**:

- Consider batching messages in future optimization
- Current implementation sends immediately

### Security Considerations

**Peer Validation**:

- Validate peerId format
- Prevent peerId spoofing
- Consider authentication in future

**Message Validation**:

- Validate message structure
- Sanitize inputs
- Rate limiting (future)

### Future Enhancements

**Potential Improvements**:

1. **WebSocket Support**: Add WebSocket adapter using same pattern
2. **Message Compression**: Compress large messages
3. **Connection Pooling**: Reuse HTTP connections
4. **Metrics**: Add connection/message metrics
5. **Authentication**: Add auth to establishment protocol
