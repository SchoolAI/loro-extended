# Message Flow in Loro-Extended

This document describes the complete message flow when two peers connect and synchronize documents in the loro-extended system.

## Architecture Overview

The system uses a **channel-based architecture** where each connection (network or storage) is represented as a [`Channel`](src/channel.ts). Each channel is bidirectional, but owned by its repo - it has a `send()` method and a `receive()` callback, but for two repos to communicate, they each need a channel connected to the other.

The [`Synchronizer`](src/synchronizer.ts) orchestrates all message passing through a functional state machine pattern (TEA/Elm architecture) implemented in [`synchronizer-program.ts`](src/synchronizer-program.ts).

### Key Components

- **Channel**: Represents a repo-owned, bidirectional connection to a peer or storage system
- **Synchronizer**: Orchestrates message passing and state management
- **Adapter**: Implements transport-specific logic (SSE, WebSocket, storage, etc.)
- **SynchronizerModel**: Immutable state containing documents, channels, and peer information

### Channel Directionality

Each peer creates its own channel to communicate with the other peer. For example, in an SSE connection:

**Client's Channel (to server):**

- `send()`: HTTP POST to `/sync` endpoint
- `receive()`: EventSource listening to `/events` endpoint

**Server's Channel (to client):**

- `send()`: SSE stream write to response
- `receive()`: HTTP POST handler on `/sync` endpoint

This creates **two unidirectional channels** that together enable bidirectional communication between peers.

## Message Flow: Peer Connection

### Phase 1: Initial Connection Setup

#### 1. Server Initialization

- Server creates [`SseServerNetworkAdapter`](../adapters/src/network/sse/server.ts:13)
- Adapter starts listening for incoming connections
- Waits for clients to connect

#### 2. Client Initialization

- React app creates [`RepoProvider`](../react/src/repo-context.tsx:12) with configuration
- [`Repo`](src/repo.ts:27) is instantiated, creating a [`Synchronizer`](src/synchronizer.ts:50)
- Synchronizer calls [`adapter._prepare()`](src/adapter/adapter.ts:48) then [`adapter.onStart()`](src/adapter/adapter.ts:44)

#### 3. Channel Creation

**Client Side:**

```typescript
// SseClientNetworkAdapter.onBeforeStart() creates a single channel
this.serverChannel = addChannel(undefined);
```

**Server Side:**

```typescript
// When client connects to /events endpoint, server lazily creates channel
const channel = this.addChannel!(peerId);
```

Both sides follow the same flow:

1. [`ChannelDirectory.create()`](src/channel-directory.ts) generates a [`Channel`](src/channel.ts) with unique `channelId`
2. Calls `channelAdded()` hook → [`Synchronizer.channelAdded()`](src/synchronizer.ts)
3. Dispatches `synchronizer/channel-added` message to synchronizer program
4. Program adds channel to model via [`handleChannelAdded`](src/synchronizer/connection/handle-channel-added.ts)

#### 4. Channel Start

The synchronizer executes the channel start command:

**Client:**

- Creates `ReconnectingEventSource` for SSE connection to `/events`
- Sets up message handlers for incoming events (receive direction)
- The `send()` method uses HTTP POST to `/sync` (send direction)

**Server:**

- Stores the `receive` function for routing incoming POST messages to `/sync` (receive direction)
- The `send()` method writes to SSE response stream (send direction)

When connection opens, the adapter dispatches `synchronizer/establish-channel` message.

### Phase 2: Peer Establishment

#### 5. Establish Request (Client → Server)

Program handles `synchronizer/establish-channel` via [`handleEstablishChannel`](src/synchronizer/connection/handle-establish-channel.ts):

```typescript
{
  type: "cmd/send-message",
  envelope: {
    toChannelIds: [channelId],
    message: {
      type: "channel/establish-request",
      identity: { name: "client-uuid" }
    }
  }
}
```

Message flows through client's channel:

1. Client's synchronizer → [`AdapterManager.send()`](src/synchronizer.ts:263)
2. → [`SseClientNetworkAdapter._send()`](src/adapter/adapter.ts:80)
3. → Client channel's `send()` → HTTP POST to `/sync` endpoint
4. Server receives POST at `/sync`, routes to stored `receive` function
5. → Dispatches [`msg/channel-receive-message`](src/synchronizer-program.ts:56)

#### 6. Establish Response (Server → Client)

Server program handles `channel/establish-request` via [`handleEstablishRequest`](src/synchronizer/connection/handle-establish-request.ts):

```typescript
// 1. Establish peer connection
channel.peer = {
  state: "established",
  identity: channelMessage.identity
}

// 2. Send establish response
{
  type: "channel/establish-response",
  identity: { name: "server-uuid" }
}

// 3. Send sync request for all server documents
{
  type: "channel/sync-request",
  docs: [
    { docId: "doc1", requesterDocVersion: VersionVector },
    { docId: "doc2", requesterDocVersion: VersionVector }
  ]
}
```

