# @loro-extended/wire-format

Binary wire format encoding/decoding for loro-extended network adapters.

## Overview

This package provides a unified encoding layer for all network transports (WebSocket, WebRTC, SSE, HTTP-Polling) with:

- **CBOR binary encoding** (RFC 8949) via [@levischuck/tiny-cbor](https://github.com/levischuck/tiny-cbor)
- **6-byte frame header** with Uint32 payload length (supports up to 4GB)
- **Compact field names** for bandwidth efficiency (~30 bytes saved per message)
- **Transport-level fragmentation** for large payloads
- **Type-safe encoding/decoding** with proper error handling

## Installation

```bash
pnpm add @loro-extended/wire-format
```

## Usage

### Basic Encoding/Decoding

```typescript
import { encodeFrame, decodeFrame, DecodeError } from "@loro-extended/wire-format"

// Encode a message
const frame = encodeFrame({
  type: "channel/sync-request",
  docId: "my-doc",
  requesterDocVersion: versionVector,
  bidirectional: true,
})

// Decode a message
try {
  const messages = decodeFrame(frame)
  for (const msg of messages) {
    console.log(msg.type)
  }
} catch (error) {
  if (error instanceof DecodeError) {
    console.error(`Decode failed: ${error.code} - ${error.message}`)
  }
}
```

### Fragmentation

For transports with size limits (WebSocket through AWS API Gateway, WebRTC SCTP, etc.), use fragmentation:

```typescript
import {
  fragmentPayload,
  FragmentReassembler,
  wrapCompleteMessage,
} from "@loro-extended/wire-format"

// Sender: Fragment large payloads
const maxSize = 100 * 1024 // 100KB per fragment
const frame = encodeFrame(msg)

if (frame.length > maxSize) {
  const fragments = fragmentPayload(frame, maxSize)
  for (const fragment of fragments) {
    send(fragment)
  }
} else {
  send(wrapCompleteMessage(frame))
}

// Receiver: Reassemble fragments
const reassembler = new FragmentReassembler({ timeoutMs: 10000 })

function onMessage(data: Uint8Array) {
  const result = reassembler.receiveRaw(data)
  
  if (result.status === "complete") {
    const messages = decodeFrame(result.data)
    process(messages)
  } else if (result.status === "error") {
    console.error("Reassembly error:", result.error)
  }
  // "pending" status means waiting for more fragments
}

// Clean up when connection closes
reassembler.dispose()
```

## Wire Format

### Frame Structure (v2)

```
┌────────────────────────────────────────────────────────────────────┐
│ Header (6 bytes)                                                   │
├──────────┬──────────┬──────────────────────────────────────────────┤
│ Version  │  Flags   │           Payload Length                     │
│ (1 byte) │ (1 byte) │           (4 bytes, big-endian)              │
├──────────┴──────────┴──────────────────────────────────────────────┤
│                    Payload (CBOR encoded)                          │
└────────────────────────────────────────────────────────────────────┘
```

- **Version**: `0x02` (v2 fixes the v1 64KB limit bug)
- **Flags**: `0x00` = single message, `0x01` = batch of messages
- **Payload Length**: Uint32 big-endian (max 4GB)

### Transport Layer Prefixes

All binary transports use a byte-prefix discriminator:

| Prefix | Type | Description |
|--------|------|-------------|
| `0x00` | MESSAGE_COMPLETE | Followed by framed CBOR message |
| `0x01` | FRAGMENT_HEADER | Followed by batchId[8] + count[4] + totalSize[4] |
| `0x02` | FRAGMENT_DATA | Followed by batchId[8] + index[4] + payload[...] |

### Compact Field Names

Messages use short field names to reduce payload size:

| Domain Field | Wire Field | Type |
|--------------|------------|------|
| `type` | `t` | Numeric enum |
| `docId` | `doc` | String |
| `requesterDocVersion` | `v` | Uint8Array |
| `bidirectional` | `bi` | Boolean |
| `transmission` | `tx` | Object |
| `ephemeral` | `e` | Array |

## API Reference

### Encoding

```typescript
// Encode without frame header (raw CBOR)
function encode(msg: ChannelMsg): Uint8Array

// Encode with 6-byte frame header
function encodeFrame(msg: ChannelMsg): Uint8Array

// Encode multiple messages as a batch
function encodeBatchFrame(msgs: ChannelMsg[]): Uint8Array
```

### Decoding

```typescript
// Decode raw CBOR (no header)
function decode(data: Uint8Array): ChannelMsg

// Decode framed message(s), returns array for batch support
function decodeFrame(frame: Uint8Array): ChannelMsg[]
```

### Fragmentation

```typescript
// Check if payload needs fragmentation
function shouldFragment(payloadSize: number, threshold: number): boolean

// Create fragments from a payload
function fragmentPayload(data: Uint8Array, maxFragmentSize: number): Uint8Array[]

// Wrap a complete message with 0x00 prefix
function wrapCompleteMessage(data: Uint8Array): Uint8Array

// Parse a transport payload (complete message or fragment)
function parseTransportPayload(data: Uint8Array): TransportPayload
```

### FragmentReassembler

```typescript
interface ReassemblerConfig {
  timeoutMs: number                  // Default: 10000 (10s)
  maxConcurrentBatches: number       // Default: 32
  maxTotalReassemblyBytes: number    // Default: 50MB
  onTimeout?: (batchId: Uint8Array) => void
  onEvicted?: (batchId: Uint8Array) => void
}

class FragmentReassembler {
  constructor(config?: Partial<ReassemblerConfig>)
  
  // Process parsed transport payload
  receive(payload: TransportPayload): ReassembleResult
  
  // Process raw bytes (parses and receives)
  receiveRaw(data: Uint8Array): ReassembleResult
  
  // Clean up timers and state
  dispose(): void
  
  // Monitoring
  readonly pendingBatchCount: number
  readonly pendingBytes: number
}

type ReassembleResult =
  | { status: "complete"; data: Uint8Array }
  | { status: "pending" }
  | { status: "error"; error: ReassembleError }
```

### Error Handling

```typescript
type DecodeErrorCode =
  | "invalid_cbor"
  | "unsupported_version"
  | "truncated_frame"
  | "missing_field"
  | "invalid_type"

class DecodeError extends Error {
  readonly code: DecodeErrorCode
  readonly cause?: unknown
}
```

## Recommended Fragment Thresholds

| Transport | Threshold | Hard Limit | Rationale |
|-----------|-----------|------------|-----------|
| WebSocket (AWS) | 100KB | 128KB | API Gateway limit |
| WebSocket (Cloudflare) | 500KB | 1MB | Workers limit |
| WebSocket (self-hosted) | 0 (disabled) | None | No proxy limits |
| WebRTC (SCTP) | 200KB | ~256KB | SCTP message limit |
| SSE POST | 80KB | 100KB | Express body-parser default |
| HTTP-Polling POST | 80KB | 100KB | Express body-parser default |

## Migration from v1

Wire format v2 is **not backward compatible**:

1. Header size changed from 4 to 6 bytes
2. Payload length field changed from Uint16 to Uint32
3. Transport layer now uses byte-prefix discriminators

**All clients and servers must upgrade together.** For mixed deployments during migration, use separate endpoints or feature flags.

## License

MIT