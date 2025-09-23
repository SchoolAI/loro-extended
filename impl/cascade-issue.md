# The Sync Cascade Issue

## Problem Summary

When implementing multi-peer synchronization through a server (hub-and-spoke topology), we discovered a critical issue: sync messages can create infinite loops or "sync storms" when the server naively forwards received sync messages to all other aware peers.

## The Scenario

Consider this setup:
- **Server** (acts as both a peer and a hub)
- **Browser A** (peer connected to server)
- **Browser B** (peer connected to server)

When Browser A makes a change:
1. Browser A sends sync to Server and Browser B
2. Server receives sync, applies it, and forwards to Browser B
3. Browser B receives TWO copies of the same sync (one direct, one via server)
4. If Browser B were to forward syncs it receives, this could cascade infinitely

## What We Tried

### Initial Approach: Server as Relay
We modified the synchronizer to forward received sync messages to other aware peers:

```typescript
case "msg/received-sync": {
  // Apply the sync locally
  commands.push({ type: "cmd/sync-succeeded", ... })
  
  // Forward to other aware peers (excluding sender)
  const forwardTargets = [...awarePeers].filter(peerId => peerId !== from)
  if (forwardTargets.length > 0) {
    commands.push({
      type: "cmd/send-message",
      message: { type: "sync", targetIds: forwardTargets, ... }
    })
  }
}
```

**Result**: Sync storm! Messages bounce between peers indefinitely.

## Why This Is Surprising

1. **CRDTs Should Be Idempotent**: Loro (and CRDTs in general) are designed to handle duplicate messages gracefully. Applying the same change multiple times should be safe. However, the *forwarding* logic creates new network messages, not just duplicate applications.

2. **The Server Is Also a Peer**: In our architecture, the server isn't just a relay—it's a full peer with its own document copy. This dual role creates ambiguity about when it should forward vs. when it should only apply changes locally.

3. **Event-Driven != Message-Driven**: We have event-driven awareness tracking (who knows about what), but sync propagation is message-driven. This mismatch creates the cascade problem.

## Root Causes

### 1. Missing Message Deduplication
Sync messages don't have unique identifiers or version vectors that would allow peers to recognize "I've already seen this change."

### 2. Unclear Topology Assumptions
The current design doesn't distinguish between:
- **Mesh topology**: Every peer talks directly to every other peer
- **Hub-and-spoke**: All communication goes through a central server
- **Hybrid**: Some peers connect directly, others through hubs

### 3. Local vs. Remote Change Ambiguity
The system distinguishes between:
- **Local changes**: Made through `change()` method → emit `doc-handle-local-change`
- **Remote changes**: Received via sync → apply silently

But there's no concept of "changes I should relay" vs. "changes I should only apply."

## Potential Solutions

### Solution 1: Version Vectors (Recommended)
Include version vectors in sync messages to enable deduplication:

```typescript
interface SyncMessage {
  type: "sync"
  documentId: DocumentId
  data: Uint8Array
  version: VersionVector  // New: identifies this specific change
  origin: PeerId         // New: who originally made this change
}
```

Peers track seen versions and only forward novel changes.

### Solution 2: Explicit Relay Role
Separate "relay" behavior from "peer" behavior:

```typescript
class RelayNode {
  // Only forwards messages, doesn't maintain documents
}

class PeerNode {
  // Only applies changes locally, never forwards
}
```

### Solution 3: Gossip Protocol
Implement a proper gossip protocol with:
- Periodic state exchange (not every change)
- Anti-entropy mechanisms
- Bounded message propagation

### Solution 4: Client-Only Forwarding
Only clients (leaf nodes) broadcast changes. Servers/hubs only respond to direct requests:

```typescript
if (isLeafNode) {
  // Broadcast to all aware peers
  broadcast(change)
} else {
  // Server: only apply locally
  applyLocally(change)
}
```

## Considerations for Implementation

### 1. Backward Compatibility
Any solution must work with existing clients that don't understand the new protocol.

