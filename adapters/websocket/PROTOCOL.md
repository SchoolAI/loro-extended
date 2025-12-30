# loro-extended WebSocket Protocol

This document describes the native wire protocol used by `@loro-extended/adapter-websocket` for real-time document synchronization over WebSocket.

## Overview

The protocol directly transmits loro-extended `ChannelMsg` types using CBOR encoding (RFC 8949). Unlike the Loro Syncing Protocol, this native protocol:

- Preserves full message semantics without translation
- Supports all loro-extended message types natively
- Handles batching at the wire level
- Uses a simple 4-byte frame header
- Uses CBOR for compact binary encoding (~1KB library)

## Frame Structure

Each WebSocket binary message is a frame with the following structure:

```
┌─────────────────────────────────────────────────────────────┐
│ Header (4 bytes)                                            │
├─────────┬─────────┬─────────────────────────────────────────┤
│ Version │  Flags  │        Payload Length                   │
│ (1 byte)│ (1 byte)│         (2 bytes, big-endian)           │
├─────────┴─────────┴─────────────────────────────────────────┤
│                                                             │
│              Payload (CBOR encoded, RFC 8949)               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Header Fields

| Field | Size | Description |
|-------|------|-------------|
| Version | 1 byte | Protocol version (currently `0x01`) |
| Flags | 1 byte | Bit flags (see below) |
| Payload Length | 2 bytes | Big-endian length of payload (max 65535) |

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

## Keepalive

The protocol uses WebSocket text frames for keepalive:

- Client sends `"ping"` every 30 seconds (configurable)
- Server responds with `"pong"`

Binary frames are reserved for protocol messages.

## Limits

- Maximum payload size: 65535 bytes (2-byte length field)
- For larger documents, Loro's internal compression typically keeps payloads under this limit

## Example Message Flow

```
Client                                Server
  |                                     |
  |  [EstablishRequest]                 |
  |------------------------------------>|
  |                                     |
  |  [EstablishResponse]                |
  |<------------------------------------|
  |                                     |
  |  [SyncRequest doc="todo-list"]      |
  |------------------------------------>|
  |                                     |
  |  [SyncResponse snapshot]            |
  |<------------------------------------|
  |                                     |
  |  [Update incremental]               |
  |------------------------------------>|
  |                                     |
  |  [Ephemeral presence]               |
  |<----------------------------------->|
  |                                     |
```

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
