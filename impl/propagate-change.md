# Multi-Hop CRDT Propagation Implementation Plan

## Overview

Enable multi-hop CRDT propagation by switching from `subscribeLocalUpdates()` to `subscribe()`, using version vector tracking to prevent cycles. This allows information to flow through intermediate peers (peer-a → peer-b → peer-c) without requiring full mesh connectivity.

## Current State Analysis

### The Problem

Currently, document changes only propagate to directly connected peers:

```typescript
// In synchronizer.ts:514
docState.doc.subscribeLocalUpdates(data => {
  this.#dispatch({ type: "synchronizer/local-doc-change", docId, data })
})
```

**Issue:** `subscribeLocalUpdates()` only fires for LOCAL changes, not imported ones.

**Result:** In topology `peer-a ↔ peer-b ↔ peer-c`:
- peer-a makes change → peer-b receives it
- peer-b imports change → `subscribeLocalUpdates` does NOT fire
- peer-c never receives the update

### The Solution

Switch to `doc.subscribe()` which fires for ALL changes (local + imported), and use version vector comparison to prevent cycles.

## Key Infrastructure Already in Place

### 1. Version Tracking ✅
```typescript
// types.ts:36-40
export type PeerDocumentAwareness = {
  awareness: "unknown" | "has-doc" | "no-doc"
  lastKnownVersion?: VersionVector  // Already tracked!
  lastUpdated: Date
}
```

### 2. Cycle Prevention Helper ✅
```typescript
// peer-state-helpers.ts:165-179
export function shouldSyncWithPeer(
  docState: DocState,
  peerAwareness: PeerDocumentAwareness | undefined,
): boolean {
  const comparison = ourVersion.compare(theirVersion)
  return comparison === 1 // Only send if we're ahead
}
```

### 3. Centralized Subscription Point ✅
```typescript
// synchronizer.ts:507-517
#executeSubscribeLocalDoc(docId: DocId) {
  // Only ONE place where we subscribe - easy to change!
  docState.doc.subscribeLocalUpdates(data => {
    this.#dispatch({ type: "synchronizer/local-doc-change", docId, data })
  })
}
```

## Implementation Plan

### Phase 1: Remove `hopCount` Field

**Rationale:** Version vector comparison is sufficient for cycle prevention. The `hopCount` field adds complexity without benefit.

#### Files to Modify:

**1. `packages/repo/src/channel.ts`**
```typescript
// REMOVE hopCount field
export type ChannelMsgSyncResponse = {
  type: "channel/sync-response"
  docId: DocId
  transmission: SyncTransmission
  // REMOVED: hopCount: number
}
```

**2. `packages/repo/src/synchronizer.ts`**
```typescript
// Remove hopCount from message construction (line ~488)
const messageToSend = {
  toChannelIds: [toChannelId],
  message: {
    type: "channel/sync-response" as const,
    docId,
    // REMOVED: hopCount: 0,
    transmission,
  },
}
```

**3. `packages/repo/src/synchronizer/handle-local-doc-change.ts`**
```typescript
// Remove hopCount from message construction (line ~122)
message: {
  type: "channel/sync-response",
  docId,
  // REMOVED: hopCount: 0,
  transmission: { type: "update", data },
}
```

### Phase 2: Rename "local-doc" to "doc"

**Rationale:** Changes are no longer exclusively local - they include imported changes too.

#### Files to Rename:

1. `packages/repo/src/synchronizer/handle-local-doc-change.ts` → `handle-doc-change.ts`
2. `packages/repo/src/synchronizer/handle-local-doc-change.test.ts` → `handle-doc-change.test.ts`
3. `packages/repo/src/synchronizer/handle-local-doc-delete.ts` → `handle-doc-delete.ts`
4. `packages/repo/src/synchronizer/handle-local-doc-delete.test.ts` → `handle-doc-delete.test.ts`
5. `packages/repo/src/synchronizer/handle-local-doc-ensure.ts` → `handle-doc-ensure.ts`
6. `packages/repo/src/synchronizer/handle-local-doc-ensure.test.ts` → `handle-doc-ensure.test.ts`

