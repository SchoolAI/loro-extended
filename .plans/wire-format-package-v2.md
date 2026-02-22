# Wire Format Package Plan v2

## Status: 🟡 In Progress (Phase 2 Complete)

## Background

loro-extended currently has two parallel serialization approaches for `ChannelMsg` types:

1. **`wire-format.ts`** in `@loro-extended/adapter-websocket` - CBOR binary encoding with 4-byte framing header, compact field names (`t`, `doc`, `v`), used only by WebSocket adapter
2. **`channel-json.ts`** in `@loro-extended/repo` - JSON + selective base64 encoding for binary fields, used by SSE, HTTP-Polling, and WebRTC adapters

The WebSocket wire format has a **critical 64KB bug**: the 4-byte header uses `Uint16` for payload length, capping messages at 65535 bytes. Large document snapshots silently truncate.

Additionally, WebRTC uses `JSON.stringify(serializeChannelMsg(msg))` which inflates binary payloads by ~33% due to base64 encoding of `Uint8Array` fields.

**SSE has a payload size problem**: The video-conference example demonstrates that WebRTC signaling data (offers, answers, ICE candidates) sent via SSE POST can accumulate and exceed Express's default body-parser limit (100KB), causing `PayloadTooLargeError` and breaking user connections.

## Problem Statement

1. **64KB payload limit bug** - WebSocket's `Uint16` payload length field causes silent truncation of large documents
2. **WebRTC size inflation** - JSON+base64 encoding wastes ~33% bandwidth on binary payloads
3. **SSE POST size limit** - Large ephemeral payloads (WebRTC signals) exceed body-parser's 100KB default limit
4. **Code duplication** - Nearly identical serialization logic in two places
5. **No fragmentation** - No mechanism to split/reassemble large payloads across any transport

## Success Criteria

| Criterion | Metric |
|-----------|--------|
| 64KB bug fixed | WebSocket handles >64KB payloads correctly |
| WebRTC efficiency | Binary CBOR encoding (~33% reduction vs JSON+base64) |
| SSE large payloads | SSE POST supports >100KB payloads via fragmentation |
| Shared encoding | Single `@loro-extended/wire-format` package for all binary transports |
| Transport-agnostic fragmentation | WebRTC, SSE POST, and HTTP-Polling POST all use same fragmentation |
| Forward compatibility | Version byte preserved for future evolution |
| Compact encoding | Retain short field names (`t`, `doc`, `v`) |

## The Gap

| Capability | Current State | Target State |
|------------|--------------|--------------|
| Payload length | Uint16 (max 64KB) | Uint32 (max 4GB) |
| Header size | 4 bytes | 6 bytes |
| Shared encoding | Duplicated | Single wire-format package |
| WebRTC encoding | JSON + base64 | CBOR binary |
| SSE POST encoding | JSON | CBOR binary with fragmentation |
| SSE EventSource | JSON | JSON (unchanged, text-only transport) |
| Fragmentation | None | Byte-prefix discriminated, transport-agnostic |
| Compact names | Yes (WebSocket only) | Yes (all CBOR paths) |

## Design Decisions

### 1. Upgrade Header to 6 Bytes (Uint32 Length)

The 64KB bug is fixed by upgrading the payload length field from `Uint16` to `Uint32`:

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

Wire version increments from `1` to `2`. Old clients receiving v2 frames will reject them cleanly ("Unsupported wire version: 2").

### 2. Keep Compact Field Names (WireMessage)

The existing `ChannelMsg → WireMessage → CBOR` transformation is preserved. Compact names save ~30 bytes per message, significant for high-frequency awareness/cursor updates:

| Domain Field | Wire Field |
|--------------|------------|
| `type` | `t` (numeric enum) |
| `docId` | `doc` |
| `requesterDocVersion` | `v` |
| `bidirectional` | `bi` |
| `transmission` | `tx` |

### 3. Byte-Prefix Discriminator for Fragmentation (Not CBOR Wrapper)

