# Peer-State Architecture Refactoring

## Status: Updated for Channel Clarity Refactoring

This plan has been updated to reflect the changes made in commit `9d95c2f` (Channel Clarity Refactoring), which introduced:
- Progressive type refinement: `GeneratedChannel` → `ConnectedChannel` → `Channel`
- Removal of `connectionState` field (channel existence implies connection)
- Removal of `peer` object (replaced with `peerId` reference)
- Addition of `peers: Map<PeerId, PeerIdentityDetails>` to `SynchronizerModel`
- Type guard `isEstablished()` to check if channel has `peerId`

## Problem Statement

The current synchronizer architecture tracks document awareness and synchronization state at the **channel level** (ephemeral connections) rather than the **peer level** (persistent repository identities). This creates a critical flaw: when a channel disconnects and reconnects, all knowledge about what the peer knows is lost, even if the reconnection happens milliseconds later.

### Current Issues

1. **Knowledge Loss on Reconnection**: `DocState.channelState` ties awareness to channels. Channel lifecycle events cause loss of peer knowledge.

2. **Temporary PeerId Generation**: Current implementation generates temporary peerIds (`peer-${Date.now()}-${Math.random()}`) on each establish handshake, preventing reconnection detection.

3. **Conflated Concerns**: `DocChannelState` mixes persistent awareness (does peer have doc?) with transient loading state (request status).

4. **Multi-Channel Limitation**: Cannot properly handle multiple simultaneous channels to the same peer (e.g., WebSocket + WebRTC fallback).

## Requirements

### R1: Stable Peer Identity

- Each peer must have a globally unique, stable identifier (`peerId`)
- Identity must persist across channel reconnections
- **UPDATED**: `PeerIdentityDetails` must include a stable `peerId` field (not just `name`)
- Support for future cryptographic identity (public keys)

### R2: Persistent Peer Knowledge

- Track which documents each peer has/doesn't have
- Preserve this knowledge across channel lifecycle events
- Store last known version vectors for each peer-document pair
- Track when peer knowledge was last updated

### R3: Separation of Concerns

- **Peer State** (persistent): Identity, document awareness, reputation
- **Channel State** (ephemeral): Connection status, active requests
- **Document State** (persistent): The CRDT data itself

### R4: Reconnection Resilience

- When a channel reconnects to a known peer:
  - Restore existing peer knowledge
  - Only sync documents that changed since last connection
  - Don't re-request documents we know they don't have
- When a new peer connects:
  - Initialize fresh peer state
  - Perform full discovery and sync

### R5: Multi-Channel Support

- Support multiple simultaneous channels to the same peer
- Aggregate knowledge from all channels to a peer
- Handle channel-specific request tracking independently

### R6: Backward Compatibility

- Existing tests should continue to pass with minimal changes
- Public API (`Repo`, `DocHandle`) should remain unchanged
- There is no need for migration for existing deployments--there are no existing deployments

## High-Level Implementation Plan

### Phase 1: Type System Foundation

**Status**: ✅ **PARTIALLY COMPLETE** (from channel-clarity refactoring)

**Already Done** (commit `9d95c2f`):
- ✅ `Channel` type now includes `peerId: PeerId`
- ✅ `SynchronizerModel` includes `peers: Map<PeerId, PeerIdentityDetails>`
- ✅ Type guard `isEstablished(channel)` checks for `peerId` presence
- ✅ Progressive channel types: `GeneratedChannel` → `ConnectedChannel` → `Channel`

**Files to modify:**

- `packages/repo/src/types.ts`
- `packages/repo/src/channel.ts`

**Remaining Changes:**

1. **Update `PeerIdentityDetails` to include stable `peerId`**

```typescript
export type PeerIdentityDetails = {
  peerId: PeerId; // NEW: Globally unique, stable (not generated per-connection)
  name: string; // Existing: Human-readable, not unique
  // publicKey?: Uint8Array   // Future: For crypto
};
```