### 2. Performance
Version vector comparison and deduplication add overhead. Consider:
- Bloom filters for quick "have I seen this?" checks
- Periodic garbage collection of old version vectors
- Compression of version vector data

### 3. Network Partitions
How do we handle:
- Peers that disconnect and reconnect?
- Split-brain scenarios where the network partitions?
- Late-joining peers that missed earlier messages?

### 4. Testing Strategy
Essential test cases:
- Triangle topology (A ↔ Server ↔ B, A ↔ B)
- Chain topology (A → B → C → D)
- Partition/rejoin scenarios
- High-frequency concurrent changes

## Lessons Learned

1. **Explicit Is Better Than Implicit**: The role of each node (leaf, hub, relay) should be explicit in the protocol.

2. **Test Topology Early**: Multi-peer scenarios reveal issues that two-peer tests miss.

3. **Message != Event**: Just because we received a change doesn't mean we should forward it.

4. **CRDTs Aren't Magic**: While CRDTs handle concurrent edits, they don't solve message routing and deduplication.

## Temporary Workaround

Until a proper solution is implemented, avoid the cascade by:

1. **Disabling server-side forwarding**: Revert the forwarding logic in `msg-received-sync`
2. **Direct peer connections**: Ensure clients connect to each other directly when possible
3. **Accept the limitation**: In hub-and-spoke setups, changes from one client won't reach others until they make their own changes (triggering a full sync)

## Future Work

1. Implement version vectors in Loro sync messages
2. Add explicit topology configuration to Repo
3. Create a dedicated RelayAdapter for server-side use
4. Add integration tests for various network topologies
5. Document the expected behavior for each topology type

## References

