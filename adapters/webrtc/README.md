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
const adapter = new WebRtcDataChannelAdapter(options?: WebRtcAdapterOptions);
```

##### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fragmentThreshold` | `number` | `204800` (200KB) | Messages larger than this are fragmented. Set to 0 to disable. |

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

## Wire Format

This adapter uses **binary CBOR encoding** (v2 wire format) with transport-layer fragmentation. This provides approximately **33% bandwidth savings** compared to JSON+base64 encoding.

### Transport Layer

All messages are prefixed with a transport layer byte:

| Prefix | Name | Description |
|--------|------|-------------|
| `0x00` | MESSAGE_COMPLETE | Complete message (not fragmented) |
| `0x01` | FRAGMENT_HEADER | Start of a fragmented batch |
| `0x02` | FRAGMENT_DATA | Fragment data chunk |

### Fragmentation

SCTP (the underlying transport for WebRTC data channels) has a message size limit of approximately 256KB. The adapter automatically fragments messages larger than the threshold (default: 200KB).

```typescript
// Custom threshold for constrained environments
const adapter = new WebRtcDataChannelAdapter({
  fragmentThreshold: 100 * 1024, // 100KB
});

// Disable fragmentation (not recommended)
const adapter = new WebRtcDataChannelAdapter({
  fragmentThreshold: 0,
});
```

### Version Compatibility

**Important**: All peers must use the same wire format version. The v2 binary format is **not compatible** with the legacy JSON format. Mixing versions will cause decode failures.

## How It Works

1. **Adapter Registration**: The adapter is registered with the Loro repo alongside other adapters (e.g., SSE for server communication)

2. **Data Channel Attachment**: When a WebRTC connection is established, you attach the data channel to the adapter. The adapter sets `binaryType = 'arraybuffer'` automatically.

3. **Channel Lifecycle**: The adapter handles data channel events:
   - `open`: Creates a Loro channel and starts the establishment handshake
   - `message`: Decodes binary CBOR and routes messages to the Loro synchronizer
   - `close`/`error`: Removes the Loro channel and cleans up the reassembler

4. **Message Encoding**: Messages are encoded as binary CBOR with transport-layer prefixes

5. **Fragmentation**: Large messages are automatically fragmented and reassembled

6. **Peer Deduplication**: If the same peer is connected via multiple adapters (e.g., SSE + WebRTC), the Loro repo handles deduplication automatically

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