**Key Change**: The `peerId` should be part of the identity itself, not generated during establish. This allows reconnection detection.

2. **Create peer-level state**

```typescript
export type PeerState = {
  identity: PeerIdentityDetails;
  documentAwareness: Map<DocId, PeerDocumentAwareness>;
  lastSeen: Date;
  channels: Set<ChannelId>; // NEW: Track all channels to this peer
  // Future: reputation, trust metrics, etc.
};

export type PeerDocumentAwareness = {
  awareness: "has-doc" | "no-doc" | "unknown";
  lastKnownVersion?: VersionVector;
  lastUpdated: Date;
};
```

3. **Simplify DocState - remove channelState**

```typescript
export type DocState = {
  doc: LoroDoc;
  docId: DocId;
  // REMOVED: channelState: Map<ChannelId, DocChannelState>
  activeRequests: Map<ChannelId, LoadingState>; // Transient request tracking only
};
```

**Note**: The channel types are already correct from the channel-clarity refactoring. We just need to update how `peerId` is obtained (from identity, not generated).

### Phase 2: Synchronizer Program Logic

**Status**: 🔄 **NEEDS MAJOR UPDATES**

**Files to modify:**

- `packages/repo/src/synchronizer-program.ts`

**Current State** (from commit `9d95c2f`):
- ✅ `init()` already includes `peers: new Map()`
- ✅ `synchronizer/channel-added` sends establish-request
- ⚠️ `synchronizer/channel-removed` removes channel but doesn't update peer state
- ⚠️ Establish handlers generate temporary peerIds instead of using identity.peerId

**Changes:**

1. **Update establish message handlers to use stable peerId**

**Current Problem** (lines 360-363, 400-403):
```typescript
// WRONG: Generates temporary peerId on each connection
const peerId: PeerId = `peer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
Object.assign(channel, { peerId })
model.peers.set(peerId, channelMessage.identity)
```

**Should Be**:
```typescript
// Extract stable peerId from identity
const peerId = channelMessage.identity.peerId
Object.assign(channel, { peerId })

// Get or create peer state
let peerState = model.peers.get(peerId)
if (!peerState) {
  peerState = {
    identity: channelMessage.identity,
    documentAwareness: new Map(),
    lastSeen: new Date(),
    channels: new Set(),
  }
  model.peers.set(peerId, peerState)
} else {
  // Reconnection - update lastSeen
  peerState.lastSeen = new Date()
}

