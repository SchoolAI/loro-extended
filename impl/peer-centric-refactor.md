# Peer-Centric State Model Refactor

## Problem Statement

The current `SynchronizerModel` has redundant state tracking between `DocState.channelState` and `PeerState.documentAwareness`. This redundancy creates:

1. **Duplicate version tracking**: `LoadingState.found` with version duplicates `PeerDocumentAwareness.lastKnownVersion`
2. **Duplicate awareness tracking**: `LoadingState` states map to `PeerDocumentAwareness.awareness` values
3. **Misplaced subscription tracking**: `DocChannelState.peerWantsUpdates` is about peer behavior, not channel state
4. **Conceptual confusion**: Unclear whether state represents channel capabilities, peer knowledge, or UI feedback

### Current State Structure

```typescript
// In DocState - channel-centric
DocState.channelState: Map<ChannelId, DocChannelState>
  - peerWantsUpdates: boolean
  - loading: LoadingState  // "initial" | "requesting" | "found" | "not-found" | "error"

// In PeerState - peer-centric  
PeerState.documentAwareness: Map<DocId, PeerDocumentAwareness>
  - awareness: "unknown" | "has-doc" | "no-doc"
  - lastKnownVersion?: VersionVector
  - lastUpdated: Date
```

**The redundancy:** `loading` state and `documentAwareness` track the same information from different perspectives.

## Key Observations

### 1. Channels Are Ephemeral, Peers Are Persistent

The synchronization protocol is **peer-to-peer**, not channel-to-channel:
- Channels are transport mechanisms (WebSocket, SSE, storage)
- Peers are identity (stable across reconnections)
- Sync state (versions, awareness) belongs with peers
- UI feedback (loading spinners) belongs with channels

### 2. Storage Adapters Are Synthetic Peers

Storage adapters:
- Generate a synthetic `peerId` on initialization
- Behave like peers (send/receive protocol messages)
- Have different behavior (eager sync) but same protocol
- Don't need special handling - they just request all announced documents

### 3. Subscription Is Peer Behavior

`peerWantsUpdates` tracks whether a peer has requested a document:
- Set when peer sends `sync-request`
- Used to determine whether to send future updates
- This is about the **peer's subscription**, not the channel's state
- Should live in `PeerState`, not `DocState.channelState`

### 4. UI Needs Channel-Granular Feedback

The `ReadyState` API exposes per-channel loading states:
- `DocHandle.waitForStorage()` - wait for storage channel
- `DocHandle.waitForNetwork()` - wait for network channel
- Applications filter by `channelMeta.kind`

This is legitimate - UI wants to show "Loading from storage..." vs "Syncing with peer..."

### 5. The Protocol Already Handles Everything

The pull-based protocol naturally handles all subscription patterns:
- Storage: requests all announced docs → subscribes to all
- Network peer: requests selected docs → selective subscription
- No special flags or policies needed

## Facts

1. **45+ usages** of `channelState` in the codebase
2. **No external dependencies** - this is a monorepo with no published packages yet
3. **Storage adapters work via protocol** - they send `sync-request` for announced docs
4. **UI API is channel-centric** - `ReadyState[]` filtered by channel kind
5. **Sync logic is peer-centric** - reconnection optimization uses `PeerState.documentAwareness`

## High-Level Implementation Plan

**Note:** Since this is a monorepo with no external dependencies, we can make all changes in one go. We'll rely on TypeScript compilation errors and test failures to guide us through the migration. No gradual migration or backward compatibility needed.

### Step 1: Update Type Definitions

**File:** `packages/repo/src/types.ts`

#### 1.1 Add `subscriptions` to PeerState

```typescript
export type PeerState = {
  identity: PeerIdentityDetails
  documentAwareness: Map<DocId, PeerDocumentAwareness>
  subscriptions: Set<DocId>  // NEW: Documents peer has requested
  lastSeen: Date
  channels: Set<ChannelId>
}
```

#### 1.2 Remove DocChannelState

Delete:
- `DocChannelState` type
- `createDocChannelState()` function

Keep `LoadingState` for now (used in `ReadyState` API).

#### 1.3 Update DocState

