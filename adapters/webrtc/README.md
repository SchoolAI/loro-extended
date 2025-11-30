# @loro-extended/adapter-webrtc

WebRTC data channel adapter for [@loro-extended/repo](../../packages/repo) - enables peer-to-peer document synchronization over WebRTC connections.

## Overview

This adapter allows you to use WebRTC data channels for Loro document synchronization. It follows a "Bring Your Own Data Channel" approach - you create and manage your own WebRTC connections (e.g., using [simple-peer](https://github.com/feross/simple-peer)), then attach the data channels to this adapter for Loro sync.

## Installation

```bash
pnpm add @loro-extended/adapter-webrtc
```

## Usage

### Basic Setup

```typescript
import { WebRtcDataChannelAdapter } from "@loro-extended/adapter-webrtc"
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client"
import { RepoProvider } from "@loro-extended/react"

// Create adapters
const sseAdapter = new SseClientNetworkAdapter({
  postUrl: "/loro/sync",
  eventSourceUrl: peerId => `/loro/events?peerId=${peerId}`,
})

const webrtcAdapter = new WebRtcDataChannelAdapter()

// Configure repo with both adapters
const config = {
  identity: {
    peerId: "your-peer-id",
    name: "User Name",
    type: "user",
  },
  adapters: [sseAdapter, webrtcAdapter],
}

// Use in React
<RepoProvider config={config}>
  <App />
</RepoProvider>
```

### Attaching Data Channels

When you establish a WebRTC connection (e.g., via simple-peer), create a dedicated data channel for Loro sync:

```typescript
import Peer from "simple-peer";

function createPeerConnection(
  remotePeerId: string,
  webrtcAdapter: WebRtcDataChannelAdapter
) {
  const peer = new Peer({
    initiator: true,
    trickle: true,
  });

  peer.on("connect", () => {
    // Create a dedicated data channel for Loro sync
    const loroChannel = peer._pc.createDataChannel("loro-sync", {
      ordered: true,
    });

    // Attach to the adapter
    webrtcAdapter.attachDataChannel(remotePeerId, loroChannel);
  });

  peer.on("close", () => {
    // Detach when connection closes
    webrtcAdapter.detachDataChannel(remotePeerId);
  });

  peer.on("error", (err) => {
    console.error("Peer error:", err);
    webrtcAdapter.detachDataChannel(remotePeerId);
  });

  return peer;
}
```

### Handling Incoming Data Channels

If the remote peer creates the data channel, handle it via the `datachannel` event:

```typescript
peer._pc.ondatachannel = (event) => {
  if (event.channel.label === "loro-sync") {
    webrtcAdapter.attachDataChannel(remotePeerId, event.channel);
  }
};
```

## API

### `WebRtcDataChannelAdapter`

#### Constructor

```typescript
const adapter = new WebRtcDataChannelAdapter();
```

#### Methods

##### `attachDataChannel(remotePeerId: PeerID, dataChannel: RTCDataChannel): () => void`

Attach a data channel for a remote peer. Creates a Loro channel when the data channel is open.

- `remotePeerId` - The stable peer ID of the remote peer
- `dataChannel` - The RTCDataChannel to use for communication
- Returns a cleanup function to detach the channel

##### `detachDataChannel(remotePeerId: PeerID): void`

Detach a data channel for a remote peer. Removes the Loro channel and cleans up event listeners.

##### `hasDataChannel(remotePeerId: PeerID): boolean`

Check if a data channel is attached for a peer.

##### `getAttachedPeerIds(): PeerID[]`

Get all peer IDs with attached data channels.

## How It Works

1. **Adapter Registration**: The adapter is registered with the Loro repo alongside other adapters (e.g., SSE for server communication)

2. **Data Channel Attachment**: When a WebRTC connection is established, you attach the data channel to the adapter

3. **Channel Lifecycle**: The adapter handles data channel events:

   - `open`: Creates a Loro channel and starts the establishment handshake
   - `message`: Deserializes and routes messages to the Loro synchronizer
   - `close`/`error`: Removes the Loro channel

4. **Message Serialization**: Messages are serialized as JSON (same format as the SSE adapter)

5. **Peer Deduplication**: If the same peer is connected via multiple adapters (e.g., SSE + WebRTC), the Loro repo handles deduplication automatically

## Multi-Adapter Architecture

This adapter is designed to work alongside other adapters. A common pattern is:

- **SSE Adapter**: For reliable server-mediated sync (works through firewalls/NAT)
- **WebRTC Adapter**: For low-latency peer-to-peer sync (when direct connection is possible)

The Loro repo automatically handles:

- Peer deduplication (same peer via multiple channels)
- Message routing to appropriate channels
- Sync state management across all channels

## License

MIT