#### Message Type Renames:

**In `packages/repo/src/synchronizer-program.ts`:**
```typescript
export type SynchronizerMessage =
  // ... other messages ...
  
  // Document lifecycle messages
  | { type: "synchronizer/doc-ensure"; docId: DocId }           // was: local-doc-ensure
  | { type: "synchronizer/doc-change"; docId: DocId; data: Uint8Array }  // was: local-doc-change
  | { type: "synchronizer/doc-delete"; docId: DocId }           // was: local-doc-delete
```

#### Function Renames:

**In `packages/repo/src/synchronizer-program.ts`:**
```typescript
// Import renames
import {
  handleDocChange,      // was: handleLocalDocChange
  handleDocDelete,      // was: handleLocalDocDelete
  handleDocEnsure,      // was: handleLocalDocEnsure
} from "./synchronizer/index.js"

// Handler dispatch renames
switch (msg.type) {
  case "synchronizer/doc-ensure":
    return handleDocEnsure(msg, model, permissions)
    
  case "synchronizer/doc-change":
    return handleDocChange(msg, model, permissions, logger)
    
  case "synchronizer/doc-delete":
    return handleDocDelete(msg, model)
}
```

**In `packages/repo/src/synchronizer.ts`:**
```typescript
// Method rename
#executeSubscribeDoc(docId: DocId) {  // was: #executeSubscribeLocalDoc
  // ...
}

// Dispatch calls
this.#dispatch({ type: "synchronizer/doc-ensure", docId })
this.#dispatch({ type: "synchronizer/doc-change", docId, data })
this.#dispatch({ type: "synchronizer/doc-delete", docId })
```

**In `packages/repo/src/synchronizer/index.ts`:**
```typescript
export { handleDocChange } from "./handle-doc-change.js"      // was: handleLocalDocChange
export { handleDocDelete } from "./handle-doc-delete.js"      // was: handleLocalDocDelete
export { handleDocEnsure } from "./handle-doc-ensure.js"      // was: handleLocalDocEnsure
```

### Phase 3: Add Version Tracking to Sends

**File:** `packages/repo/src/synchronizer/handle-doc-change.ts` (renamed)

**Change:** Update peer's `lastKnownVersion` after sending updates:

```typescript
if (peerState?.subscriptions.has(docId)) {
  // Check if peer needs this update
  if (shouldSyncWithPeer(docState, peerAwareness)) {
    logger.debug("sending sync-response due to doc-change", {
      channelId: channel.channelId,
      docId,
      ourVersion: docState.doc.version().toJSON(),
      theirVersion: peerAwareness?.lastKnownVersion?.toJSON(),
    })
    
    commands.push({
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [channel.channelId],
        message: {
          type: "channel/sync-response",
          docId,
          transmission: { type: "update", data },
        },
      },
    })
    
    // ✅ NEW: Update peer's known version after sending
    setPeerDocumentAwareness(
      peerState,
      docId,
      "has-doc",
      docState.doc.version()
    )
  } else {
    logger.debug("skipping sync-response - peer is up-to-date", {
      channelId: channel.channelId,
      docId,
      ourVersion: docState.doc.version().toJSON(),
      theirVersion: peerAwareness?.lastKnownVersion?.toJSON(),
    })
  }
}
```

### Phase 4: Switch to `doc.subscribe()`

**File:** `packages/repo/src/synchronizer.ts`

**Change:** Replace `subscribeLocalUpdates` with `subscribe`:

```typescript
#executeSubscribeDoc(docId: DocId) {  // Renamed from #executeSubscribeLocalDoc
  const docState = this.model.documents.get(docId)
  if (!docState) {
    this.logger.warn(`can't get doc-state, doc not found`, { docId })
    return
  }

  // ✅ CHANGED: Subscribe to ALL changes (local + imported)
  docState.doc.subscribe((event) => {
    // Export the current state as an update
    const data = docState.doc.export({ mode: "update" })
    
    this.#dispatch({ 
      type: "synchronizer/doc-change",  // Renamed from local-doc-change
      docId, 
      data,
    })
  })
}
```

**Note:** We don't need to filter by `event.by === "import"` because:
1. The version comparison in `shouldSyncWithPeer()` will prevent redundant sends
2. Simpler code is easier to maintain
3. The performance difference is negligible

### Phase 5: Update Command Type

**File:** `packages/repo/src/synchronizer-program.ts`

**Change:** Rename command type:

```typescript
export type Command =
  // ... other commands ...
  
  // Document operations
  | { type: "cmd/subscribe-doc"; docId: DocId }  // was: cmd/subscribe-local-doc
```

**File:** `packages/repo/src/synchronizer.ts`

**Change:** Update command execution:

```typescript
case "cmd/subscribe-doc": {  // was: cmd/subscribe-local-doc
  this.#executeSubscribeDoc(command.docId)  // was: #executeSubscribeLocalDoc
  break
}
```

**Files that emit this command:**
- `packages/repo/src/synchronizer/handle-doc-ensure.ts`
- `packages/repo/src/synchronizer/handle-sync-response.ts`

Update both to use new command type:
```typescript
commands.push({
  type: "cmd/subscribe-doc",  // was: cmd/subscribe-local-doc
  docId: message.docId,
})
```

## Testing Strategy

### Test 1: Three-Peer Linear Topology
```typescript
// peer-a ↔ peer-b ↔ peer-c (no direct a-c connection)
describe("multi-hop propagation", () => {
  test("change propagates through intermediate peer", async () => {
    const peerA = await createTestPeer("A")
    const peerB = await createTestPeer("B")
    const peerC = await createTestPeer("C")
    
    // Connect in a line: A ↔ B ↔ C
    await connectPeers(peerA, peerB)
    await connectPeers(peerB, peerC)
    
    // Ensure all peers have the document
    const docA = peerA.synchronizer.getOrCreateDocumentState("doc-1")
    const docB = peerB.synchronizer.getOrCreateDocumentState("doc-1")
    const docC = peerC.synchronizer.getOrCreateDocumentState("doc-1")
    
    // A makes change
    docA.doc.getText("text").insert(0, "Hello")
    
    // Wait for propagation through B to C
    await waitFor(() => {
      expect(docC.doc.getText("text").toString()).toBe("Hello")
    }, { timeout: 5000 })
    
    // Verify B also has the change
    expect(docB.doc.getText("text").toString()).toBe("Hello")
  })
})
```

### Test 2: Cycle Prevention
```typescript
describe("cycle prevention", () => {
  test("no infinite loops in triangle topology", async () => {
    const peerA = await createTestPeer("A")
    const peerB = await createTestPeer("B")
    const peerC = await createTestPeer("C")
    
    // Connect in a triangle: A ↔ B ↔ C ↔ A
    await connectPeers(peerA, peerB)
    await connectPeers(peerB, peerC)
    await connectPeers(peerC, peerA)
    
    // Track messages sent
    const messagesSent: string[] = []
    const originalSend = peerA.adapters.send
    peerA.adapters.send = (envelope) => {
      messagesSent.push(`${envelope.message.type}:${envelope.message.docId}`)
      return originalSend.call(peerA.adapters, envelope)
    }
    
    // Ensure all peers have the document
    const docA = peerA.synchronizer.getOrCreateDocumentState("doc-1")
    const docB = peerB.synchronizer.getOrCreateDocumentState("doc-1")
    const docC = peerC.synchronizer.getOrCreateDocumentState("doc-1")
    
    // A makes change
    docA.doc.getText("text").insert(0, "Hello")
    
    // Wait for propagation
    await waitFor(() => {
      return (
        docB.doc.getText("text").toString() === "Hello" &&
        docC.doc.getText("text").toString() === "Hello"
      )
    }, { timeout: 5000 })
    
    // Should only send limited messages, not infinite
    // Each peer should send at most once per other peer
    expect(messagesSent.length).toBeLessThan(10)
    
    // Verify no peer sent the same update multiple times
    const syncResponses = messagesSent.filter(m => m.startsWith("channel/sync-response"))
    const uniqueResponses = new Set(syncResponses)
    expect(syncResponses.length).toBe(uniqueResponses.size)
  })
})
```

### Test 3: Version Tracking Accuracy
```typescript
describe("version tracking", () => {
  test("peer versions are accurately tracked after propagation", async () => {
    const peerA = await createTestPeer("A")
    const peerB = await createTestPeer("B")
    
    await connectPeers(peerA, peerB)
    
    const docA = peerA.synchronizer.getOrCreateDocumentState("doc-1")
    const docB = peerB.synchronizer.getOrCreateDocumentState("doc-1")
    
    // A makes change
    docA.doc.getText("text").insert(0, "Hello")
    
    // Wait for sync
    await waitFor(() => {
      return docB.doc.getText("text").toString() === "Hello"
    })
    
    // Check that A knows B's version
    const peerBState = peerA.synchronizer.getPeerState(peerB.identity.peerId)
    const bAwareness = peerBState?.documentAwareness.get("doc-1")
    
    expect(bAwareness?.awareness).toBe("has-doc")
    expect(bAwareness?.lastKnownVersion?.toJSON()).toEqual(
      docB.doc.version().toJSON()
    )
  })
  
  test("version comparison prevents redundant sends", async () => {
    const peerA = await createTestPeer("A")
    const peerB = await createTestPeer("B")
    
    await connectPeers(peerA, peerB)
    
    const docA = peerA.synchronizer.getOrCreateDocumentState("doc-1")
    const docB = peerB.synchronizer.getOrCreateDocumentState("doc-1")
    
    // Track sync-response messages
    let syncResponseCount = 0
    const originalSend = peerA.adapters.send
    peerA.adapters.send = (envelope) => {
      if (envelope.message.type === "channel/sync-response") {
        syncResponseCount++
      }
      return originalSend.call(peerA.adapters, envelope)
    }
    
    // A makes change
    docA.doc.getText("text").insert(0, "Hello")
    
    // Wait for sync
    await waitFor(() => {
      return docB.doc.getText("text").toString() === "Hello"
    })
    
    // Should have sent exactly one sync-response
    expect(syncResponseCount).toBe(1)
    
    // Now B imports the same change again (simulating a duplicate)
    // This should NOT trigger another send from A
    const beforeCount = syncResponseCount
    docB.doc.import(docA.doc.export({ mode: "snapshot" }))
    
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Should not have sent another sync-response
    expect(syncResponseCount).toBe(beforeCount)
  })
})
```

### Test 4: Four-Peer Complex Topology
```typescript
describe("complex topologies", () => {
  test("change propagates in mesh network", async () => {
    // Create a mesh: A ↔ B, A ↔ C, B ↔ D, C ↔ D
    const peerA = await createTestPeer("A")
    const peerB = await createTestPeer("B")
    const peerC = await createTestPeer("C")
    const peerD = await createTestPeer("D")
    
    await connectPeers(peerA, peerB)
    await connectPeers(peerA, peerC)
    await connectPeers(peerB, peerD)
    await connectPeers(peerC, peerD)
    
    // Ensure all peers have the document
    const docA = peerA.synchronizer.getOrCreateDocumentState("doc-1")
    const docB = peerB.synchronizer.getOrCreateDocumentState("doc-1")
    const docC = peerC.synchronizer.getOrCreateDocumentState("doc-1")
    const docD = peerD.synchronizer.getOrCreateDocumentState("doc-1")
    
    // A makes change
    docA.doc.getText("text").insert(0, "Hello")
    
    // All peers should eventually receive the change
    await waitFor(() => {
      return (
        docB.doc.getText("text").toString() === "Hello" &&
        docC.doc.getText("text").toString() === "Hello" &&
        docD.doc.getText("text").toString() === "Hello"
      )
    }, { timeout: 5000 })
  })
})
```

## Migration Guide

### For Library Users

**No breaking changes** - this is an internal implementation detail. Users will automatically benefit from multi-hop propagation.

### For Library Developers

If you've extended the synchronizer or written custom handlers:

1. **Message type changes:**
   - `synchronizer/local-doc-change` → `synchronizer/doc-change`
   - `synchronizer/local-doc-ensure` → `synchronizer/doc-ensure`
   - `synchronizer/local-doc-delete` → `synchronizer/doc-delete`

2. **Command type changes:**
   - `cmd/subscribe-local-doc` → `cmd/subscribe-doc`

3. **Function renames:**
   - `handleLocalDocChange` → `handleDocChange`
   - `handleLocalDocDelete` → `handleDocDelete`
   - `handleLocalDocEnsure` → `handleDocEnsure`

4. **Channel message changes:**
   - `ChannelMsgSyncResponse` no longer has `hopCount` field

## Performance Considerations

### Expected Impact

1. **CPU:** Minimal increase
   - Version comparison is O(peers), typically < 10 peers
   - `shouldSyncWithPeer()` is a simple comparison

2. **Memory:** No change
   - Version vectors already tracked
   - No new data structures

3. **Network:** Potential reduction
   - Fewer redundant syncs due to version checking
   - More efficient propagation in sparse topologies

### Benchmarks to Run

1. **Single change propagation time** (3-peer linear)
2. **Convergence time** (4-peer mesh, 100 changes)
3. **Message count** (triangle topology, 50 changes)
4. **Memory usage** (10 peers, 1000 documents)

## Rollout Plan

### Phase 1: Internal Testing (Week 1)
- Implement changes
- Run full test suite
- Add new multi-hop tests
- Benchmark performance

### Phase 2: Alpha Release (Week 2)
- Release as `@loro-extended/repo@x.y.0-alpha.1`
- Document changes in CHANGELOG
- Gather feedback from early adopters

### Phase 3: Beta Release (Week 3)
- Address any issues from alpha
- Release as `@loro-extended/repo@x.y.0-beta.1`
- Expand testing to more complex scenarios

### Phase 4: Stable Release (Week 4)
- Final testing and documentation
- Release as `@loro-extended/repo@x.y.0`
- Update examples and tutorials

## Success Criteria

✅ Changes propagate through intermediate peers  
✅ No infinite loops in any topology (triangle, mesh, etc.)  
✅ Version tracking remains accurate  
✅ Performance impact < 5%  
✅ All existing tests pass  
✅ New tests cover multi-hop scenarios  
✅ Documentation updated  
✅ Zero breaking changes for users  

## Open Questions

### Q1: Should we add a configuration option?
**Option A:** Always enable multi-hop (recommended)
- Simpler code
- Better default behavior
- No configuration needed

**Option B:** Add `enableMultiHopPropagation` flag
- More conservative
- Allows gradual rollout
- Adds complexity

**Decision:** Option A - always enable. This is the correct behavior for a CRDT system.

### Q2: Should we add metrics/telemetry?
Consider adding:
- Counter: `sync_responses_sent`
- Counter: `sync_responses_skipped_up_to_date`
- Histogram: `version_comparison_time_ms`

**Decision:** Add basic counters in debug mode, can be expanded later.

## References

- [Loro Documentation](https://loro.dev/docs)
- [Version Vectors](https://en.wikipedia.org/wiki/Version_vector)
- [CRDT Fundamentals](https://crdt.tech/)
- [`docs/discovery-and-sync-architecture.md`](../docs/discovery-and-sync-architecture.md)