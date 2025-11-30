# Discovery and Sync Architecture

## Overview

This document describes the architectural design for document discovery and synchronization in loro-extended. The system uses a clean separation between **discovery** (what documents exist) and **sync** (transferring document data), with privacy controls enforced through the Rules system.

## Core Principles

1. **Separation of Concerns**

   - `establish-request/response` = Connection setup only
   - `directory-request/response` = Discovery mechanism
   - `sync-request/response` = Data transfer mechanism

2. **Privacy by Design**

   - `canReveal` controls what documents are discoverable
   - `canUpdate` controls what data can be transferred
   - Rules are checked at every decision point

3. **Symmetric Protocol**
   - Both peers use the same discovery pattern
   - No special client/server roles in the protocol
   - Each side explicitly requests what it needs

## Message Flow Patterns

### Pattern 1: Client Refresh (Client has no documents)

```
Client                                    Server
  |                                         |
  |------ establish-request --------------->|
  |                                         | (establish channel)
  |<----- establish-response ---------------|
  |                                         |
  |------ directory-request --------------->|
  |                                         | (filter by canReveal)
  |<----- directory-response [docIds] ------|
  |                                         |
  |------ sync-request (empty versions) --->|
  |                                         | (check canUpdate)
  |<----- sync-response (snapshots) --------|
  |                                         |
  ✓ Client now has its documents
```

**Key Points:**

- Client discovers documents via directory-request
- Server filters response using `canReveal` rule
- Client requests discovered documents with empty versions
- Server sends full snapshots (detected by empty version check)

### Pattern 2: Local Document Changes

When a document is modified locally, the system uses a **pull-based discovery model** where peers explicitly request documents they're interested in.

#### 2a. New Document Created Locally

```
Peer A                                    Peer B (or Storage)
  |                                         |
  | (user creates new document)             |
  | (local-doc-change triggered)            |
  |                                         |
  |------ directory-response [docId] ------>|
  |                                         | (peer learns doc exists)
  |                                         | (peer decides if interested)
  |<----- sync-request (if interested) -----|
  |                                         |
  |------ sync-response (snapshot) -------->|
  |                                         | (peer receives/stores data)
  ✓ Peer has document (if they requested it)
```

**Key Points:**

- New documents trigger directory-response as an **announcement**
- Announcement sent to all channels where `canReveal=true` and peer awareness is "unknown"
- Peer decides whether to request the document
- Storage adapters typically request all announced documents immediately
- Network peers may ignore announcements for documents they don't care about

#### 2b. Existing Document Modified Locally

```
Peer A                                    Peer B
  |                                         |
  | (user modifies existing document)       |
  | (local-doc-change triggered)            |
  | (peer has previously requested doc)     |
  |                                         |
  |------ sync-response (update) ---------->|
  |                                         | (apply update)
  ✓ Peer receives real-time update
```

**Key Points:**

- If peer has explicitly requested the document (via sync-request), send updates directly
- Tracked via `PeerDocumentAwareness` state (awareness = "has-doc")
- Enables real-time collaboration after initial sync
- No announcement needed - peer already knows about the document

### Pattern 3: True Peer-to-Peer (Both have documents)

```
Peer A                                    Peer B
  |                                         |
  |------ establish-request --------------->|
  |                                         | (establish channel)
  |<----- establish-response ---------------|
  |                                         |
  |------ directory-request --------------->|
  |------ sync-request (A's docs) --------->|
  |                                         | (filter by canReveal)
  |<----- directory-response (B's docs) ----|
  |<----- sync-response (A's docs) ---------|
  |                                         |
  |------ sync-request (B's docs) --------->|
  |<----- sync-response (B's docs) ---------|
  |                                         |
  ✓ Both peers have each other's documents
```

**Key Points:**

- Both sides send directory-request after establishment
- Both sides sync their own documents immediately
- Discovery and sync happen in parallel
- Each peer only sees documents allowed by `canReveal`

## Symmetric Sync and Bidirectional Requests