Fragmentation uses a single-byte prefix, avoiding double CBOR encoding:

```typescript
const MESSAGE_COMPLETE = 0x00     // Followed by framed CBOR message
const FRAGMENT_HEADER = 0x01      // Followed by batchId(8) + count(4) + totalSize(4)
const FRAGMENT_DATA = 0x02        // Followed by batchId(8) + index(4) + data(...)
```

This keeps the framed payload as raw bytes with a type discriminator, not CBOR-in-CBOR.

### 4. Batch ID as Uint8Array (8 bytes)

The `batchId` is an 8-byte `Uint8Array`, matching the wire format exactly. This avoids encoding/decoding overhead and aligns with upstream loro-dev/protocol:

```typescript
type TransportPayload =
  | { kind: "message"; data: Uint8Array }
  | { kind: "fragment-header"; batchId: Uint8Array; count: number; totalSize: number }
  | { kind: "fragment-data"; batchId: Uint8Array; index: number; data: Uint8Array }
```

For Map key usage, convert to hex string: `batchIdToKey(id: Uint8Array): string`.

### 5. Reassembler Returns `Uint8Array | null`, Not `ChannelMsg`

The `FragmentReassembler` is transport-focused and returns raw bytes:

```typescript
type ReassembleResult = 
  | { status: "complete"; data: Uint8Array }
  | { status: "pending" }
  | { status: "error"; error: ReassembleError }

class FragmentReassembler {
  receive(payload: TransportPayload): ReassembleResult
}
```

The adapter then calls `decode(data)` to get the `ChannelMsg`. This maintains separation of concerns.

### 6. Support Concurrent Fragment Batches

The reassembler tracks multiple in-flight batches via `Map<string, BatchState>` (keyed by hex-encoded batchId):

```typescript
type BatchState = {
  batchId: Uint8Array
  expectedCount: number
  totalSize: number
  receivedFragments: Map<number, Uint8Array>
  receivedBytes: number
  startedAt: number
  timerId: unknown
}
```

This handles interleaved fragment streams and prevents one stalled batch from blocking others.

### 7. Complete Messages Pass Through During Reassembly

When `MESSAGE_COMPLETE` (0x00) arrives mid-reassembly, it's decoded and returned immediately. Fragment state is unaffected. This supports multiplexed traffic where small messages interleave with large fragmented transfers.

### 8. SSE: Binary CBOR for POST, JSON for EventSource

SSE transport has asymmetric constraints:

| Direction | Transport | Constraint | Encoding |
|-----------|-----------|------------|----------|
| Client → Server | HTTP POST | 100KB body-parser limit | Binary CBOR + fragmentation |
| Server → Client | EventSource | Text-only SSE protocol | JSON (unchanged) |

**SSE POST migrates to binary CBOR** with `Content-Type: application/octet-stream`. This enables:
- Fragmentation support for large ephemeral payloads (WebRTC signals >100KB)
- Unified fragmentation code path with WebRTC and HTTP-Polling
- ~33% size reduction for binary-heavy payloads

**SSE EventSource stays JSON** because EventSource is a text-only protocol. The server serializes via `channel-json.ts` as before.

### 9. Exceptions for Errors (No neverthrow)

Decode functions throw typed errors. Adapters use try/catch as they do today:

```typescript
export class DecodeError extends Error {
  constructor(
    public readonly code: DecodeErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = "DecodeError"
  }
}

export type DecodeErrorCode =
  | "invalid_cbor"
  | "unsupported_version"
  | "truncated_frame"
  | "missing_field"
  | "invalid_type"

function decode(data: Uint8Array): ChannelMsg  // throws DecodeError
```

This matches the existing codebase style. Result types can be revisited in a future refactor.

### 10. Version Field Preserved

The header's version byte is retained for forward compatibility. Future protocol changes can increment the version and negotiate at connection establishment.

### 11. Memory Limits on Reassembly

To prevent memory exhaustion attacks, the reassembler enforces limits:

```typescript
interface ReassemblerConfig {
  timeoutMs: number              // default: 10000
  maxConcurrentBatches: number   // default: 32
  maxTotalReassemblyBytes: number // default: 50 * 1024 * 1024 (50MB)
  onTimeout?: (batchId: Uint8Array) => void
}
```

If `maxTotalReassemblyBytes` is exceeded, the oldest batch is evicted.

## Phases

### Phase 1: Create Wire Format Package ✅

Extract and enhance wire format into shared package.

**Tasks:**

- ✅ Create `packages/wire-format/` directory structure with `package.json`
- ✅ Add `@levischuck/tiny-cbor` dependency
- ✅ Move `WireMessage` types from `adapter-websocket/wire-format.ts`
- ✅ Create `encode.ts` with `encode(msg: ChannelMsg): Uint8Array`
- ✅ Create `decode.ts` with `decode(data: Uint8Array): ChannelMsg` (throws DecodeError)
- ✅ Create `frame.ts` with 6-byte header (Uint32 length), version 2 (in encode.ts/decode.ts)
- ✅ Create `errors.ts` with `DecodeError` class and `DecodeErrorCode` type
- ✅ Write unit tests for CBOR round-trips (all 12 ChannelMsg types)
- ✅ Write unit tests for >64KB payloads (regression test for bug)
- ✅ Export all public APIs from `index.ts`

**Key Types:**

```typescript
// packages/wire-format/src/constants.ts
export const WIRE_VERSION = 2

// packages/wire-format/src/errors.ts
export type DecodeErrorCode =
  | "invalid_cbor"
  | "unsupported_version"
  | "truncated_frame"
  | "missing_field"
  | "invalid_type"

export class DecodeError extends Error {
  constructor(
    public readonly code: DecodeErrorCode,
    message: string,
    public readonly cause?: unknown
  )
}

// packages/wire-format/src/encode.ts
export function encode(msg: ChannelMsg): Uint8Array
export function encodeFrame(msg: ChannelMsg): Uint8Array  // with 6-byte header

// packages/wire-format/src/decode.ts  
export function decode(data: Uint8Array): ChannelMsg  // throws DecodeError
export function decodeFrame(frame: Uint8Array): ChannelMsg[]  // throws DecodeError
```

### Phase 2: Implement Transport Fragmentation ✅

Add fragmentation primitives for large payloads. **Follows Functional Core / Imperative Shell**: pure functions handle all data transformation; a thin stateful class manages batch tracking and timers.

**Tasks:**

- ✅ Create `fragment.ts` with byte-prefix discriminator constants and pure functions
- ✅ Implement `fragmentPayload(data: Uint8Array, maxSize: number): Uint8Array[]` (pure)
- ✅ Implement `parseTransportPayload(data: Uint8Array): TransportPayload` (pure)
- ✅ Implement `reassembleFragments(header, fragments): Uint8Array` (pure, throws on incomplete)
- ✅ Implement `generateBatchId(): Uint8Array` (pure, crypto.getRandomValues)
- ✅ Implement `batchIdToKey(id: Uint8Array): string` helper (hex encoding, pure)
- ✅ Create `reassembler.ts` with thin `FragmentReassembler` class (imperative shell)
- ✅ FragmentReassembler: manages `Map<string, BatchState>` and timer lifecycle only
- ✅ FragmentReassembler: delegates to pure `reassembleFragments()` when complete
- ✅ Implement timeout-based cleanup (configurable, default 10s)
- ✅ Implement `maxTotalReassemblyBytes` limit with LRU eviction
- ✅ Write unit tests for pure functions (fragmentPayload, reassembleFragments, parseTransportPayload)
- ✅ Write unit tests for FragmentReassembler state management
- ✅ Write unit tests for concurrent batch handling
- ✅ Write unit tests for timeout cleanup
- ✅ Write unit tests for complete message during fragment reassembly
- ✅ Write unit tests for timer edge cases (race conditions, dispose cleanup)
- ✅ Write unit tests for memory limit enforcement

**Key Types:**