// Track this channel for the peer
peerState.channels.add(channel.channelId)
```

2. **Update `synchronizer/channel-removed` handler**

**Current** (lines 146-168):
```typescript
case "synchronizer/channel-removed": {
  const channel = model.channels.get(msg.channel.channelId)
  // ... stops channel and removes from model.channels
  // ... removes from docState.channelState
}
```

**Should Add**:
```typescript
case "synchronizer/channel-removed": {
  const channel = model.channels.get(msg.channel.channelId)
  
  // Update peer state if channel was established
  if (channel && isEstablishedFn(channel)) {
    const peerState = model.peers.get(channel.peerId)
    if (peerState) {
      peerState.channels.delete(channel.channelId)
      peerState.lastSeen = new Date()
      // Keep peer state even if no channels remain (for reconnection)
    }
  }
  
  // ... existing channel cleanup
}
```

3. **Implement reconnection detection in establish handlers**

This is where the critical distinction between **new peer** vs. **reconnection** happens.

**`channel/establish-request`** (lines 359-397):

Current implementation always treats as new peer. Should:
- Extract `peerId` from `channelMessage.identity.peerId`
- Check if `model.peers.has(peerId)` to detect reconnection
- Create or update `PeerState`
- Link channel to peer via `peerId`
- Send establish-response
- For **new peers**: Send sync-request for all documents
- For **reconnections**: Send optimized sync based on cached awareness

**`channel/establish-response` (THE KEY HANDLER)** (lines 399-479):

This handler must distinguish between new peer connection and reconnection:

```typescript
case "channel/establish-response": {
  const peerId = channelMessage.identity.peerId
  const existingPeer = model.peers.get(peerId)

  if (existingPeer) {
    // ============================================================
    // RECONNECTION PATH - Optimized discovery
    // ============================================================
    logger.debug("Reconnecting to known peer", { peerId })

    // 1. Link channel to existing peer
    channel.peerId = peerId
    existingPeer.lastSeen = new Date()

    // 2. Build optimized sync request based on cached knowledge
    const docsToSync: ChannelMsgSyncRequest["docs"] = []

    for (const [docId, docState] of model.documents.entries()) {
      const peerAwareness = existingPeer.documentAwareness.get(docId)

      if (!peerAwareness) {
        // New doc created since last connection - peer doesn't know about it
        docsToSync.push({
          docId,
          requesterDocVersion: docState.doc.version()
        })
      } else if (peerAwareness.awareness === "has-doc") {
        // Peer had this doc - check if our version is ahead
        const ourVersion = docState.doc.version()
        const theirLastKnownVersion = peerAwareness.lastKnownVersion

        if (!theirLastKnownVersion ||
            ourVersion.compare(theirLastKnownVersion) === "greater") {
          // We have changes they don't know about
          docsToSync.push({
            docId,
            requesterDocVersion: theirLastKnownVersion || new Map()
          })
        }
        // else: versions match, no need to sync
      }
      // Skip if peerAwareness.awareness === "no-doc" (they don't have it)
    }

    // 3. Send optimized sync (may be empty if nothing changed)
    // Note: We skip directory-request since we already know their docs
    if (docsToSync.length > 0) {
      return {
        type: "cmd/send-message",
        envelope: {
          toChannelIds: [channel.channelId],
          message: { type: "channel/sync-request", docs: docsToSync }
        }
      }
    }

  } else {
    // ============================================================
    // NEW PEER PATH - Full discovery
    // ============================================================
    logger.debug("Connecting to new peer", { peerId })

    // 1. Create new peer state
    const newPeer: PeerState = {
      identity: channelMessage.identity,
      documentAwareness: new Map(),
      lastSeen: new Date()
    }
    model.peers.set(peerId, newPeer)
    channel.peerId = peerId

    // 2. Full discovery: directory + sync for all our docs
    return batchAsNeeded(
      // Request their directory to discover all their docs
      {
        type: "cmd/send-message",
        envelope: {
          toChannelIds: [channel.channelId],
          message: { type: "channel/directory-request" }
        }
      },
      // Request sync for all our docs
      {
        type: "cmd/send-message",
        envelope: {
          toChannelIds: [channel.channelId],
          message: {
            type: "channel/sync-request",
            docs: Array.from(model.documents.values()).map(({ doc, docId }) => ({
              docId,
              requesterDocVersion: doc.version()
            }))
          }
        }
      }
    )
  }
}
```

**Implementation Notes:**
- The `peerId` comes from `channelMessage.identity.peerId` (not generated)
- Reconnection is detected by checking `model.peers.has(peerId)`
- Cached awareness in `peerState.documentAwareness` guides optimized sync
- Version vectors enable incremental sync on reconnection

**Key Differences: New Peer vs. Reconnection**

| Aspect                 | New Peer                | Known Peer (Reconnect)       |
| ---------------------- | ----------------------- | ---------------------------- |
| **Establish Protocol** | Required                | Required (always)            |
| **Peer State**         | Create fresh            | Restore existing             |
| **Directory Request**  | Yes (discover all docs) | No (use cached awareness)    |
| **Sync Request**       | All our docs            | Only changed/new docs        |
| **Awareness**          | Initialize as unknown   | Use cached values            |
| **Version Vectors**    | None available          | Compare with cached versions |
| **Bandwidth**          | Higher (full discovery) | Lower (targeted sync)        |

**Benefits of This Approach:**

1. **Bandwidth Optimization**: Don't re-sync unchanged documents on reconnect
2. **Latency Reduction**: Skip directory discovery when reconnecting
3. **Knowledge Preservation**: Leverage what we already know about the peer
4. **Security**: Still verify identity via establish protocol on every connection
5. **Correctness**: Graceful degradation if cached knowledge is stale

**Edge Cases Handled:**

- **Peer deleted a document while disconnected**: Our sync-request gets "unavailable" response, we update awareness to "no-doc"
- **Peer created new documents while disconnected**: They'll send us sync-responses for docs we didn't request, or we'll discover when they send their sync-requests
- **Cached version vector is wrong**: Loro's CRDT merge is idempotent - sending duplicate data is safe, just slightly more bandwidth

4. **Refactor sync message handlers to update peer awareness**

**`channel/sync-request`** (lines 481-507):

Current implementation updates `docState.channelState`. Should:
- Look up peer via `channel.peerId` (requires `isEstablished` check)
- Update `peerState.documentAwareness` for requested docs
- Track active request in `doc.activeRequests` with channelId lookup

**`channel/sync-response`** (lines 508-599):

Current implementation updates `docState.channelState`. Should:
- Look up peer via `channel.peerId`
- Update `peerState.documentAwareness` based on transmission type
- Update `peerState.documentAwareness[docId].lastKnownVersion` for snapshot/update
- Clear request from `doc.activeRequests` with channelId lookup

**`synchronizer/local-doc-change`** (lines 238-296):

Current implementation iterates `docState.channelState`. Should:
- Find all peers with awareness "has-doc" for this document
- Find all channels connected to those peers (via `peerState.channels`)
- Send sync-response to all relevant channels

5. **Update directory handlers to use peer awareness**

**`channel/directory-response`** (lines 651-667):

Current implementation updates `docState.channelState`. Should:
- Look up peer via `channel.peerId`
- Update `peerState.documentAwareness` for all revealed docIds
- Create documents if they don't exist locally
- Mark peer as having these documents

### Phase 3: Helper Functions

**New utility functions in `synchronizer-program.ts`:**

```typescript
// Get or create peer state (replaces temporary peerId generation)
function ensurePeerState(
  model: SynchronizerModel,
  identity: PeerIdentityDetails
): PeerState {
  const peerId = identity.peerId
  let peerState = model.peers.get(peerId)
  
  if (!peerState) {
    peerState = {
      identity,
      documentAwareness: new Map(),
      lastSeen: new Date(),
      channels: new Set(),
    }
    model.peers.set(peerId, peerState)
  } else {
    peerState.lastSeen = new Date()
  }
  
  return peerState
}