Response flows through server's channel:

1. Server's synchronizer → Server channel's `send()`
2. → SSE stream write to response
3. → Client's EventSource receives event
4. → Client channel's `receive()` callback
5. → Dispatches [`msg/channel-receive-message`](src/synchronizer-program.ts:56)

#### 7. Establish Acknowledgment (Client processes response)

Client program handles `channel/establish-response` via [`handleEstablishResponse`](src/synchronizer/connection/handle-establish-response.ts):

```typescript
// 1. Establish peer connection
channel.peer = {
  state: "established",
  identity: channelMessage.identity
}

// 2. Set awareness state for existing documents
for (const docState of model.documents.values()) {
  setAwarenessState(docState, channel.channelId, "unknown")

  const context = getRuleContext({ channel, docState })
  if (permissions.canReveal(context)) {
    setAwarenessState(docState, channel.channelId, "has-doc")
  }
}

// 3. Send sync request for all client documents
{
  type: "channel/sync-request",
  docs: [...]
}
```

### Phase 3: Document Synchronization

#### 8. Sync Requests (Both Directions)

Both peers send `channel/sync-request` messages (defined in [`channel.ts`](src/channel.ts)) through their respective channels:

```typescript
{
  type: "channel/sync-request",
  docs: [
    {
      docId: "doc-uuid",
      requesterDocVersion: VersionVector // Current version at requester
    }
  ],
  bidirectional: true // Optional, defaults to true
}
```

The `requesterDocVersion` tells the responder what version the requester already has, enabling efficient delta updates.

#### 9. Sync Responses (Both Directions)

When receiving `channel/sync-request` via [`handleSyncRequest`](src/synchronizer/sync/handle-sync-request.ts):

```typescript
for (const { docId, requesterDocVersion } of docs) {
  const docState = model.documents.get(docId)

  if (docState) {
    // 1. Set awareness that this channel has the doc
    setAwarenessState(docState, fromChannelId, "has-doc")

    // 2. Export document data as update from requester's version
    const data = docState.doc.export({
      mode: "update",
      from: requesterDocVersion
    })

    // 3. Send sync response through our channel
    {
      type: "channel/sync-response",
      docId,
      hopCount: 0,
      transmission: {
        type: "update",
        data: Uint8Array
      }
    }
  }
}
```

#### 10. Applying Sync Responses

When receiving `channel/sync-response` via [`handleSyncResponse`](src/synchronizer/sync/handle-sync-response.ts):

```typescript
// 1. Check permissions
const context = getRuleContext({ channel, docState })
if (!permissions.canUpdate(context)) {
  // Reject update
  return
}

// 2. Apply update to local document
docState.doc.import(channelMessage.transmission.data)

// 3. Update awareness and loading state
setAwarenessState(docState, fromChannelId, "has-doc")
setLoadingState(docState, fromChannelId, {
  state: "found",
  version: docState.doc.version()
})

// 4. Emit ready-state-changed event
{
  type: "cmd/emit-ready-state-changed",
  docId,
  readyStates: [...]
}
```

### Phase 4: Ongoing Synchronization

#### 11. Local Changes

When a document is modified locally:

```typescript
// 1. DocHandle change triggers subscription callback
docState.doc.subscribe(() => {
  // 2. Dispatch local-doc-change message
  {
    type: "msg/local-doc-change",
    docId
  }
})

// 3. Program sends sync-response through each channel with awareness === "has-doc"
for (const [channelId, state] of docState.channelState.entries()) {
  if (state.awareness === "has-doc") {
    {
      type: "channel/sync-response",
      docId,
      hopCount: 0,
      transmission: {
        type: "update",
        data
      }
    }
  }
}
```

## Message Types

### Channel Messages

All messages are defined in [`channel.ts`](src/channel.ts) (see `ChannelMsg` type):

- **`channel/establish-request`**: Initial handshake from connecting peer
- **`channel/establish-response`**: Handshake acknowledgment
- **`channel/sync-request`**: Request document synchronization
- **`channel/sync-response`**: Provide document data or updates
- **`channel/directory-request`**: Request list of available documents (for future glob-based discovery)
- **`channel/directory-response`**: Response to directory-request with matching documents
- **`channel/new-doc`**: Announce new documents to peers (unsolicited announcement)
- **`channel/delete-request`**: Request document deletion
- **`channel/delete-response`**: Confirm document deletion

### Synchronizer Messages

Internal messages defined in [`synchronizer-program.ts`](src/synchronizer-program.ts) (see `SynchronizerMessage` type):

