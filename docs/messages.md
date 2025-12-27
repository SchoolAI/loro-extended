# Message Flow in Loro-Extended

This document describes the complete message flow when two peers connect and synchronize documents in the loro-extended system.

## Architecture Overview

The system uses a **channel-based architecture** where each connection (network or storage) is represented as a [`Channel`](../packages/repo/src/channel.ts). Each channel is bidirectional--it has a `send()` method and a `receive()` callback--but `send` can only be initiated by the owning repo. This means that, in order to send to another repo, each repo must set up a channel to each other repo.

The [`Synchronizer`](../packages/repo/src/synchronizer.ts) orchestrates all message passing through a functional state machine pattern (TEA/Elm architecture) implemented in [`synchronizer-program.ts`](../packages/repo/src/synchronizer-program.ts).

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

- Server creates `SseServerNetworkAdapter`
- Adapter starts listening for incoming connections
- Waits for clients to connect

#### 2. Client Initialization

- React app creates `RepoProvider` with configuration
- [`Repo`](../packages/repo/src/repo.ts) is instantiated, creating a [`Synchronizer`](../packages/repo/src/synchronizer.ts)
- Synchronizer calls `adapter._prepare()` then `adapter.onStart()`

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

1. [`ChannelDirectory.create()`](../packages/repo/src/channel-directory.ts) generates a [`Channel`](../packages/repo/src/channel.ts) with unique `channelId`
2. Calls `channelAdded()` hook → [`Synchronizer.channelAdded()`](../packages/repo/src/synchronizer.ts)
3. Dispatches `synchronizer/channel-added` message to synchronizer program
4. Program adds channel to model via [`handleChannelAdded`](../packages/repo/src/synchronizer/connection/handle-channel-added.ts)

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

Program handles `synchronizer/establish-channel` via [`handleEstablishChannel`](../packages/repo/src/synchronizer/connection/handle-establish-channel.ts):

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

1. Client's synchronizer → [`AdapterManager.send()`](../packages/repo/src/synchronizer.ts)
2. → `SseClientNetworkAdapter._send()`
3. → Client channel's `send()` → HTTP POST to `/sync` endpoint
4. Server receives POST at `/sync`, routes to stored `receive` function
5. → Dispatches [`msg/channel-receive-message`](../packages/repo/src/synchronizer-program.ts)

#### 6. Establish Response (Server → Client)

Server program handles `channel/establish-request` via [`handleEstablishRequest`](../packages/repo/src/synchronizer/connection/handle-establish-request.ts):

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

// 3. Send sync request for all server documents (batched)
{
  type: "channel/batch",
  messages: [
    { type: "channel/sync-request", docId: "doc1", requesterDocVersion: VersionVector, bidirectional: true },
    { type: "channel/sync-request", docId: "doc2", requesterDocVersion: VersionVector, bidirectional: true }
  ]
}
```

Response flows through server's channel:

1. Server's synchronizer → Server channel's `send()`
2. → SSE stream write to response
3. → Client's EventSource receives event
4. → Client channel's `receive()` callback
5. → Dispatches [`msg/channel-receive-message`](../packages/repo/src/synchronizer-program.ts)

#### 7. Establish Acknowledgment (Client processes response)

Client program handles `channel/establish-response` via [`handleEstablishResponse`](../packages/repo/src/synchronizer/connection/handle-establish-response.ts):

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

// 3. Send sync request for all client documents (batched)
{
  type: "channel/batch",
  messages: [
    { type: "channel/sync-request", docId: "doc1", ... },
    { type: "channel/sync-request", docId: "doc2", ... }
  ]
}
```

### Phase 3: Document Synchronization

#### 8. Sync Requests (Both Directions)

Both peers send `channel/sync-request` messages (defined in [`channel.ts`](../packages/repo/src/channel.ts)) through their respective channels. Each sync-request is for a **single document**:

```typescript
{
  type: "channel/sync-request",
  docId: "doc-uuid",
  requesterDocVersion: VersionVector, // Current version at requester
  ephemeral?: EphemeralStoreData[],   // Requester's ephemeral data for this doc
  bidirectional: true // true for initiating request, false for reciprocal
}

// EphemeralStoreData structure:
type EphemeralStoreData = {
  peerId: PeerID
  data: Uint8Array
  namespace: string  // e.g., 'presence', 'cursors', 'mouse'
}
```

When multiple documents need to be synced, they are wrapped in a `channel/batch` message for transport efficiency:

```typescript
{
  type: "channel/batch",
  messages: [
    { type: "channel/sync-request", docId: "doc-1", ... },
    { type: "channel/sync-request", docId: "doc-2", ... },
  ]
}
```

The `requesterDocVersion` tells the responder what version the requester already has, enabling efficient delta updates.

The optional `ephemeral` field contains the requester's ephemeral data for this document (organized by namespace). When present, the responder will:
1. Apply the ephemeral data locally (associated with the provided `peerId` and `namespace`)
2. Relay it to other connected peers (hub-and-spoke pattern)

#### 9. Sync Responses (Both Directions)

When receiving `channel/sync-request` via [`handleSyncRequest`](../packages/repo/src/synchronizer/sync/handle-sync-request.ts):

```typescript
// Each sync-request is for a single document
const { docId, requesterDocVersion, ephemeral } = message
const docState = model.documents.get(docId)

if (docState) {
  // 1. Set awareness that this channel has the doc
  setAwarenessState(docState, fromChannelId, "has-doc")

  // 2. Apply incoming ephemeral data if present
  if (ephemeral) {
    applyEphemeral(docId, ephemeral)
    // Relay to other peers
    relayEphemeralToOtherPeers(docId, ephemeral)
  }

  // 3. Export document data as update from requester's version
  const data = docState.doc.export({
    mode: "update",
    from: requesterDocVersion
  })

  // 4. Send sync response through our channel (with all known ephemeral)
  {
    type: "channel/sync-response",
    docId,
    transmission: {
      type: "update",
      data: Uint8Array,
      version: VersionVector
    },
    ephemeral?: EphemeralStoreData[] // All known ephemeral data for this doc
  }
}
```

The `ephemeral` field in the sync-response contains all known ephemeral data for the document (organized by namespace), allowing the requester to immediately see all connected peers' presence without waiting for separate ephemeral messages.

#### 10. Applying Sync Responses

When receiving `channel/sync-response` via [`handleSyncResponse`](../packages/repo/src/synchronizer/sync/handle-sync-response.ts):