// Update peer's document awareness
function setPeerDocumentAwareness(
  peerState: PeerState,
  docId: DocId,
  awareness: AwarenessState,
  version?: VersionVector
): void {
  peerState.documentAwareness.set(docId, {
    awareness,
    lastKnownVersion: version,
    lastUpdated: new Date(),
  })
}

// Get all channels connected to a peer
function getChannelsForPeer(
  model: SynchronizerModel,
  peerId: PeerId
): ConnectedChannel[] {
  const peerState = model.peers.get(peerId)
  if (!peerState) return []
  
  return Array.from(peerState.channels)
    .map(channelId => model.channels.get(channelId))
    .filter((ch): ch is ConnectedChannel => ch !== undefined)
}

// Get all peers that have a document
function getPeersWithDocument(
  model: SynchronizerModel,
  docId: DocId
): PeerState[] {
  return Array.from(model.peers.values()).filter(peer => {
    const awareness = peer.documentAwareness.get(docId)
    return awareness?.awareness === "has-doc"
  })
}

// Check if we should sync with peer (based on version vectors)
function shouldSyncWithPeer(
  docState: DocState,
  peerAwareness: PeerDocumentAwareness | undefined
): boolean {
  if (!peerAwareness) return true // Unknown, should sync
  if (peerAwareness.awareness !== "has-doc") return false
  
  const ourVersion = docState.doc.version()
  const theirVersion = peerAwareness.lastKnownVersion
  
  if (!theirVersion) return true // They have it but we don't know version
  
  return ourVersion.compare(theirVersion) === "greater"
}
```

### Phase 4: Synchronizer Class Updates

**Status**: 🔄 **NEEDS UPDATES**

**Files to modify:**

- `packages/repo/src/synchronizer.ts`

**Changes:**

1. **Update public API methods**

```typescript
// MODIFY: Now queries peer state instead of channel state
public getChannelsForDoc(
  docId: DocId,
  predicate: (peerState: PeerState) => boolean
): ConnectedChannel[] {
  const peers = getPeersWithDocument(this.model, docId)
  return peers
    .filter(predicate)
    .flatMap(peer => getChannelsForPeer(this.model, peer.identity.peerId))
}