```typescript
// packages/wire-format/src/fragment.ts
export const MESSAGE_COMPLETE = 0x00
export const FRAGMENT_HEADER = 0x01
export const FRAGMENT_DATA = 0x02

export type TransportPayload =
  | { kind: "message"; data: Uint8Array }
  | { kind: "fragment-header"; batchId: Uint8Array; count: number; totalSize: number }
  | { kind: "fragment-data"; batchId: Uint8Array; index: number; data: Uint8Array }

// Pure functions (functional core)
export function fragmentPayload(data: Uint8Array, maxFragmentSize: number): Uint8Array[]
export function parseTransportPayload(data: Uint8Array): TransportPayload
export function generateBatchId(): Uint8Array  // 8 random bytes
export function batchIdToKey(id: Uint8Array): string

// Pure reassembly (throws if fragments incomplete or corrupted)
export function reassembleFragments(
  header: TransportPayload & { kind: "fragment-header" },
  fragments: Map<number, Uint8Array>
): Uint8Array

// packages/wire-format/src/reassembler.ts
// Imperative shell: thin stateful class that manages batch state and timers
// Delegates to pure reassembleFragments() when all fragments received

export type ReassembleResult =
  | { status: "complete"; data: Uint8Array }
  | { status: "pending" }
  | { status: "error"; error: ReassembleError }

export type ReassembleError =
  | { type: "duplicate_fragment"; batchId: Uint8Array; index: number }
  | { type: "invalid_index"; batchId: Uint8Array; index: number; max: number }
  | { type: "timeout"; batchId: Uint8Array }
  | { type: "size_mismatch"; expected: number; actual: number }
  | { type: "evicted"; batchId: Uint8Array }

export interface ReassemblerConfig {
  timeoutMs: number                  // default: 10000
  maxConcurrentBatches: number       // default: 32
  maxTotalReassemblyBytes: number    // default: 50MB
  onTimeout?: (batchId: Uint8Array) => void
  onEvicted?: (batchId: Uint8Array) => void
}

export interface TimerAPI {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
}

/**
 * Imperative shell for fragment reassembly.
 * 
 * Responsibilities (stateful):
 * - Track in-flight batches via Map<string, BatchState>
 * - Manage timeout timers per batch
 * - Enforce memory limits (evict oldest batch when exceeded)
 * 
 * Delegates to (pure):
 * - reassembleFragments() when all fragments received
 * - batchIdToKey() for Map key conversion
 */
export class FragmentReassembler {
  constructor(config?: Partial<ReassemblerConfig>, timer?: TimerAPI)
  receive(payload: TransportPayload): ReassembleResult
  dispose(): void
}
```

### Phase 3: Migrate WebSocket Adapter 🔴

Update WebSocket adapter to use wire-format package with v2 framing.

**Tasks:**

- 🔴 Add `@loro-extended/wire-format` dependency to `adapter-websocket`
- 🔴 Replace inline `wire-format.ts` with imports from package
- 🔴 Update `encodeFrame` calls to use 6-byte header (WIRE_VERSION=2)
- 🔴 Update `decodeFrame` calls (same try/catch pattern, new import)
- 🔴 Optionally add `FragmentReassembler` for future large payload support
- 🔴 Remove `adapters/websocket/src/wire-format.ts` (now in package)
- 🔴 Update `PROTOCOL.md` to document v2 wire format
- 🔴 Run existing tests, update assertions for new header size
- 🔴 Add regression test for >64KB payload

### Phase 4: Migrate WebRTC Adapter 🔴

Update WebRTC adapter to use binary CBOR encoding with fragmentation.

**Tasks:**

- 🔴 Add `@loro-extended/wire-format` dependency to `adapter-webrtc`
- 🔴 Set `dataChannel.binaryType = 'arraybuffer'`
- 🔴 Replace `JSON.stringify(serializeChannelMsg(msg))` with `encodeFrame(msg)`
- 🔴 Add `FragmentReassembler` instance per data channel
- 🔴 Fragment payloads >200KB (safety margin below SCTP 256KB limit)
- 🔴 Handle `MESSAGE_COMPLETE` vs fragment payloads in receive path
- 🔴 Document peer version requirements (all peers must use v2)
- 🔴 Update README.md to document binary transport
- 🔴 Write integration test for binary encoding
- 🔴 Write integration test for >256KB payload fragmentation

