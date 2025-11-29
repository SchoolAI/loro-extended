# Video Conference Example

A simple WebRTC-based video conference app using `simple-peer` and `loro-extended`.

## Features

- **Real-time video/audio** via WebRTC peer-to-peer connections
- **Room-based** - share a link to invite others
- **CRDT-synced participant list** - see who's in the room
- **Presence-based signaling** - WebRTC signals flow through loro-extended's ephemeral presence system
- **No WebSocket server** - uses SSE + HTTP POST for all communication

## Architecture

This example demonstrates how to use loro-extended for both:

1. **Persistent state (CRDT document)**: Room metadata and participant list
2. **Ephemeral state (typed presence)**: WebRTC signaling data (SDP offers/answers, ICE candidates)

```
┌─────────────────────────────────────────────────────────────┐
│                        Server                                │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │  Loro Repo      │  │  LevelDB        │                   │
│  │  (SSE Adapter)  │  │  Storage        │                   │
│  └────────┬────────┘  └─────────────────┘                   │
│           │                                                  │
└───────────┼──────────────────────────────────────────────────┘
            │ SSE + HTTP POST
    ┌───────┴───────┐
    │               │
┌───┴───┐       ┌───┴───┐
│Client │       │Client │
│   A   │◄─────►│   B   │  WebRTC (video/audio)
└───────┘       └───────┘
```

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
- `@loro-extended/adapters` - SSE network adapter