```typescript
export type DocState = {
  doc: LoroDoc
  docId: DocId
  // channelState removed entirely
}

export function createDocState({ docId }: { docId: DocId }): DocState {
  return {
    doc: new LoroDoc(),
    docId,
  }
}
```

### Step 2: Update Helper Functions

**File:** `packages/repo/src/synchronizer/peer-state-helpers.ts`

#### 2.1 Add Subscription Helpers

```typescript
export function addPeerSubscription(
  peerState: PeerState,
  docId: DocId,
): void {
  peerState.subscriptions.add(docId)
}

export function removePeerSubscription(
  peerState: PeerState,
  docId: DocId,
): void {
  peerState.subscriptions.delete(docId)
}

export function hasPeerSubscription(
  peerState: PeerState,
  docId: DocId,
): boolean {
  return peerState.subscriptions.has(docId)
}
```

#### 2.2 Update ensurePeerState

```typescript
export function ensurePeerState(
  model: SynchronizerModel,
  identity: PeerIdentityDetails,
  channelId: ChannelId,
): PeerState {
  const peerId = identity.peerId
  let peerState = model.peers.get(peerId)

  if (!peerState) {
    peerState = {
      identity,
      documentAwareness: new Map(),
      subscriptions: new Set(),  // NEW
      lastSeen: new Date(),
      channels: new Set(),
    }
    model.peers.set(peerId, peerState)
  } else {
    peerState.lastSeen = new Date()
  }

  peerState.channels.add(channelId)
  return peerState
}
```

**File:** `packages/repo/src/synchronizer/state-helpers.ts`

#### 2.3 Remove Old Helpers

Delete:
- `setPeerWantsUpdates()`
- `setLoadingStateWithCommand()`

#### 2.4 Rewrite getReadyStates

```typescript
export function getReadyStates(
  channels: Map<ChannelId, Channel>,
  peers: Map<PeerID, PeerState>,
  docId: DocId,
): ReadyState[] {
  const readyStates: ReadyState[] = []
  
  for (const [channelId, channel] of channels.entries()) {
    if (!isEstablished(channel)) continue
    
    const peer = peers.get(channel.peerId)
    const awareness = peer?.documentAwareness.get(docId)
    
    // Convert peer awareness to loading state for UI
    const loading: LoadingState = awareness
      ? awareness.awareness === "has-doc"
        ? { state: "found", version: awareness.version! }
        : awareness.awareness === "no-doc"
        ? { state: "not-found" }
        : { state: "initial" }
      : { state: "initial" }
    
    readyStates.push({
      channelMeta: { kind: channel.kind, adapterId: channel.adapterId },
      loading,
    })
  }
  
  return readyStates
}
```

### Step 3: Update All Handlers

Update each handler to use peer subscriptions instead of channel state.

#### 3.1 handle-sync-request.ts

Replace `setPeerWantsUpdates()` with `addPeerSubscription()`:

```typescript
// OLD:
setPeerWantsUpdates(docState, fromChannelId, true)

// NEW:
addPeerSubscription(peerState, docId)
```

#### 3.2 handle-sync-response.ts

Remove all `setLoadingStateWithCommand()` calls. Update peer awareness directly.

Remove the `channelState` existence check (lines 108-112).

#### 3.3 handle-local-doc-change.ts

Replace subscription check:

```typescript
// OLD:
const state = docState.channelState.get(channel.channelId)
if (state?.peerWantsUpdates) {
  // Send update
}

// NEW:
const peerState = model.peers.get(channel.peerId)
if (peerState && hasPeerSubscription(peerState, docId)) {
  // Send update
}
```

#### 3.4 handle-channel-removed.ts

Remove the loop that deletes `channelState` (lines 86-88).

The peer's channel set is already being cleaned up.

#### 3.5 Other Handlers

- `handle-directory-response.ts` - Already uses peer awareness correctly
- `handle-establish-response.ts` - Already uses peer awareness correctly
- `handle-establish-request.ts` - No changes needed
- `handle-directory-request.ts` - No changes needed
- `handle-local-doc-ensure.ts` - No changes needed
- `handle-local-doc-delete.ts` - No changes needed

### Step 4: Update Synchronizer Class