- **`synchronizer/channel-added`**: A new channel was created
- **`synchronizer/channel-removed`**: A channel was removed
- **`synchronizer/establish-channel`**: Request to establish a channel with a peer
- **`synchronizer/doc-ensure`**: Ensure document exists locally
- **`synchronizer/local-doc-change`**: Local document was modified
- **`synchronizer/doc-imported`**: Document data was imported from a peer
- **`synchronizer/doc-delete`**: Request to delete a document
- **`synchronizer/channel-receive-message`**: Channel received a message
- **`synchronizer/heartbeat`**: Periodic heartbeat for ephemeral data
- **`synchronizer/ephemeral-local-change`**: Local ephemeral/presence data changed

### Commands

Commands are side effects returned by the update function (see `Command` type in [`synchronizer-program.ts`](src/synchronizer-program.ts)):

- **`cmd/stop-channel`**: Deinitialize a channel
- **`cmd/send-establishment-message`**: Send establishment phase message
- **`cmd/send-message`**: Send a message through an established channel
- **`cmd/send-sync-response`**: Send document data to a peer
- **`cmd/subscribe-doc`**: Subscribe to document changes
- **`cmd/import-doc-data`**: Import document data from a peer
- **`cmd/apply-ephemeral`**: Apply ephemeral/presence data
- **`cmd/broadcast-ephemeral`**: Broadcast ephemeral data to peers
- **`cmd/remove-ephemeral-peer`**: Remove a peer's ephemeral data
- **`cmd/emit-ephemeral-change`**: Emit ephemeral change event
- **`cmd/dispatch`**: Dispatch another message (utility)
- **`cmd/batch`**: Execute multiple commands (utility)

## State Management

### Awareness State

Tracks whether a channel knows about a document:

- **`"unknown"`**: Initial state, not yet determined
- **`"has-doc"`**: Channel has confirmed it has the document
- **`"no-doc"`**: Channel has confirmed it doesn't have the document

### Loading State

Tracks synchronization status per channel:

- **`{ state: "loading" }`**: Waiting for response
- **`{ state: "found", version: VersionVector }`**: Document found and synced
- **`{ state: "not-found" }`**: Document not available on this channel

### Connection State

Tracks channel connection status:

- **`"connecting"`**: Initial state, establishing connection
- **`"connected"`**: Connection established and ready
- **`"disconnected"`**: Connection lost
- **`"error"`**: Connection encountered an error

## Permissions

The system uses [`Rules`](src/rules.ts) to control access:

- **`canReveal(context)`**: Can this peer know about this document?
- **`canUpdate(context)`**: Can this peer send updates for this document?

Permissions are checked at key points:

- When setting awareness after establishment
- When accepting sync responses
- When responding to directory requests

## Key Design Principles

1. **Unidirectional Channels**: Each channel has one send mechanism and one receive mechanism
2. **Peer Symmetry**: Both peers create their own channels, enabling bidirectional communication
3. **Immutable State**: All state updates use immutable patterns via `mutative`
4. **Functional Core**: Update logic is pure functions that return new state + commands
5. **Effect Isolation**: Side effects (network, storage) only happen in command execution
6. **Permission-Based**: All operations respect permission rules
7. **Lazy Channel Creation**: Channels created on-demand when needed
8. **Hop Count Prevention**: Prevents infinite forwarding cascades with hop count tracking

## Debugging Tips

### Enable Logging

```typescript
import { configure } from "@logtape/logtape";

await configure({
  sinks: { console: getConsoleSink() },
  loggers: [
    { category: ["@loro-extended"], level: "debug", sinks: ["console"] },
  ],
});
```

### Inspect Model State

```typescript
const snapshot = repo.synchronizer.getModelSnapshot();
console.log(snapshot.channels);
console.log(snapshot.documents);
```

### Track Message Flow

The synchronizer logs all messages with trace level:

- `msg/channel-ready` → Channel connected
- `channel/establish-request` → Peer handshake initiated
- `channel/sync-request` → Document sync requested
- `channel/sync-response` → Document data received

## Common Patterns

### Creating a New Document

```typescript
const handle = repo.get<MyDocType>("my-doc-id");
// Document is immediately available
// Sync requests automatically sent to all established channels
```

### Waiting for Sync

```typescript
await repo.synchronizer.waitUntilReady("my-doc-id", (readyStates) => {
  // Wait until at least one storage channel has loaded
  return readyStates.some(
    (rs) => rs.channelMeta.kind === "storage" && rs.loading.state === "found"
  );
});
```

### Custom Permissions

```typescript
const repo = new Repo({
  adapters: [networkAdapter, storageAdapter],
  permissions: {
    canReveal: (context) => {
      // Only reveal documents to storage or specific peers
      return (
        context.channelMeta.kind === "storage" ||
        context.peerName === "trusted-peer"
      );
    },
    canUpdate: (context) => {
      // Accept updates from anyone
      return true;
    },
  },
});
```

## Related Documentation

- [Repo Architecture](./src/repo.md)
- [Synchronizer Design](./src/synchronizer.md)
- [DocHandle Usage](./src/doc-handle.md)
- [Adapter Implementation](./src/adapter/adapter.md)
