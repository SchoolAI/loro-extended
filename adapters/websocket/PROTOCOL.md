# loro-extended WebSocket Protocol (v2)

This document describes the native wire protocol used by `@loro-extended/adapter-websocket` for real-time document synchronization over WebSocket.

## Overview

The protocol directly transmits loro-extended `ChannelMsg` types using CBOR encoding (RFC 8949). This native protocol:

- Preserves full message semantics without translation
- Supports all loro-extended message types natively
- Handles batching at the wire level
- Uses a 6-byte frame header with Uint32 payload length
- Uses CBOR for compact binary encoding (~1KB library)
- Supports transport-layer fragmentation for large payloads

## Transport Layer

All WebSocket binary messages are wrapped with a transport-layer prefix to distinguish between complete messages and fragmented payloads.

### Transport Payload Types

| Prefix | Name | Description |
|--------|------|-------------|
| `0x00` | MESSAGE_COMPLETE | Complete message (not fragmented) |
| `0x01` | FRAGMENT_HEADER | Start of a fragmented batch |
| `0x02` | FRAGMENT_DATA | Fragment data chunk |

### Complete Message

For messages that don't exceed the fragment threshold:

```
┌──────────┬────────────────────────────────────────────────────────┐
│  Prefix  │                    Framed Message                      │
│  (0x00)  │                                                        │
│  1 byte  │              (6-byte header + CBOR payload)            │
└──────────┴────────────────────────────────────────────────────────┘
```

### Fragmented Message

For messages exceeding the fragment threshold (default: 100KB):

```
Fragment Header:
┌──────────┬──────────────────┬─────────────────┬─────────────────┐
│  Prefix  │     Batch ID     │   Fragment      │   Total Size    │
│  (0x01)  │    (8 bytes)     │   Count (4B)    │    (4 bytes)    │
└──────────┴──────────────────┴─────────────────┴─────────────────┘

Fragment Data (repeated for each chunk):
┌──────────┬──────────────────┬─────────────────┬─────────────────┐
│  Prefix  │     Batch ID     │   Index (4B)    │   Chunk Data    │
│  (0x02)  │    (8 bytes)     │   (0-based)     │   (variable)    │
└──────────┴──────────────────┴─────────────────┴─────────────────┘
```

**Fragmentation fields:**

| Field | Size | Description |
|-------|------|-------------|
| Batch ID | 8 bytes | Random identifier linking fragments |
| Fragment Count | 4 bytes | Total number of data chunks (big-endian) |
| Total Size | 4 bytes | Total payload size in bytes (big-endian) |
| Index | 4 bytes | Zero-based fragment index (big-endian) |
| Chunk Data | variable | Fragment payload bytes |

**Reassembly:**

The receiver collects all FRAGMENT_DATA chunks with matching Batch ID, orders them by index, and concatenates to reconstruct the original framed message.

## Frame Structure

Each complete message (after transport layer unwrapping) has this structure:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Header (6 bytes)                                                    │
├──────────┬──────────┬───────────────────────────────────────────────┤
│ Version  │  Flags   │           Payload Length                      │
│ (1 byte) │ (1 byte) │           (4 bytes, big-endian)               │
├──────────┴──────────┴───────────────────────────────────────────────┤
│                                                                     │
│              Payload (CBOR encoded, RFC 8949)                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Header Fields

| Field | Size | Description |
|-------|------|-------------|
| Version | 1 byte | Protocol version (`0x02` for v2) |
| Flags | 1 byte | Bit flags (see below) |
| Payload Length | 4 bytes | Big-endian length of payload (max ~4GB) |

### Flags

| Bit | Name | Description |
|-----|------|-------------|
| 0 | `BATCH` | Payload is an array of messages |
| 1 | `COMPRESSED` | Reserved for future compression support |
| 2-7 | Reserved | Must be 0 |

## Message Types

All messages have a type discriminator field `t` followed by message-specific fields.

### Connection Establishment

#### EstablishRequest (0x01)

Sent by client to initiate connection.

```typescript
{
  t: 0x01,
  id: PeerID,           // Sender's peer ID
  n?: string,           // Optional display name
  y: "user" | "bot" | "service"  // Peer type
}
```

#### EstablishResponse (0x02)

Sent by server to confirm connection.

```typescript
{
  t: 0x02,
  id: PeerID,
  n?: string,
  y: "user" | "bot" | "service"
}
```

### Document Synchronization

#### SyncRequest (0x10)

Request to synchronize a document.

```typescript
{
  t: 0x10,
  doc: string,          // Document ID
  v: Uint8Array,        // Encoded VersionVector
  bi: boolean,          // Bidirectional flag
  e?: EphemeralStore[]  // Optional ephemeral data
}
```

#### SyncResponse (0x11)

Response with document data.

```typescript
{
  t: 0x11,
  doc: string,
  tx: Transmission,     // Document data (see below)
  e?: EphemeralStore[]
}
```

#### Update (0x12)

Push document changes.

```typescript
{
  t: 0x12,
  doc: string,
  tx: Transmission
}
```

### Transmission Types

The `tx` field in SyncResponse and Update uses one of these formats:

```typescript
// Document is up-to-date
{ k: 0x00, v: Uint8Array }

// Full snapshot
{ k: 0x01, d: Uint8Array, v: Uint8Array }

// Incremental update
{ k: 0x02, d: Uint8Array, v: Uint8Array }

// Document unavailable
{ k: 0x03 }
```

Where:
- `k` is the transmission type discriminator
- `d` is the document data (Loro binary format)
- `v` is the encoded VersionVector

### Document Discovery

#### DirectoryRequest (0x20)

Request list of available documents.

```typescript
{
  t: 0x20,
  docs?: string[]  // Optional filter by document IDs
}
```

#### DirectoryResponse (0x21)

Response with document list.

```typescript
{
  t: 0x21,
  docs: string[]
}
```

#### NewDoc (0x22)

Announce new document creation.

```typescript
{
  t: 0x22,
  docs: string[]
}
```

### Document Deletion

#### DeleteRequest (0x30)

Request to delete a document.

```typescript
{
  t: 0x30,
  doc: string
}
```

#### DeleteResponse (0x31)

Deletion result.

```typescript
{
  t: 0x31,
  doc: string,
  s: "deleted" | "ignored"
}
```

### Ephemeral Data

#### Ephemeral (0x40)

Transient data (presence, cursors, etc.).

```typescript
{
  t: 0x40,
  doc: string,
  h: number,            // Hops remaining for propagation
  st: EphemeralStore[]
}
```

### Batching

#### Batch (0x50)

Multiple messages in one frame.

```typescript
{
  t: 0x50,
  m: Message[]  // Array of any message type except Batch
}
```

Alternatively, use the `BATCH` flag in the frame header to send an array of messages directly in the payload.

## Ephemeral Store Format

Ephemeral data uses this structure:

```typescript
{
  p: PeerID,      // Peer ID
  d: Uint8Array,  // Data payload
  ns: string      // Namespace (e.g., "presence", "cursors")
}
```

## VersionVector Encoding

VersionVector is a loro-crdt WASM class. It must be encoded using `versionVector.encode()` and decoded using `VersionVector.decode(bytes)`.

## Keepalive and Ready Signal

The protocol uses WebSocket text frames for keepalive and connection readiness:

- Server sends `"ready"` when connection is fully established
- Client sends `"ping"` every 30 seconds (configurable)
- Server responds with `"pong"`

Binary frames are reserved for protocol messages.

## Fragment Thresholds

| Environment | Recommended Threshold | Rationale |
|-------------|----------------------|-----------|
| AWS API Gateway | 100KB | 128KB hard limit |
| Cloudflare Workers | 500KB | 1MB limit |
| Self-hosted | 0 (disabled) | No external limits |

Default threshold: **100KB** (safe for most cloud deployments).

## Configuration

### Client

```typescript
const wsAdapter = new WsClientNetworkAdapter({
  url: "wss://api.example.com/ws",
  fragmentThreshold: 100 * 1024,  // Default: 100KB, set to 0 to disable
})
```

### Server

```typescript
const wsAdapter = new WsServerNetworkAdapter({
  fragmentThreshold: 100 * 1024,  // Default: 100KB, applies to all connections
})
```

## Example Message Flow

```
Client                                Server
  |                                     |
  |  [WebSocket Connect]                |
  |------------------------------------>|
  |                                     |
  |              "ready"                |
  |<------------------------------------|
  |                                     |
  |  [0x00 + EstablishRequest frame]    |
  |------------------------------------>|
  |                                     |
  |  [0x00 + EstablishResponse frame]   |
  |<------------------------------------|
  |                                     |
  |  [0x00 + SyncRequest frame]         |
  |------------------------------------>|
  |                                     |
  |  [Large response - fragmented]      |
  |  [0x01 + Fragment Header]           |
  |  [0x02 + Fragment 0]                |
  |  [0x02 + Fragment 1]                |
  |  [0x02 + Fragment 2]                |
  |<------------------------------------|
  |                                     |
```

## Version History

| Version | Header Size | Max Payload | Transport Layer | Notes |
|---------|-------------|-------------|-----------------|-------|
| v1 | 4 bytes | 64KB | None | **Deprecated** - Uint16 length field |
| v2 | 6 bytes | ~4GB | Byte-prefix + fragmentation | Current version |

### Breaking Changes in v2

1. **Header size**: 4 bytes → 6 bytes
2. **Payload length**: Uint16 (2 bytes) → Uint32 (4 bytes)
3. **Transport layer**: All messages now wrapped with `0x00` prefix or fragmented
4. **Version byte**: `0x01` → `0x02`

**v1 and v2 are not compatible.** Both client and server must use the same version.

## Comparison with Loro Syncing Protocol

| Feature | Native Protocol | Loro Protocol |
|---------|----------------|---------------|
| Encoding | CBOR (RFC 8949) | Custom binary |
| Library size | ~1KB gzipped | N/A |
| Message types | 12 | 7 |
| Batch support | Native | Not supported |
| Directory/Delete | Supported | Not supported |
| Bidirectional flag | Native field | Encoded in authPayload |
| Translation needed | No | Yes |
| Fragmentation | Built-in | Not supported |
| Max payload | ~4GB | Protocol-dependent |