### Phase 5: Migrate SSE Adapter (POST to Binary) 🔴

Update SSE adapter: POST uses binary CBOR with fragmentation, EventSource stays JSON.

**Tasks:**

- 🔴 Add `@loro-extended/wire-format` dependency to `adapter-sse`
- 🔴 Client: Replace `JSON.stringify(serializeChannelMsg(msg))` with binary CBOR
- 🔴 Client: Set `Content-Type: application/octet-stream` for POST
- 🔴 Client: Add fragmentation for payloads >80KB (safety margin below 100KB)
- 🔴 Client: Add `FragmentReassembler` (not needed for POST, but for symmetry if server responds with fragments)
- 🔴 Server (express-router): Add `express.raw()` middleware for binary POST body
- 🔴 Server (express-router): Detect content-type, decode binary or JSON accordingly
- 🔴 Server (express-router): Add `FragmentReassembler` per connection for large POST payloads
- 🔴 Server (express-router): Keep JSON for EventSource responses (unchanged)
- 🔴 Update README.md to document binary POST transport
- 🔴 Write integration test for >100KB ephemeral payload via SSE POST
- 🔴 Test video-conference example with large WebRTC signal payloads

### Phase 6: Update HTTP-Polling Adapter (Binary POST) 🔴

HTTP-Polling uses binary CBOR for POST with fragmentation, keeps JSON for GET response.

**Tasks:**

- 🔴 Add `@loro-extended/wire-format` dependency to `adapter-http-polling`
- 🔴 Client POST: Use binary CBOR with `Content-Type: application/octet-stream`
- 🔴 Client POST: Add fragmentation for large payloads
- 🔴 Server: Add `express.raw()` middleware for binary POST
- 🔴 Server: Detect content-type, decode accordingly
- 🔴 Server: Add `FragmentReassembler` per connection
- 🔴 Keep JSON response for GET (simpler client handling, no size limits on response)
- 🔴 Update documentation

### Phase 7: Documentation and Cleanup 🔴

Finalize documentation and deprecate old exports.

**Tasks:**

- 🔴 Update root TECHNICAL.md with wire format architecture section
- 🔴 Create README.md for wire-format package
- 🔴 Document deployment requirements for v1→v2 migration in PROTOCOL.md
- 🔴 Update examples if any directly import from adapter wire-format
- 🔴 Add `@deprecated` JSDoc to `serializeChannelMsg` and `deserializeChannelMsg`
- 🔴 Point deprecation to `@loro-extended/wire-format` for binary transports
- 🔴 Note: `channel-json.ts` still used internally by SSE EventSource (server→client)

## Unit and Integration Tests

### Unit Tests (wire-format package)

1. **CBOR encoding**: Round-trip all 12 `ChannelMsg` types through `encode`/`decode`
2. **Frame encoding**: 6-byte header with correct version, flags, length
3. **Large payload**: >64KB payload encodes/decodes correctly (regression)
4. **DecodeError**: Malformed input throws `DecodeError` with correct code
5. **Fragment split**: `fragmentPayload` creates correct prefix bytes and batch structure
6. **Fragment reassemble**: `FragmentReassembler` reconstructs original data
7. **Concurrent batches**: Multiple in-flight batches tracked correctly
8. **Timeout cleanup**: Stale batches cleaned up, callback invoked
9. **Complete message mid-reassembly**: Returns immediately without affecting fragment state
10. **Timer edge cases**: Race conditions (timer fires after complete), re-entrancy, dispose cleanup
11. **Memory limits**: `maxTotalReassemblyBytes` enforced, oldest batch evicted

### Integration Tests (adapter layer)