```typescript
// 1. Check permissions
const context = getRuleContext({ channel, docState })
if (!permissions.canUpdate(context)) {
  // Reject update
  return
}

// 2. Import document data
{
  type: "cmd/import-doc-data",
  docId: message.docId,
  data: message.transmission.data
}

// 3. Subscribe to document changes (if first sync)
{
  type: "cmd/subscribe-doc",
  docId: message.docId
}

// 4. Apply ephemeral data if present
if (message.ephemeral) {
  {
    type: "cmd/apply-ephemeral",
    docId: message.docId,
    stores: message.ephemeral
  }
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

All messages are defined in [`channel.ts`](../packages/repo/src/channel.ts) (see `ChannelMsg` type):

**Establishment Messages** (before peer is established):
- **`channel/establish-request`**: Initial handshake from connecting peer
- **`channel/establish-response`**: Handshake acknowledgment

**Established Messages** (after peer is established):
- **`channel/sync-request`**: Request document synchronization (single document)
- **`channel/sync-response`**: Provide document data or updates
- **`channel/update`**: Push document updates (unsolicited)
- **`channel/directory-request`**: Request list of available documents (for glob-based discovery)
- **`channel/directory-response`**: Response to directory-request with matching documents
- **`channel/new-doc`**: Announce new documents to peers (unsolicited announcement)
- **`channel/delete-request`**: Request document deletion
- **`channel/delete-response`**: Confirm document deletion
- **`channel/ephemeral`**: Broadcast ephemeral/presence data with hop count for relay
- **`channel/batch`**: Wrapper for multiple messages (transport optimization)

### Synchronizer Messages

Internal messages defined in [`synchronizer-program.ts`](../packages/repo/src/synchronizer-program.ts) (see `SynchronizerMessage` type):

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

Commands are side effects returned by the update function (see `Command` type in [`synchronizer-program.ts`](../packages/repo/src/synchronizer-program.ts)):

**Channel Operations:**
- **`cmd/stop-channel`**: Deinitialize a channel
- **`cmd/send-establishment-message`**: Send establishment phase message
- **`cmd/send-message`**: Send a message through an established channel
- **`cmd/send-sync-response`**: Send document data to a peer
- **`cmd/send-sync-request`**: Send sync request to a peer

**Document Operations:**
- **`cmd/subscribe-doc`**: Subscribe to document changes
- **`cmd/import-doc-data`**: Import document data from a peer

**Ephemeral Operations:**
- **`cmd/apply-ephemeral`**: Apply ephemeral/presence data
- **`cmd/broadcast-ephemeral`**: Broadcast ephemeral data to peers (single doc)
- **`cmd/broadcast-ephemeral-batch`**: Broadcast ephemeral data for multiple docs to a single peer (batched)
- **`cmd/remove-ephemeral-peer`**: Remove a peer's ephemeral data
- **`cmd/emit-ephemeral-change`**: Emit ephemeral change event

**Utilities:**
- **`cmd/dispatch`**: Dispatch another message (utility)
- **`cmd/batch`**: Execute multiple commands (utility)

### Sync Transmission Types

The `transmission` field in sync-response and update messages can be one of:

```typescript
type SyncTransmission =
  | { type: "up-to-date", version: VersionVector }  // No new data to send
  | { type: "snapshot", data: Uint8Array, version: VersionVector }  // Full snapshot
  | { type: "update", data: Uint8Array, version: VersionVector }    // Delta update
  | { type: "unavailable" }  // Document not available (e.g., rules rejected)
```

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

## Rules

The system uses [`Rules`](../packages/repo/src/rules.ts) to control access:

- **`canBeginSync(context)`**: Should we start syncing with this peer?
- **`canReveal(context)`**: Can this peer know about this document?
- **`canUpdate(context)`**: Can this peer send updates for this document?
- **`canDelete(context)`**: Can this peer delete this document?
- **`canCreate(context)`**: Can this peer create a new document?

Rules are checked at key points:

- `canBeginSync`: When a channel is established
- `canReveal`: When setting awareness after establishment, when announcing new docs
- `canUpdate`: When accepting sync responses
- `canDelete`: When processing delete requests
- `canCreate`: When a peer requests a document that doesn't exist locally

See [Rules Documentation](./rules.md) for detailed information on all five rules.

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
const handle = repo.get("my-doc-id", DocSchema);
// Document is immediately available
// Sync requests automatically sent to all established channels
```

### Waiting for Sync

```typescript
await handle.waitUntilReady((readyStates) => {
  // Wait until at least one storage channel has loaded
  return readyStates.some(
    (rs) => rs.channelMeta.kind === "storage" && rs.loading.state === "found"
  );
});
```

### Custom Rules

```typescript
const repo = new Repo({
  adapters: [networkAdapter, storageAdapter],
  rules: {
    canReveal: (context) => {
      // Only reveal documents to storage or specific peers
      return (
        context.channelKind === "storage" ||
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

- [Repo Architecture](./repo-architecture.md)
- [Rules System](./rules.md)
- [Synchronizer Design](../packages/repo/src/synchronizer.md)
- [Handle Design](../packages/repo/src/doc-handle.md)
- [Creating Adapters](./creating-adapters.md)