**File:** `packages/repo/src/synchronizer.ts`

#### 4.1 Remove getChannelsForDoc

This method is unused. Delete it entirely.

#### 4.2 Update getChannelDocIds

```typescript
public getChannelDocIds(channelId: ChannelId): DocId[] {
  const channel = this.model.channels.get(channelId)
  if (!channel || !isEstablished(channel)) {
    return []
  }
  
  const peerState = this.model.peers.get(channel.peerId)
  if (!peerState) {
    return []
  }
  
  return Array.from(peerState.subscriptions)
}
```

#### 4.3 Update waitUntilReady

Change `getReadyStates()` call to pass `peers`:

```typescript
const readyStates = getReadyStates(
  this.model.channels,
  this.model.peers,  // NEW
  docId,
)
```

#### 4.4 Update removeDocument

Remove the `channelIds` extraction from `channelState`:

```typescript
// OLD:
const channelIds = Array.from(docState.channelState.keys())

// NEW:
// Get all channels that have subscribed to this document
const channelIds: ChannelId[] = []
for (const [peerId, peerState] of this.model.peers.entries()) {
  if (hasPeerSubscription(peerState, docId)) {
    channelIds.push(...peerState.channels)
  }
}
```

#### 4.5 Update #executeSendSyncResponse

Remove the `toChannel` check (lines 417-423). We don't need to verify channel state anymore.

### Step 5: Update synchronizer-program.ts

Update the `getReadyStates` export and any internal calls to pass the `peers` map.

### Step 6: Update All Tests

Run tests and fix compilation errors. For each test file:

#### 6.1 Replace channelState Setup

```typescript
// OLD:
docState.channelState.set(channelId, {
  peerWantsUpdates: true,
  loading: { state: "found", version }
})

// NEW:
const peerState = model.peers.get(channel.peerId)!
addPeerSubscription(peerState, docId)
setPeerDocumentAwareness(peerState, docId, "has-doc", version)
```

#### 6.2 Replace channelState Assertions

```typescript
// OLD:
expect(docState.channelState.get(channelId)?.peerWantsUpdates).toBe(true)

// NEW:
const peerState = model.peers.get(channel.peerId)!
expect(hasPeerSubscription(peerState, docId)).toBe(true)
```

#### 6.3 Test Files to Update

- `synchronizer-program.test.ts`
- `synchronizer.test.ts`
- `state-helpers.test.ts`
- All `handle-*.test.ts` files

## Benefits

### 1. Eliminates Redundancy
- Single source of truth for peer knowledge (`PeerState.documentAwareness`)
- Single source of truth for subscriptions (`PeerState.subscriptions`)
- No duplicate version tracking

### 2. Clearer Semantics
- Peer state = persistent knowledge (survives reconnection)
- Channel UI state = transient feedback (per-session)
- Clear separation of concerns

### 3. Better Architecture
- Sync logic is peer-centric (matches protocol)
- UI logic is channel-centric (matches user needs)
- Bridge function converts between them

### 4. Simpler Code
- Fewer maps to maintain
- Fewer state transitions to track
- More intuitive mental model

### 5. Easier Debugging
- Less state to inspect
- Clearer ownership of data
- Better alignment with protocol semantics

## Migration Strategy

1. **Phase 1-2**: Additive changes only (no breaking changes)
2. **Phase 3**: Bridge function allows gradual migration
3. **Phase 4**: Update handlers one at a time
4. **Phase 5**: Remove old code after all handlers migrated
5. **Phase 6**: Update tests to match new model

Each phase can be committed independently, allowing for incremental progress and easier code review.

## Success Criteria

- [ ] All 45+ usages of `channelState` removed or replaced
- [ ] All tests passing with new model
- [ ] `DocChannelState` type deleted
- [ ] `ReadyState` API still works for UI
- [ ] Storage adapters work without special handling
- [ ] Reconnection optimization still uses peer awareness
- [ ] No performance regression

## Notes

- This refactor does NOT change the protocol - only internal state management
- Storage adapters continue to work via the pull-based protocol
- UI can still get per-channel feedback via the bridge function
- The peer-centric model better reflects the protocol's semantics