To ensure both peers are fully synchronized, the system uses a **symmetric sync** model. When a peer requests a document, the receiver not only sends the document data but also checks if it needs to request updates from the sender.

### The `bidirectional` Flag

The `sync-request` message includes an optional `bidirectional` flag:

```typescript
type ChannelMsgSyncRequest = {
  type: "channel/sync-request";
  docs: { docId: DocId; requesterDocVersion: VersionVector }[];
  bidirectional?: boolean; // Default: true
};
```

### Protocol Flow

1. **Initial Request**: Peer A sends `sync-request` with `bidirectional: true` (default).
2. **Response**: Peer B receives the request and:
   - Sends `sync-response` with document data (snapshot or update).
   - Checks if it also needs to sync with Peer A (e.g., to get newer updates).
   - If yes, sends a **reciprocal** `sync-request` back to Peer A.
3. **Loop Prevention**: The reciprocal request has `bidirectional: false` to prevent an infinite loop of requests.

```
Peer A                                    Peer B
  |                                         |
  |-- sync-request (bidirectional: true) -->|
  |                                         |
  |<-- sync-response (data) ----------------|
  |                                         |
  |<-- sync-request (bidirectional: false)--| (Reciprocal)
  |                                         |
  |-- sync-response (data) ---------------->|
  |                                         |
```

This ensures that:

- Subscriptions are established in both directions.
- Both peers have the latest version of the document.
- No infinite loops occur.

## Peer Awareness and Request Tracking

The system tracks what each peer knows about documents using `PeerDocumentAwareness`:

```typescript
type PeerDocumentAwareness = {
  awareness: "unknown" | "has-doc" | "no-doc";
  lastKnownVersion?: VersionVector;
  lastUpdated: Date;
};
```

### Awareness States

- **`"unknown"`**: We don't know if the peer has this document
  - Initial state for all documents
  - Triggers directory-response announcement on local changes
- **`"has-doc"`**: Peer has explicitly requested this document
  - Set when peer sends sync-request
  - Triggers sync-response on local changes (real-time updates)
- **`"no-doc"`**: Peer explicitly doesn't have this document
  - Set when peer responds with "unavailable"
  - No messages sent for this document

### The Pull-Based Model

The architecture is fundamentally **pull-based**:

1. **Discovery**: Peers announce documents via directory-response
2. **Request**: Interested peers send sync-request
3. **Transfer**: Data flows via sync-response
4. **Updates**: Future changes sent to peers who requested

This model:

- Respects peer autonomy (peers choose what to sync)
- Saves bandwidth (no unsolicited data)
- Works uniformly for all channel types
- Enables privacy controls via `canReveal`

### Storage Adapters as Eager Peers

Storage adapters are simply peers that:

- Request all documents they're announced (via directory-response)
- Immediately send sync-request for new documents
- Save all sync-response data they receive

The synchronizer doesn't treat storage specially - storage adapters implement "eager" behavior in their own message handlers.

## The Rules System

### canReveal(context): boolean

Controls **discovery** - whether a peer should know a document exists.

**Use Cases:**

- Storage adapters: Always return `true` (storage sees everything)
- Network peers: Check document ownership/permissions
- Multi-tenant: Filter by user/tenant ID

**Example:**

```typescript
canReveal: (context) => {
  // Storage always sees everything
  if (context.channelKind === "storage") return true;

  // Network peers only see their own documents
  const userId = extractUserIdFromPeer(context.peerName);
  return context.docId.startsWith(`user-${userId}-`);
};
```

### canUpdate(context): boolean

Controls **data transfer** - whether to accept sync data from a peer.

**Use Cases:**

- Read-only peers: Return `false` for certain documents
- Write permissions: Check user roles
- Validation: Verify document state before accepting

**Example:**

```typescript
canUpdate: (context) => {
  // Storage always accepts updates
  if (context.channelKind === "storage") return true;

  // Check write permissions
  return hasWritePermission(context.peerName, context.docId);
};
```

## Implementation Details

### Establishment Handshake