// NEW: Get peer state
public getPeerState(peerId: PeerId): PeerState | undefined {
  return this.model.peers.get(peerId)
}

// NEW: Get all peers
public getPeers(): PeerState[] {
  return Array.from(this.model.peers.values())
}

// MODIFY: Update to use peer state
public getChannelDocIds(channelId: ChannelId): DocId[] {
  const channel = this.model.channels.get(channelId)
  if (!channel || !isEstablished(channel)) return []
  
  const peerState = this.model.peers.get(channel.peerId)
  if (!peerState) return []
  
  return Array.from(peerState.documentAwareness.entries())
    .filter(([_, awareness]) => awareness.awareness === "has-doc")
    .map(([docId]) => docId)
}
```

2. **Update `waitUntilReady()`**

Current implementation uses `docState.channelState`. Should:
- Query peer awareness instead of channel state
- Emit events based on peer state changes, not channel state
- Consider all channels to a peer when determining ready state

3. **Update `getOrCreateDocumentState()`**

Current implementation initializes `channelState`. Should:
- Remove channel state initialization (no longer exists)
- Document state is now simpler (just doc + docId + activeRequests)

### Phase 5: Adapter Integration

**Status**: ⚠️ **NEEDS CONSIDERATION**

**Files to modify:**

- `packages/repo/src/adapter/adapter.ts`
- `packages/repo/src/adapter/adapter-manager.ts`
- Adapter implementations (storage, network)

**Changes:**

1. **Adapters must provide stable peerId in identity**

**Key Change**: Instead of generating `peerId` during establish, adapters must include it in `PeerIdentityDetails`.

**For Storage Adapters**:
```typescript
// Use stable storage identifier as peerId
const identity: PeerIdentityDetails = {
  peerId: `storage-${storageId}`, // Stable across connections
  name: "Local Storage"
}
```

**For Network Adapters**:
```typescript
// Extract peerId from peer's identity during establish
// The peer sends their identity.peerId in establish-request/response
```

2. **Update Repo initialization**

```typescript
// Repo must generate its own stable peerId
const identity: PeerIdentityDetails = {
  peerId: uuid(), // Or load from storage
  name: "My Repo"
}
```

**Note**: The channel types are already correct from channel-clarity refactoring. We just need to ensure `peerId` comes from identity, not generated during establish.

### Phase 6: Testing & Migration

**Status**: 📝 **TODO**

**Test updates:**

- `packages/repo/src/synchronizer.test.ts`
- `packages/repo/src/synchronizer-program.test.ts`
- `packages/repo/src/e2e.test.ts`

**Migration strategy:**

1. **Breaking change: peerId in identity**

   - `PeerIdentityDetails` now requires `peerId` field
   - Repo initialization must provide stable `peerId`
   - Adapters must include `peerId` in their identity

2. **Test coverage**
   - Add tests for reconnection scenarios (same peerId, different channelId)
   - Test multi-channel to same peer
   - Test peer knowledge persistence across channel lifecycle
   - Test version vector optimization on reconnection
   - Test that temporary peerId generation is removed

3. **Update test helpers**

```typescript
// Update createMockChannel to include peerId
function createMockChannel(overrides: Partial<ConnectedChannel> = {}): ConnectedChannel {
  return {
    channelId: 1,
    kind: "network",
    adapterId: "test-adapter",
    send: vi.fn(),
    stop: vi.fn(),
    onReceive: vi.fn(),
    ...overrides,
  }
}

