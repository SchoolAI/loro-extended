# Video Conference Example

A simple WebRTC-based video conference app using `simple-peer` and `loro-extended`.

## Features

- **Real-time video/audio** via WebRTC peer-to-peer connections
- **Room-based** - share a link to invite others
- **CRDT-synced participant list** - see who's in the room
- **Presence-based signaling** - WebRTC signals flow through loro-extended's ephemeral presence system
- **Dual-adapter sync** - SSE for server communication + WebRTC data channels for peer-to-peer sync
- **Offline resilient** - if the server goes down, peers continue syncing directly via WebRTC

## Architecture

This example demonstrates how to use loro-extended for both:

1. **Persistent state (CRDT document)**: Room metadata and participant list
2. **Ephemeral state (typed presence)**: WebRTC signaling data (SDP offers/answers, ICE candidates)
3. **Multi-adapter sync**: Redundant sync paths for resilience

```
┌────────────────────────────────────────────┐
│                   Server                   │
│  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Loro Repo      │  │  LevelDB        │  │
│  │  (SSE Adapter)  │  │  Storage        │  │
│  └────────┬────────┘  └─────────────────┘  │
└───────────┼────────────────────────────────┘
            │ SSE + HTTP POST
    ┌───────┴───────┐
    │               │
┌───┴───┐       ┌───┴───┐
│Client │◄─────►│Client │  WebRTC (video/audio + Loro sync)
│   A   │       │   B   │
└───────┘       └───────┘
    │               │
    └───────────────┘
    WebRTC Data Channel
    (loro-extended sync)
```

### Dual-Adapter Sync

This example uses **two network adapters** simultaneously:

1. **SSE Adapter** - Communicates with the server for reliable, persistent sync
2. **WebRTC Data Channel Adapter** - Peer-to-peer sync directly between browsers

When both adapters are active, loro-extended automatically applies messages idempotently, and the same peer connected via multiple channels is tracked as a single peer. This provides:

- **Redundancy**: If the server goes down, peers continue syncing via WebRTC
- **Lower latency**: Direct peer-to-peer updates don't need to round-trip through the server
- **Offline resilience**: As long as peers are connected via WebRTC, collaboration continues

## How Signaling Works

Instead of a dedicated WebSocket signaling server, we use loro-extended's presence system:

1. **Client A** creates a `simple-peer` instance (as initiator)
2. `simple-peer` emits a `signal` event with SDP offer
3. **Client A** publishes the signal in their presence: `{ signals: { [clientB_peerId]: [offer] } }`
4. Presence propagates via loro-extended SSE
5. **Client B** reads Client A's presence, finds the signal addressed to itself
6. **Client B** passes the signal to its `simple-peer` instance
7. `simple-peer` emits a `signal` event with SDP answer
8. **Client B** publishes the answer in their presence
9. ICE candidates flow the same way
10. WebRTC connection established!

## Running the Example

```bash
# From the repository root
pnpm install

# Start the development server
cd examples/video-conference
pnpm dev
```

This starts:

- **Vite dev server** on http://localhost:5173 (client)
- **Express server** on http://localhost:5171 (loro-extended backend)

## Usage

1. Open http://localhost:5173 in your browser
2. Allow camera/microphone access
3. Click "Join Room"
4. Copy the URL and open in another browser tab/window
5. Both participants should see each other's video

## Project Structure

```
src/
├── main.tsx                      # Entry point with RepoProvider
├── index.css                     # Tailwind styles
├── client/
│   ├── video-conference-app.tsx  # Main app component
│   ├── video-bubble.tsx          # Video display component
│   ├── use-room-id-from-hash.ts  # URL hash management
│   ├── use-local-media.ts        # getUserMedia hook
│   └── use-webrtc-mesh.ts        # simple-peer mesh management
├── server/
│   ├── server.ts                 # Express + loro-extended server
│   ├── config.ts                 # Server configuration
│   └── logger.ts                 # Logging setup
└── shared/
    └── types.ts                  # Shared schemas and types
```

## Key Files

### `shared/types.ts`

Defines the data model:

- `RoomSchema` - CRDT document for persistent room state
- `SignalingPresenceSchema` - Ephemeral presence for WebRTC signals

### `client/use-webrtc-mesh.ts`

The core WebRTC logic:

- Creates `simple-peer` instances for each participant
- Publishes signals via presence
- Processes incoming signals from other peers' presence
- Manages peer lifecycle (create/destroy on join/leave)

### `client/video-conference-app.tsx`

The main React component:

- Uses `useDocument` for room state
- Uses `usePresence` for signaling
- Renders video bubbles for local and remote streams

## Limitations

- **Mesh topology**: Each peer connects to every other peer. Works well for 2-5 participants, but doesn't scale beyond that.
- **No TURN server**: Uses only STUN servers, so connections may fail behind strict NATs/firewalls.
- **Browser only**: Requires a modern browser with WebRTC support.

## Dependencies

- `simple-peer` - WebRTC abstraction library
- `@loro-extended/repo` - CRDT document synchronization
- `@loro-extended/react` - React hooks for loro-extended
- `@loro-extended/adapter-sse` - SSE network adapter for server communication
- `@loro-extended/adapter-webrtc` - WebRTC data channel adapter for peer-to-peer sync

## WebRTC Data Channel Sync

The WebRTC data channel adapter enables peer-to-peer document synchronization alongside the video/audio streams. Here's how it works:

### Setup

```typescript
// main.tsx
import { WebRtcDataChannelAdapter } from "@loro-extended/adapter-webrtc"
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client"

const sseAdapter = new SseClientNetworkAdapter({ ... })
const webrtcAdapter = new WebRtcDataChannelAdapter()

const config = {
  identity: { peerId, name, type: "user" },
  adapters: [sseAdapter, webrtcAdapter], // Both adapters!
}
```

### Attaching Data Channels

When a WebRTC connection is established via simple-peer, we create a dedicated data channel for Loro sync:

```typescript
// use-peer-manager.ts
peer.on("connect", () => {
  // Create dedicated data channel for Loro sync
  const pc = peer._pc as RTCPeerConnection;
  const loroChannel = pc.createDataChannel("loro-sync", { ordered: true });
  webrtcAdapter.attachDataChannel(remotePeerId, loroChannel);
});

peer.on("close", () => {
  webrtcAdapter.detachDataChannel(remotePeerId);
});
```

### Benefits

1. **Server independence**: Once peers are connected via WebRTC, they can sync documents directly without the server
2. **Automatic deduplication**: loro-extended handles the same peer being connected via multiple adapters
3. **Seamless failover**: If SSE connection drops, WebRTC sync continues; if WebRTC drops, SSE continues
4. **Lower latency**: Direct peer-to-peer updates are faster than server round-trips