**Server Side (`establish-request` handler):**

```typescript
case "channel/establish-request": {
  // 1. Establish the channel
  const peerId = channelMessage.identity.peerId
  Object.assign(channel, {
    type: "established" as const,
    peerId,
    sendEstablished: (msg: EstablishedMsg) => channel.send(msg),
  })

  // 2. Create/update peer state
  ensurePeerState(model, channelMessage.identity, channel.channelId)

  // 3. Send establish-response ONLY (no sync-request)
  return {
    type: "cmd/send-establishment-message",
    envelope: {
      toChannelIds: [fromChannelId],
      message: {
        type: "channel/establish-response",
        identity: current(model.identity),
      },
    },
  }
}
```

**Client Side (`establish-response` handler):**

```typescript
case "channel/establish-response": {
  // 1. Establish the channel
  const peerId = channelMessage.identity.peerId
  Object.assign(channel, { type: "established" as const, peerId, ... })

  // 2. Set wantsUpdates for existing documents (based on canReveal)
  for (const docState of model.documents.values()) {
    const context = getRuleContext({ channel, docState, model })
    if (!(context instanceof Error) && permissions.canReveal(context)) {
      setWantsUpdates(docState, channel.channelId, true)
    }
  }

  // 3. Request directory to discover peer's documents
  const commands: Command[] = [{
    type: "cmd/send-message",
    envelope: {
      toChannelIds: [channel.channelId],
      message: { type: "channel/directory-request" },
    },
  }]

  // 4. Sync our own documents (if any)
  if (model.documents.size > 0) {
    const docs = Array.from(model.documents.values()).map(({ doc, docId }) => ({
      docId,
      requesterDocVersion: doc.version(),
    }))

    commands.push({
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [channel.channelId],
        message: { type: "channel/sync-request", docs },
      },
    })
  }

  return batchAsNeeded(...commands)
}
```

### Directory Discovery

**Request Handler (`directory-request`):**

```typescript
case "channel/directory-request": {
  // Filter documents based on canReveal
  const allowedDocIds = Array.from(model.documents.keys()).filter(docId => {
    const context = getRuleContext({
      channel,
      docState: model.documents.get(docId),
      model,
    })

    return !(context instanceof Error) && permissions.canReveal(context)
  })

  return {
    type: "cmd/send-message",
    envelope: {
      toChannelIds: [fromChannelId],
      message: {
        type: "channel/directory-response",
        docIds: allowedDocIds,
      },
    },
  }
}
```

**Response Handler (`directory-response`):**

```typescript
case "channel/directory-response": {
  const docsToSync: ChannelMsgSyncRequest["docs"] = []

  for (const docId of channelMessage.docIds) {
    // Create document state if it doesn't exist
    let docState = model.documents.get(docId)
    if (!docState) {
      docState = createDocState({ docId })
      model.documents.set(docId, docState)
    }

    // Mark that we want updates for this document
    setWantsUpdates(docState, fromChannelId, true)

    // Request the document data with empty version (for snapshot)
    docsToSync.push({
      docId,
      requesterDocVersion: docState.doc.version(), // Empty for new docs
    })
  }

  // Send sync-request to load the actual document data
  if (docsToSync.length > 0) {
    return {
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [fromChannelId],
        message: { type: "channel/sync-request", docs: docsToSync },
      },
    }
  }
}
```

### Sync Data Transfer

**Request Handler (`sync-request`):**

```typescript
case "channel/sync-request": {
  const commands: Command[] = []

  for (const { docId, requesterDocVersion } of channelMessage.docs) {
    const docState = model.documents.get(docId)

    if (docState) {
      // Send sync-response with appropriate data
      commands.push({
        type: "cmd/send-sync-response",
        toChannelId: fromChannelId,
        docId,
        requesterDocVersion, // Used to determine snapshot vs update
      })

      // Peer is requesting this doc, so they want updates
      setWantsUpdates(docState, fromChannelId, true)
    }
  }

  return batchAsNeeded(...commands)
}
```