// Add helper to create established channel
function createEstablishedChannel(peerId: PeerId, overrides = {}): Channel {
  return {
    ...createMockChannel(overrides),
    peerId,
  }
}

// Add helper to create peer identity
function createPeerIdentity(name: string): PeerIdentityDetails {
  return {
    peerId: `peer-${name}-${uuid()}`,
    name,
  }
}
```

## Implementation Order

**Updated based on channel-clarity completion:**

1. **Phase 1** (Types): ✅ Partially complete, needs `PeerIdentityDetails.peerId` and `PeerState`
2. **Phase 3** (Helpers): New utility functions for peer management
3. **Phase 2** (Program Logic): Update establish handlers and message processing
4. **Phase 4** (Synchronizer Class): Public API updates for peer queries
5. **Phase 5** (Adapters): Update to provide stable peerId in identity
6. **Phase 6** (Testing): Validation and migration

**Critical Path:**
1. Add `peerId` to `PeerIdentityDetails` type
2. Create `PeerState` type
3. Update establish handlers to use `identity.peerId` instead of generating
4. Implement reconnection detection logic
5. Migrate from `docState.channelState` to `peerState.documentAwareness`

## Success Criteria

- [ ] All existing tests pass
- [ ] New tests for reconnection scenarios pass
- [ ] Peer knowledge persists across channel reconnections (same peerId)
- [ ] Multiple channels to same peer work correctly
- [ ] Version vector optimization reduces unnecessary syncs on reconnection
- [ ] Temporary peerId generation removed (uses identity.peerId)
- [ ] `docState.channelState` removed (replaced with peer awareness)
- [ ] Public API updated to query peer state
- [ ] Documentation updated

## Key Differences from Original Plan

1. **Channel types already done**: The channel-clarity refactoring already implemented progressive types and `peerId` on `Channel`. We just need to change where `peerId` comes from.

2. **Peers map exists**: `SynchronizerModel.peers` already exists, but stores `PeerIdentityDetails` instead of `PeerState`. Need to upgrade to full `PeerState`.

3. **No connectionState**: Channel-clarity removed `connectionState` field. Channel existence in model implies connection.

4. **Type guard exists**: `isEstablished(channel)` already checks for `peerId` presence.

5. **Main work**: The core work is:
   - Add `peerId` to `PeerIdentityDetails` (breaking change)
   - Create `PeerState` type with document awareness
   - Update establish handlers to use `identity.peerId` instead of generating
   - Implement reconnection detection
   - Migrate from channel-based to peer-based awareness tracking

## Future Enhancements

Once peer-state is established, we can build:

1. **Peer Reputation System**: Track reliability, response times
2. **Selective Sync**: Choose which peers to sync with based on trust
3. **Conflict Resolution**: Use peer identity for deterministic conflict resolution
4. **Cryptographic Identity**: Sign messages with private keys
5. **Peer Discovery**: DHT-based peer discovery using stable IDs
6. **Bandwidth Optimization**: Prefer peers with better connections

## References

- Current implementation: `packages/repo/src/synchronizer-program.ts`
- Type definitions: `packages/repo/src/types.ts`
- Channel abstraction: `packages/repo/src/channel.ts`
