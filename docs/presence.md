# Ephemeral (Presence) Data Propagation

This document explains the theory and implementation of Ephemeral Store (Presence) data propagation in `loro-extended`.

## Theory of Intent

In real-time collaborative scenarios, **Presence** information (cursors, selection, online status) is critical but distinct from document data. It should be:
- **Transient**: Not persisted in the document history.
- **Real-time**: Prioritizing low latency over perfect consistency.
- **Self-Cleaning**: Automatically removed when a peer disconnects or times out.

We use the **Loro Ephemeral Store**, a timestamp-based, Last-Write-Wins (LWW) key-value store designed specifically for this purpose.

## Loro Ephemeral Store Fundamentals

The underlying `EphemeralStore` from `loro-crdt` provides the primitive operations:

- **State**: A key-value store where each entry has a timestamp.
- **Sync**: `encode(key)` / `encodeAll()` produces binary updates; `apply(bytes)` merges them using LWW rules.
- **Events**: Emits `local`, `import`, and `timeout` events.
- **Timeouts**: Entries automatically expire if not updated within a timeout window (default 30s).

## Implementation in `loro-extended`

We wrap the raw `EphemeralStore` to handle network propagation, topology management, and connection lifecycle.

### Message Structure

```typescript
type ChannelMsgEphemeral = {
  type: "channel/ephemeral"
  docId: DocId
  hopsRemaining: number // Controls relay distance
  data: Uint8Array      // Encoded ephemeral updates (from store.encode/encodeAll)
}
```

### Propagation Strategies

We use two distinct strategies depending on the trigger:

#### 1. Local Change (High Frequency, Multi-hop)
When a user moves their cursor or changes status locally:
- **Trigger**: `synchronizer/ephemeral-local-change`
- **Payload**: Only the local peer's data (`store.encode(peerId)`).
- **Hops**: `hopsRemaining: 1`
- **Goal**: Fast propagation to immediate peers AND their peers (e.g., Client A -> Server -> Client B).

#### 2. Heartbeat (Low Frequency, Single-hop)
Periodically (every 10s), we ensure convergence:
- **Trigger**: `synchronizer/heartbeat`
- **Payload**: The **entire** ephemeral store (`store.encodeAll()`).
- **Hops**: `hopsRemaining: 0`
- **Goal**: Heal inconsistencies and ensure new peers get full state. Direct neighbors only to prevent flooding.

#### 3. Connection Handshake (Embedded in Sync Messages)
Ephemeral data is now embedded directly in sync-request and sync-response messages, eliminating race conditions during initial synchronization:

**Sync Request (Client → Server)**:
- **Trigger**: `handleSyncRequest` receives `channel/sync-request` with optional `ephemeral` field
- **Payload**: Requester's ephemeral data for the document
- **Behavior**:
  1. Server applies the ephemeral data locally
  2. Server relays to other connected peers (hub-and-spoke)
  3. Server includes all known ephemeral in the sync-response

**Sync Response (Server → Client)**:
- **Trigger**: `cmd/send-sync-response` with `includeEphemeral: true`
- **Payload**: The **entire** ephemeral store (`store.encodeAll()`)
- **Goal**: Client receives all presence data atomically with document data

This design ensures:
- No race conditions between document sync and presence sync
- Presence is visible immediately after sync completes
- Fewer separate messages during initial connection

### The "Hops" Logic

The `hopsRemaining` counter enables limited relaying without infinite loops:

1.  **Sender**: Sets `hopsRemaining` (0 or 1).
2.  **Receiver**:
    - Applies the data locally (`store.apply(data)`).
    - If `hopsRemaining > 0`:
        - Decrements `hopsRemaining`.
        - Rebroadcasts to all *other* established channels subscribed to that doc.

**Why 1 Hop?**
This supports the common **Hub-and-Spoke** architecture:
- **Client A** sends update (`hops: 1`) -> **Server**.
- **Server** receives, sees `hops: 1`.
- **Server** applies update, decrements to `0`, and relays to **Client B**.
- **Client B** receives, sees `hops: 0`. Applies update. Stops.

This allows Client A and B to communicate via the Server without a full mesh network.

### Disconnect Cleanup

We employ a dual-strategy for cleanup:

1.  **Explicit Disconnect (Fast)**:
    - When a peer disconnects (last channel removed), we trigger `cmd/remove-ephemeral-peer`.
    - We delete the peer's data locally (`store.delete(peerId)`).
    - We broadcast a "deletion update" (encoded empty state for that peer) to other channels.

2.  **Passive Timeout (Safety Net)**:
    - The `EphemeralStore` is initialized with a timeout (e.g., `HEARTBEAT_INTERVAL * 2`).
    - If a peer silently vanishes (crash, network partition) and we miss the disconnect event, their data will automatically expire and be removed by the store's internal logic.

## Typed Presence

To improve developer experience and type safety, `loro-extended` provides a `TypedPresence` API. This allows you to define a schema for your presence data and provides default values for missing fields.

```typescript
const presence = handle.typedPresence(PresenceSchema, EmptyPresence);
```

This ensures that:
1.  **Type Safety**: Accessing `presence.self` or `presence.all` returns strongly typed objects.
2.  **Default Values**: If a peer hasn't set their presence yet, or if they are missing specific fields, the `EmptyPresence` defaults are automatically applied. This eliminates the need for manual null checks and type casting.

## Appendix: Gaps & Future Work

1.  **Scaling**: Sending the full store on heartbeat/handshake is O(N) where N is peers in the presence. For very large presence groups, this could be optimized to delta updates.
2.  **Conflict Resolution**: Loro handles CRDT merging, but "last write wins" on wall clock time is the general rule for ephemeral data.
3.  **Timeouts**: While we have explicit disconnect cleanup, we also rely on a passive timeout (2x heartbeat interval) in `getOrCreateEphemeralStore` to clean up stale data from ungraceful disconnects.