1. **WebSocket >64KB**: Client sends 100KB document, server receives correctly
2. **WebRTC binary**: Two peers sync via binary CBOR (no JSON)
3. **WebRTC fragmentation**: 500KB document splits and reassembles over WebRTC
4. **SSE POST >100KB**: Client sends 150KB ephemeral payload, server receives via fragmentation
5. **SSE EventSource**: Server sends JSON, client receives correctly (unchanged behavior)
6. **HTTP-Polling binary**: Client sends binary POST, server decodes correctly
7. **Version mismatch**: v1 client receives v2 frame, gets clean error
8. **video-conference**: Large WebRTC signal payloads no longer cause PayloadTooLargeError

## Transitive Effect Analysis

### Direct Dependencies

```
@loro-extended/wire-format (new)
├── @levischuck/tiny-cbor
└── loro-crdt (for VersionVector)

@loro-extended/adapter-websocket
├── @loro-extended/wire-format (new)
└── @loro-extended/repo

@loro-extended/adapter-webrtc
├── @loro-extended/wire-format (new)
└── @loro-extended/repo

@loro-extended/adapter-sse
├── @loro-extended/wire-format (new, for POST)
└── @loro-extended/repo (for EventSource JSON)

@loro-extended/adapter-http-polling
├── @loro-extended/wire-format (new)
└── @loro-extended/repo
```

### Transitive Effects

1. **Wire format v2 breaking change**: WebSocket clients and servers must upgrade together. V1 clients will reject v2 frames with "Unsupported wire version: 2". Document deployment strategy: coordinated rollout required.

2. **WebRTC binary breaking change**: All peers in a session must run the same adapter version. Old clients expecting JSON will fail to parse binary frames.

3. **SSE POST breaking change**: SSE clients sending binary CBOR require updated server. Old servers expecting JSON POST will fail. Coordinated deployment required.

4. **SSE EventSource unchanged**: Server→client direction stays JSON. No client changes needed for receiving.

5. **HTTP-Polling breaking change**: Similar to SSE, binary POST requires updated server.

6. **Examples**: All examples using WebSocket, WebRTC, SSE, or HTTP-Polling need testing after migration.

7. **External consumers**: Anyone directly using `encodeFrame`/`decodeFrame` from `adapter-websocket` or `serializeChannelMsg`/`deserializeChannelMsg` from `repo` must update.

8. **video-conference fix**: Large WebRTC signal payloads via SSE POST will now work correctly.

## Resources for Implementation

### Files to Read

- `adapters/websocket/src/wire-format.ts` - Current implementation to extract
- `adapters/websocket/src/__tests__/wire-format.test.ts` - Tests to migrate
- `adapters/websocket/PROTOCOL.md` - Protocol documentation to update
- `adapters/sse/src/client.ts` - SSE client POST implementation
- `adapters/sse/src/express-router.ts` - SSE server implementation
- `packages/repo/src/channel-json.ts` - JSON serialization (keep for EventSource)
- `packages/repo/src/channel.ts` - ChannelMsg type definitions
- `adapters/websocket-compat/PROTOCOL.md` - Upstream protocol with fragmentation reference
- `examples/video-conference/src/client/hooks/signal-accumulation.test.ts` - PayloadTooLargeError demonstration

### External References