**Response Handler (`sync-response`):**

```typescript
case "channel/sync-response": {
  const docState = model.documents.get(channelMessage.docId)

  switch (channelMessage.transmission.type) {
    case "snapshot":
    case "update": {
      // Check canUpdate permission
      const context = getRuleContext({ channel, docState, model })
      if (!(context instanceof Error) && permissions.canUpdate(context)) {
        // Apply the update
        docState.doc.import(channelMessage.transmission.data)
      }
      break
    }

    case "up-to-date": {
      // Document is already up to date
      break
    }

    case "unavailable": {
      // Peer doesn't have the document
      break
    }
  }
}
```

## Version Vector Semantics

The `requesterDocVersion` in sync-request has specific semantics:

- **Empty version** (`new LoroDoc().version()`): "I have nothing, send me everything"
  - Server responds with `type: "snapshot"` (full document)
- **Non-empty version**: "I have this version, send me updates"
  - Server responds with `type: "update"` (delta from that version)
  - Or `type: "up-to-date"` if no changes
- **Version comparison**: Uses Loro's version vector comparison
  - `compare() === 0`: Versions are equal (up-to-date)
  - `compare() === 1`: Our version is ahead (send update)
  - `compare() === -1`: Their version is ahead (shouldn't happen)
  - `compare() === undefined`: Versions are concurrent (send full update)

## Common Scenarios

### Scenario: Multi-Tenant Server

**Setup:**

```typescript
const permissions = {
  canReveal: (context) => {
    // Storage sees everything for persistence
    if (context.channelKind === "storage") return true;

    // Network peers only see their tenant's documents
    const tenantId = extractTenantId(context.peerName);
    return context.docId.startsWith(`tenant-${tenantId}-`);
  },

  canUpdate: (context) => {
    // Storage accepts all updates
    if (context.channelKind === "storage") return true;

    // Network peers can only update their tenant's documents
    const tenantId = extractTenantId(context.peerName);
    return context.docId.startsWith(`tenant-${tenantId}-`);
  },
};
```

**Flow:**

1. Tenant A creates document `tenant-A-doc1`
2. System sends directory-response to all channels where `canReveal=true`
   - Storage receives announcement (canReveal=true for storage)
   - Tenant A's network peer receives announcement (canReveal=true for their docs)
   - Tenant B's network peer does NOT receive announcement (canReveal=false)
3. Storage immediately sends sync-request (eager behavior)
4. Tenant A's peer may send sync-request (if interested)
5. Both receive sync-response with document data

**Result:**

- Complete tenant isolation at the protocol level
- Storage persists all documents
- Each tenant only discovers and syncs their own documents

### Scenario: Read-Only Replicas

**Setup:**

```typescript
const permissions = {
  canReveal: (context) => {
    // All peers can discover all documents
    return true;
  },

  canUpdate: (context) => {
    // Only storage accepts updates (read-only replicas)
    return context.channelKind === "storage";
  },
};
```

**Flow:**

1. Primary creates/modifies document
2. System sends directory-response to all channels (canReveal=true for all)
3. Storage sends sync-request → receives sync-response → persists
4. Read-only replica sends sync-request → receives sync-response → displays
5. If replica tries to send updates, they're rejected by `canUpdate`

**Result:**

- Replicas can discover and read all documents
- Replicas cannot write back to the system
- Only storage adapter accepts updates
- Useful for monitoring, analytics, or read-only views

### Scenario: Selective Sync (Mobile Client)

**Setup:**

```typescript
const permissions = {
  canReveal: (context) => {
    // Server reveals all documents to all clients
    return true;
  },

  canUpdate: (context) => {
    // All peers can update
    return true;
  },
};

// Client-side: Only request documents user is viewing
class SelectiveSyncClient {
  handleDirectoryResponse(docIds: string[]) {
    // Don't automatically request all documents
    // Only request when user navigates to a document
    this.availableDocIds = docIds;
  }

  onUserNavigate(docId: string) {
    // User opened a document - now request it
    this.sendSyncRequest([docId]);
  }
}
```

**Result:**

- Server announces all documents
- Client learns what's available but doesn't request everything
- Client only syncs documents user actually views
- Saves bandwidth and storage on mobile devices

## Design Rationale

### Why Pull-Based Discovery?

The system uses **directory-response as announcement** + **sync-request as subscription** rather than automatically pushing updates. This design:

1. **Respects Peer Autonomy**

   - Peers decide what documents they care about
   - No forced synchronization of unwanted data
   - Enables selective sync strategies

2. **Saves Bandwidth**

   - Announcements are tiny (just docId)
   - Full data only transferred when requested
   - Particularly important for mobile/constrained devices

3. **Maintains Privacy**

   - `canReveal` controls who learns about documents
   - Peers can't access data without explicit request
   - Clear separation between discovery and access

4. **Enables Flexible Behaviors**
   - Storage: Eager (request everything)
   - Collaboration: Active (request working documents)
   - Mobile: Selective (request on-demand)
   - Analytics: Passive (request for analysis)

### The Role of `wantsUpdates`

The `wantsUpdates` flag is **misnamed** - it doesn't mean "peer wants updates", it means:

> "We are willing to send updates to this channel based on our `canReveal` rules"

The actual peer interest is tracked via `PeerDocumentAwareness`:

- `awareness === "has-doc"` → Peer has requested, send updates
- `awareness === "unknown"` → Peer hasn't requested, send announcement
- `awareness === "no-doc"` → Peer doesn't have it, send nothing

Future refactoring should rename `wantsUpdates` to `canRevealToChannel` or `shouldAnnounce` for clarity.

## Troubleshooting

### Problem: Dual Sync-Response Messages

**Symptom:** Receiving two sync-response messages during establishment

**Cause:** Server sending sync-request during `establish-request` handler

**Solution:** Remove sync-request from establishment handshake (see `synchronizer/connection/handle-establish-request.ts`)

### Problem: Documents Not Syncing

**Symptom:** Client doesn't receive documents after refresh

**Checklist:**

1. Is `canReveal` returning true for the document?
2. Is the directory-request being sent?
3. Is the directory-response including the document?
4. Is the sync-request being sent with empty version?
5. Is `canUpdate` returning true?

### Problem: Privacy Leaks

**Symptom:** Peers seeing documents they shouldn't

**Checklist:**

1. Is `canReveal` properly filtering in directory-request handler?
2. Is `canUpdate` properly filtering in sync-response handler?
3. Are document IDs properly namespaced?
4. Is peer identity correctly extracted?

## Future Considerations

### Optimization: Batch Discovery

For peers with many documents, consider batching directory responses:

```typescript
// Instead of sending all docIds at once
docIds: [...] // Could be thousands

// Send in batches with pagination
docIds: [...], // First 100
hasMore: true,
cursor: "next-page-token"
```

### Optimization: Incremental Sync

For large documents, consider chunked transfer:

```typescript
transmission: {
  type: "snapshot-chunk",
  data: Uint8Array,
  chunkIndex: 0,
  totalChunks: 10
}
```

### Enhancement: Subscription Model

For real-time updates, consider explicit subscriptions:

```typescript
// Client subscribes to specific documents
{ type: "channel/subscribe", docIds: [...] }

// Server sends updates only for subscribed documents
{ type: "channel/update", docId, data }
```

## References

- [synchronizer-program.ts](../packages/repo/src/synchronizer-program.ts) - Main state machine and message/command types
- [synchronizer/](../packages/repo/src/synchronizer/) - Handler implementations organized by concern:
  - `connection/` - Channel establishment handlers
  - `discovery/` - Directory request/response handlers
  - `sync/` - Document sync handlers
  - `ephemeral/` - Presence/ephemeral data handlers
- [rules.ts](../packages/repo/src/rules.ts) - Rules interface
- [channel.ts](../packages/repo/src/channel.ts) - Channel message types
- [MESSAGES.md](../packages/repo/MESSAGES.md) - Message protocol documentation
