# Technical Documentation: Video Conference Example

## Architecture Overview

The video conference example demonstrates loro-extended's real-time collaboration capabilities using:

- **WebRTC** for peer-to-peer video/audio streams
- **CRDT documents** for persistent room state (participant list)
- **Ephemeral presence** for transient WebRTC signaling

### Document Model

The application uses **two separate documents** per room:

| Document | ID Pattern | Purpose | Persistence |
|----------|------------|---------|-------------|
| Room Document | `room-{uuid}` | Participant list, room metadata | Persistent (LevelDB) |
| Signaling Document | `room-{uuid}:signaling` | WebRTC offer/answer/ICE signals | Ephemeral only |

### Presence Types

Each document has its own ephemeral presence schema:

```typescript
// Room document presence - stable user metadata
UserPresence = { name: string, wantsAudio: boolean, wantsVideo: boolean }

// Signaling document presence - transient WebRTC signals
SignalingPresence = { instanceId: string, signals: Record<PeerID, SignalData[]> }
```

The separation prevents high-frequency signal updates from interfering with stable user metadata.

## Server Visibility Model

The server acts as a **hub-and-spoke relay** between clients:

```
Client A ──SSE──► Server ──SSE──► Client B
    │                                │
    └────────── WebRTC ──────────────┘
```

### Understanding `visibility` Permission

**Visibility controls DISCOVERY, not DATA TRANSFER.** It determines whether a peer can learn that a document exists, NOT whether they can receive data once subscribed.

#### Where Visibility IS Checked

| Scenario | Effect of `false` |
|----------|-------------------|
| Initial sync list on connection | Document omitted from list |
| Announcing new docs to non-subscribed peers | No announcement sent |
| `directory-request` response | Document omitted |

#### Where Visibility is NOT Checked (Bypass)

| Scenario | Behavior |
|----------|----------|
| Receiving `sync-request` | Always subscribes peer, returns data |
| Sending updates to subscribed peers | Visibility bypassed |
| Relaying ephemeral/presence | Uses subscriptions only |

#### Why We Return `true`

```typescript
permissions: {
  visibility(_doc, peer) {
    if (peer.channelKind === "storage") return true
    return true  // Allow server to announce documents
  },
}
```

Returning `true` allows the server to proactively announce documents to clients. This is useful for scenarios where the server creates documents or when timing of announcements matters.

#### What `false` Would Actually Do

```typescript
// This would NOT block sync or ephemeral relay!
visibility(_doc, peer) {
  if (peer.channelKind === "storage") return true
  return false
}
```

With `false`, the server would:
- ❌ NOT announce documents to clients proactively
- ❌ NOT include documents in initial sync list
- ✅ STILL respond to explicit sync-requests
- ✅ STILL relay ephemeral to subscribed peers
- ✅ STILL send updates to subscribed peers

In the video conference, clients explicitly request both documents via `useDocument()`, so `false` may work. However, `true` is safer for edge cases involving timing and announcement order.

## WebRTC Signaling Flow

Signaling uses loro-extended's ephemeral presence instead of a dedicated WebSocket:

```
1. Client A joins room, sets signalingPresence:
   { instanceId: "abc", signals: {} }

2. Client A sees Client B in participants, determines it should initiate
   (based on peerId comparison via shouldInitiate())

3. Client A creates WebRTC offer, publishes to presence:
   { instanceId: "abc", signals: { [clientB]: [{ type: "offer", sdp: "..." }] } }

4. Server receives ephemeral update, forwards to Client B

5. Client B reads offer from Client A's presence, creates answer:
   { instanceId: "xyz", signals: { [clientA]: [{ type: "answer", sdp: "..." }] } }

6. ICE candidates flow similarly until connection established

7. Once connected, clients clear their outgoing signals to prevent payload bloat
```

### Instance ID for Signal Deduplication

Each browser session generates a unique `instanceId` (UUID). This allows:

- Ignoring stale signals from previous sessions (page reload)
- Targeting signals to a specific browser instance
- Deduplicating signals that arrive multiple times through presence updates

## Dual-Adapter Sync

Clients use two network adapters simultaneously:

```typescript
const config = {
  adapters: [sseAdapter, webrtcAdapter],
}
```

| Adapter | Path | Purpose |
|---------|------|---------|
| SSE | Client ↔ Server | Reliable sync, persistence, relay |
| WebRTC Data Channel | Client ↔ Client | Low-latency peer-to-peer sync |

**Resilience**: If SSE disconnects, peers continue syncing via WebRTC. If WebRTC fails, SSE provides fallback. loro-extended handles deduplication automatically.

## Functional Core / Imperative Shell

### Pure Functions (Testable without React)

- `shouldInitiate(myPeerId, remotePeerId)` — Deterministic initiator selection
- `createSignalId(peerId, signal)` — Signal deduplication key
- `computePeerActions(current, target, ...)` — Peer lifecycle decisions

### Imperative Shell (React Hooks)

- `usePeerManager` — Creates/destroys WebRTC peer connections
- `useSignalChannel` — Manages signal queue and deduplication
- `useWebRtcMesh` — Orchestrates the above based on presence changes

## Testing Patterns

### Unit Tests

Pure functions like `shouldInitiate` and signal deduplication can be tested directly without React:

```typescript
it("smaller peerId initiates", () => {
  expect(shouldInitiate("100" as PeerID, "200" as PeerID)).toBe(true)
  expect(shouldInitiate("200" as PeerID, "100" as PeerID)).toBe(false)
})
```

### Hook Tests

Hooks are tested using `@testing-library/react` with mocked `simple-peer`:

```typescript
vi.mock("simple-peer/simplepeer.min.js", () => ({ default: vi.fn() }))

const { result } = renderHook(() => useWebRtcMesh(...))
await waitFor(() => expect(result.current.connectionStates.size).toBe(1))
```

### Integration Tests

Manual testing with two browser tabs remains essential for verifying the full WebRTC flow, as mocking WebRTC internals is complex and error-prone.