- [loro-dev/protocol](https://github.com/loro-dev/protocol) - Upstream fragmentation design
- [RFC 8949 - CBOR](https://datatracker.ietf.org/doc/html/rfc8949) - CBOR specification
- [@levischuck/tiny-cbor](https://github.com/levischuck/tiny-cbor) - CBOR library

## Documentation Updates

### PROTOCOL.md (adapters/websocket)

Update frame structure documentation:

```markdown
## Frame Structure (v2)

┌────────────────────────────────────────────────────────────────────┐
│ Header (6 bytes)                                                   │
├──────────┬──────────┬──────────────────────────────────────────────┤
│ Version  │  Flags   │           Payload Length                     │
│ (1 byte) │ (1 byte) │           (4 bytes, big-endian)              │
└──────────┴──────────┴──────────────────────────────────────────────┘

### Changes from v1
- Header size: 4 bytes → 6 bytes
- Payload length: Uint16 (max 64KB) → Uint32 (max 4GB)
- Version: 0x01 → 0x02

### Deployment
Wire format v2 is not backward compatible. Clients and servers must upgrade together.
```

### TECHNICAL.md (root)

Add wire format architecture section:

```markdown
## Wire Format Architecture

The `@loro-extended/wire-format` package provides unified binary encoding for network adapters.

### Encoding Pipeline

ChannelMsg → WireMessage (compact names) → CBOR → Frame (6-byte header)

### Transport Fragmentation

For transports with size limits, payloads are fragmented using byte-prefix discriminators:

- 0x00: Complete message (followed by framed CBOR)
- 0x01: Fragment header (batchId[8], count[4], totalSize[4])
- 0x02: Fragment data (batchId[8], index[4], payload[...])

`FragmentReassembler` is a stateful class that:
- Tracks concurrent batches via Map<string, BatchState>
- Handles timeout cleanup (default 10s)
- Enforces memory limits (default 50MB total)
- Supports complete messages interleaved with fragments

### Transport-Specific Limits

| Transport | Direction | Encoding | Fragment Threshold |
|-----------|-----------|----------|-------------------|
| WebSocket | Both | Binary CBOR | Optional (no hard limit) |
| WebRTC | Both | Binary CBOR | 200KB (SCTP 256KB limit) |
| SSE | POST (client→server) | Binary CBOR | 80KB (body-parser 100KB default) |
| SSE | EventSource (server→client) | JSON | N/A (no fragmentation) |
| HTTP-Polling | POST | Binary CBOR | 80KB |
| HTTP-Polling | GET response | JSON | N/A |

### SSE Asymmetric Encoding

SSE uses different encodings per direction:
- **POST (client→server)**: Binary CBOR with fragmentation for large ephemeral payloads
- **EventSource (server→client)**: JSON via `channel-json.ts` (text-only SSE protocol constraint)
```

### README.md (packages/wire-format)

New package README documenting public API, usage examples, and migration guide.

## Changeset

```markdown
---
"@loro-extended/wire-format": minor
"@loro-extended/adapter-websocket": major
"@loro-extended/adapter-webrtc": major
"@loro-extended/adapter-sse": major
"@loro-extended/adapter-http-polling": major
"@loro-extended/repo": minor
---

feat: Extract shared wire format package with transport-agnostic fragmentation

## @loro-extended/wire-format (new)
- Unified CBOR encoding/decoding for network adapters
- 6-byte frame header with Uint32 payload length (fixes 64KB bug)
- Transport-level fragmentation via byte-prefix discriminators
- Memory-limited reassembly with timeout cleanup

## @loro-extended/adapter-websocket
- BREAKING: Wire format v2 (6-byte header, incompatible with v1 clients)
- Now uses @loro-extended/wire-format package
- Requires coordinated client/server deployment

## @loro-extended/adapter-webrtc
- BREAKING: Binary CBOR encoding instead of JSON+base64 (~33% smaller)
- BREAKING: Requires `binaryType = 'arraybuffer'` on data channels
- BREAKING: All peers in session must use same adapter version
- Fragmentation support for payloads >200KB

## @loro-extended/adapter-sse
- BREAKING: POST requests now use binary CBOR (`application/octet-stream`)
- BREAKING: Server must handle binary POST body (updated express-router)
- Fragmentation support for large ephemeral payloads (fixes PayloadTooLargeError)
- EventSource responses remain JSON (unchanged)
- Requires coordinated client/server deployment

## @loro-extended/adapter-http-polling
- BREAKING: POST requests now use binary CBOR
- Fragmentation support for large payloads
- GET responses remain JSON

## @loro-extended/repo
- Deprecated: `serializeChannelMsg`, `deserializeChannelMsg` (use wire-format for binary transports)
- Note: `channel-json.ts` still used internally by SSE EventSource
```