- [Epidemic Algorithms for Replicated Database Maintenance](https://www.cs.cornell.edu/home/rvr/papers/flowgossip.pdf)
- [Conflict-free Replicated Data Types](https://hal.inria.fr/inria-00609399/document)
- [The Problem with Eventual Consistency](https://www.allthingsdistributed.com/2008/12/eventually_consistent.html)

# Loro Documentation

Loro has partially solved the problem of determining what information needs to be shared in order to bring a peer "up to date" with another peer. Here is the LoroDoc "export" function documentation:

## LoroDoc export

> export(mode: ExportMode): Uint8Array;

 Export the document based on the specified ExportMode.

 @param mode - The export mode to use. Can be one of:
   - `{ mode: "snapshot" }`: Export a full snapshot of the document.
   - `{ mode: "update", from?: VersionVector }`: Export updates from the given version vector.
   - `{ mode: "updates-in-range", spans: { id: ID, len: number }[] }`: Export updates within the specified ID spans.
   - `{ mode: "shallow-snapshot", frontiers: Frontiers }`: Export a garbage-collected snapshot up to the given frontiers.

 @returns A byte array containing the exported data.

 @example
 ```ts
 import { LoroDoc } from "loro-crdt";

 const doc = new LoroDoc();
 doc.setPeerId("1");
 doc.getText("text").update("Hello World");

 // Export a full snapshot
 const snapshotBytes = doc.export({ mode: "snapshot" });

 // Export updates from a specific version
 const vv = doc.oplogVersion();
 doc.getText("text").update("Hello Loro");
 const updateBytes = doc.export({ mode: "update", from: vv });

 // Export a shallow snapshot that only includes the history since the frontiers
 const shallowBytes = doc.export({ mode: "shallow-snapshot", frontiers: doc.oplogFrontiers() });

 // Export updates within specific ID spans
 const spanBytes = doc.export({
   mode: "updates-in-range",
   spans: [{ id: { peer: "1", counter: 0 }, len: 10 }]
 });
 ```

## DocState and OpLog

Although not explicitly exposed in the WASM interface, internally in Loro, we
distinctly differentiate between:

- The current state of the document: DocState
- The edit history of the document: OpLog

During local operations, we update the DocState and record the operations in
OpLog. When merging remote updates, we add the new Ops to OpLog and compute a
Delta. This Delta is applied to DocState and also emitted as an event.

DocState can switch between different versions, similar to Git's checkout. In
this case, we calculate the Delta based on the edit history. The same mechanism
applies: the Delta is emitted as an event and applied to DocState.

Impact on the encoding schema:

- When calling `doc.export({ mode: "update" })` or
  `doc.export({ mode: "update-in-range" })`, we only encode the operations that
  occurred after the specified version.
- When calling `doc.export({ mode: "snapshot" })` or
  `doc.export({ mode: "shallow-snapshot" })`, we encode both OpLog and DocState,
  providing rapid loading speed (as it doesn't require recalculating the state
  of DocState).

## Attached/Detached LoroDoc Status

As we aim to support version control and the ability to load OpLog without
state, the version of DocState and the latest version recorded in OpLog may not
always match. When they align, it is in an _attached_ state; otherwise, it's in
a _detached_ state.

```ts
const doc = new LoroDoc();
doc.setPeerId(1);
doc.getText("text").insert(0, "Hello");
const doc2 = doc.fork(); // create a fork of the doc
console.log(doc.version().toJSON());
// Map(1) { "1" => 5 }
console.log(doc.oplogVersion().toJSON());
// Map(1) { "1" => 5 }

doc.checkout([{ peer: "1", counter: 1 }]);
console.log(doc.version().toJSON());
// Map(1) { "1" => 2 }
console.log(doc.oplogVersion().toJSON());
// Map(1) { "1" => 5 }

doc2.setPeerId(2);
doc2.getText("text").insert(5, "!");
doc.import(doc2.export({ mode: "update" }));
console.log(doc.version().toJSON());
// Map(1) { "1" => 2 }
console.log(doc.oplogVersion().toJSON());
// Map(2) { "1" => 5, "2" => 1 }

console.log(doc.isDetached()); // true
doc.attach();
console.log(doc.version().toJSON());
// Map(2) { "1" => 5, "2" => 1 }
console.log(doc.oplogVersion().toJSON());
// Map(2) { "1" => 5, "2" => 1 }
```

![DocState and OpLog Detached Example](./images/version-4.png)

The doc cannot be edited in the detached mode. Users must use `attach()` to
return to the latest version to continue editing.

## Operations and Change

In Loro, every basic operation such as setting a key-value pair on a Map, adding
a list item, or inserting/deleting a character in text is considered an
individual op. (Don't worry about the cost, in Loro's internal memory
representation and export format, consecutive ops are merged into a larger op,
such as consecutive text insertions and deletions.)

One or more local consecutive `Op`s constitute a `Change`, which includes the
following information:

- ID: ID of the Change is essentially the first op's ID
- Timestamp: An optional timestamp, which can be enabled with
  `setRecordTimestamp(true)`. If not enabled, there is no extra storage
  overhead.
- Dependency IDs: Used to represent the causal order, the Op IDs that the
  current Change directly depends on.
- Commit Message: An optional commit message (WIP not yet released); when not
  enabled, there is no extra storage overhead.

Each time `doc.commit()` is called, a new `Change` is generated, which will be
merged with the previous local `Change` as much as possible to reduce the amount
of metadata that needs to be stored.

> Note: Each time you export, a `doc.commit()` is implicitly performed by the
> Loro Doc.

Unlike a Git commit, Loro's Change can be merged; it is neither atomic nor
indivisible. This design allows Loro to better accommodate real-time
collaboration scenarios (where each keystroke would have its own `doc.commit()`,
which would be hugely costly if not merged) and asynchronous collaboration
scenarios (like Git, which combines many modifications to form one).

### When a New Change is Formed

> Note: You may not need to understand the content of this section, and the
> content may change in future versions. Unless you want to understand Loro's
> internal implementation or want to achieve more extreme performance
> optimization.

By default, each commit-generated `Change` will merge with the previous local
`Change`. However, there are exceptions in several cases:

- The current Change depends on a Change from a different peer. This occurs when
  local operations build upon recently applied remote operations. For example,
  deleting a character sequence that was just inserted by a remote peer. These
  causal relationships form a DAG (Directed Acyclic Graph). After importing
  remote updates, the next local Change will have new dependency IDs,
  necessitating a separate Change.
- When `setRecordTimestamp(true)` is set, if the time interval between
  successive Changes exceeds the "change merge interval" (default duration
  1000s).
- When the current Change has a different commit message from the previous
  Change by the same peer.

### Example

```ts
import { Change, LoroDoc } from "npm:loro-crdt@1.0.0-beta.5";

const docA = new LoroDoc();
docA.setPeerId("0");
const textA = docA.getText("text");
// This create 3 operations
textA.insert(0, "123");
// This create a new Change
docA.commit();
// This create 2 operations
textA.insert(0, "ab");
// This will NOT create a new Change
docA.commit();

{
  const changeMap: Map<`${number}`, Change[]> = docA.getAllChanges();
  console.log(changeMap);
  // Output:
  //
  // Map(1) {
  //   "0" => [
  //     {
  //       lamport: 0,
  //       length: 5,
  //       peer: "0",
  //       counter: 0,
  //       deps: [],
  //       timestamp: 0
  //     }
  //   ]
  // }
}

// Create docB from doc
const docB = LoroDoc.fromSnapshot(docA.export({ mode: "snapshot" }));
docB.setPeerId("1");
const textB = docB.getText("text");
// This create 2 operations
textB.insert(0, "cd");

// Import the Change from docB to doc
const bytes = docB.export({ mode: "update" }); // Exporting has implicit commit
docA.import(bytes);

// This create 1 operations
textA.insert(0, "1");
// Because doc import a Change from docB, it will create a new Change for
// new commit to record this causal order
docA.commit();
{
  const changeMap: Map<`${number}`, Change[]> = docA.getAllChanges();
  console.log(changeMap);
  // Output:
  //
  // Map(2) {
  //   "0" => [
  //     {
  //       lamport: 0,
  //       length: 5,
  //       peer: "0",
  //       counter: 0,
  //       deps: [],
  //       timestamp: 0
  //     },
  //     {
  //       lamport: 7,
  //       length: 1,
  //       peer: "0",
  //       counter: 5,
  //       deps: [ { peer: "1", counter: 1 } ],
  //       timestamp: 0
  //     }
  //   ],
  //   "1" => [
  //     {
  //       lamport: 5,
  //       length: 2,
  //       peer: "1",
  //       counter: 0,
  //       deps: [ { peer: "0", counter: 4 } ],
  //       timestamp: 0
  //     }
  //   ]
  // }
}
```

## Batch Import

### Performance Differences and Their Causes

When importing multiple updates into a document, using `doc.importBatch(updates)` is significantly faster than importing updates individually. This performance difference stems from how data merging is handled in each approach.

```ts
import { LoroDoc } from "loro-crdt";

const doc = new LoroDoc();
doc.getText("text").update("Hello");
const update1 = doc.export({ mode: "update" });
const version = doc.version();
doc.getText("text").update("Hello World");
const update2 = doc.export({ mode: "update", from: version });

const newDoc1 = new LoroDoc();
newDoc1.importBatch([update1, update2]); // faster

const newDoc2 = new LoroDoc();
for (const update of [update1, update2]) {
  // slower
  newDoc2.import(update);
}
```

#### Key Advantages of Import Batch

##### 1. Single Diff Calculation

The most significant advantage is that import batch performs only one diff calculation. In contrast, each individual import follows these steps:

- Merge remote updates into local history
- Calculate document state changes from the current version to the merged version
- Apply the diff to the current document state

This diff calculation has fixed overhead costs that accumulate with each import. But `doc.importBatch(...)` only performs one diff calculation, which is faster than multiple individual diff calculations.

##### 2. Reduced Communication Overhead

Import batch also results in more concise events. Each individual import generates a new event, but `doc.importBatch(...)` generates only a single event that contains all the changes.

