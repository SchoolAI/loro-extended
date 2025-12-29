# Loro Syncing Protocol

Copy of https://github.com/loro-dev/protocol/blob/main/protocol.md

Protocol version: 1.

It is the application's responsibility to ensure Req and Recv use the same protocol version.

This protocol is designed to be easy to implement and general-purpose, so it can be used across different languages and platforms.

It can be used for WebSocket connections as well as P2P connections such as WebRTC. It assumes that the underlying transport guarantees message integrity.

It can be used to sync Loro or Yjs documents, but it does not address collection-level synchronization.

A single connection can multiplex several rooms.

Each message includes the room ID.

Exception: the protocol also defines two out‑of‑band keepalive frames, "ping" and "pong", sent as WebSocket text frames, which do not carry magic bytes, room id, or a message envelope. See Keepalive: Ping/Pong.

## Message Format

- The first 4 bytes are magic bytes that indicate the CRDT type:
  - "%LOR": Loro Document
  - "%EPH": [Loro Ephemeral Store](https://loro.dev/docs/api/js#ephemeralstore)
  - "%EPS": Persisted Loro Ephemeral Store (marks data that should be stored server-side so new peers can hydrate immediately)
  - "%YJS": Yjs
  - "%YAW": Yjs Awareness
  - "%FLO": Flock Document
  - ...
- Followed by a `varString` room ID (maximum 128 bytes).
  - If two room IDs are the same but the CRDT types differ, they refer to different rooms.
- Followed by a byte for the message type.
- Payload, which depends on the message type.
- Message size should not exceed 256 KB.

Implementations use `%EPS` when the ephemeral payloads must survive beyond a single client session. Tagging frames with this CRDT
type tells the server to persist the latest store so that future peers can immediately download the full state instead of waiting
for another client to resend their presence data.

Note: Keepalive frames are special and bypass this envelope entirely. When the entire frame payload is exactly the text string "ping" or "pong" (WebSocket text frames), it MUST be treated as a keepalive and NOT parsed using the fields above. See Keepalive: Ping/Pong.

## Terminology

- Req (Requester): the client side of a WebSocket connection.
- Recv (Receiver): the server side of a WebSocket connection.
- varBytes: a variable-length byte array. It starts with a LEB128 uint.
- varString: a variable-length UTF-8 string. It starts with a LEB128 uint.
- varUint: LEB128 uint.

## Message Types

- 0x00: JoinRequest.
  - `varBytes` join payload (application-defined metadata such as auth/session info).
  - `varBytes` for the requester's document version.
- 0x01: JoinResponseOk.
  - `varString` permission: "read" | "write".
  - `varBytes` for the receiver's document version.
  - `varBytes` for extra metadata
- 0x02: JoinError.
  - 1-byte error code. See Errors.
  - `varString` message (human-friendly).
  - Optional: for `version_unknown`, append `varBytes` receiver version.
- 0x03: DocUpdate.
  - `varUint` N.
  - N `varBytes`.
  - 8-byte Update Batch ID appended at the end of the message, used to correlate ACKs.
- 0x04: DocUpdateFragmentHeader.
  - 8-byte ID for this batch of fragments.
  - `varUint` fragment count
  - `varUint` total payload size in bytes
- 0x05: DocUpdateFragment.
  - 8-byte ID for this batch of fragments.
  - `varUint` nth fragment.
  - `varBytes` update fragment.
- 0x06: RoomError.
- 1-byte error code. See Errors and status.
  - `varString` message (human-friendly).
  - Receiving this means the peer has been removed from the room and will not receive further messages until it rejoins.
- 0x07: Leave. Unsubscribe from the room.
- 0x08: Ack.
  - 8-byte reference ID pointing to an Update Batch ID or a Fragment ID.
  - 1-byte status. `0x00` means accepted; non-zero values follow Update Status Codes.

## Syncing Process

Req sends a `JoinRequest` to Recv.

- If Recv rejects the join payload (e.g., authentication/authorization fails), it sends `JoinError(code=0x02 auth_failed)`.
- If the join payload is accepted but the version is unknown, Recv sends `JoinError(code=0x01 version_unknown)` and includes its version.
- If the join payload is accepted, Recv sends `JoinResponseOk` with its latest known version of the document. Recv may then send the updates missing from Req through `DocUpdate` or `DocUpdateFragment` messages.

When Recv receives updates in the same room from other peers, it broadcasts them to all the other peers through `DocUpdate` or `DocUpdateFragment` messages.

When Req makes local edits on the document, it sends `DocUpdate` (with its Update Batch ID) or `DocUpdateFragment` messages to Recv. Recv MUST reply with an `Ack` referencing that Update Batch ID (or the fragment batch ID when fragments are used). A status of `0x00` confirms acceptance; non-zero statuses follow Update Status Codes. For example, if Req lacks write permission, Recv sends `Ack(status=0x03 permission_denied)` for that batch.

**WebSocket (client–server) directionality:** when Recv (the server) pushes updates to Req (the client), Req SHOULD NOT send `Ack(status=0x00)` back. The server already assumes delivery over the WebSocket. The client MAY send a non‑zero `Ack` (referencing the server’s batch ID) to report that it failed to apply the update (for example `invalid_update` or `fragment_timeout`).

If Recv forces the peer out of the room (permission change, quota enforcement, malicious behavior, etc.), it sends `RoomError`. After receiving `RoomError`, the peer MUST treat the room as closed and will not receive further messages until it rejoins.

Req sends `Leave` if it is no longer interested in updates for the target document.

### Update Fragments

It is usually not efficient to send a large document without splitting it into fragments. Some platforms, such as Cloudflare Durable Objects, also impose hard limits (for example, a maximum WebSocket message size of 1 MB in Cloudflare).

This protocol limits message size to 256 KB. Large updates must be split into fragments of up to 256 KB each. The default reassembly timeout is 10 seconds.

`Ack` messages for fragmented updates reference the 8-byte batch ID defined in `DocUpdateFragmentHeader`.

If Recv times out waiting for remaining fragments of a batch, it MUST:

- Discard all partial fragments for that batch ID.
- Send `Ack(status=0x07 fragment_timeout)` with the 8-byte batch ID so Req can resend.

Upon receiving `Ack(status=0x07 fragment_timeout)`, Req SHOULD resend the whole batch (header + all fragments) with the same or a new batch ID.

If Req (client) times out while reassembling fragments sent by Recv (server), it MAY send `Ack(status=0x07 fragment_timeout)` with that batch ID to signal the failure. Servers MAY choose to resend the batch or fall back to a snapshot/delta strategy.

## Errors and status

Two message types carry error semantics; update-level results travel in `Ack` status bytes.

### JoinError (0x02)

- Fields: 1-byte `code`, `varString message`.
- Extras: for `version_unknown` include `varBytes receiver_version`.

Codes:

- 0x00 unknown: unspecified error.
- 0x01 version_unknown: cannot interpret provided version. Extra: `receiver_version`.
- 0x02 auth_failed: authentication/authorization failed or the join payload was rejected.
- 0x7F app_error: Extra `varString app_code` (free-form, e.g., `quota_exceeded`).

### RoomError (0x06)

- Fields: 1-byte `code`, `varString message`.
- Semantics: the peer has been forcibly removed from the room (permission change, quota enforcement, malicious behavior, etc.). No further messages for the room will be delivered until it rejoins.
- Client behavior: do **not** auto-rejoin after a `RoomError` unless the code explicitly asks for it (0x01). A code of 0x01 is a hint that another peer needs you to rejoin to recover consistency (e.g., missing updates while the sender lacks your version vector). When receiving 0x01, clients SHOULD issue a single immediate `JoinRequest`; for any other code, clients MUST stay disconnected until the application chooses to rejoin.

Codes:

- 0x01 rejoin_suggested: peer requests a fresh join so both sides can reconcile state. Clients MAY auto-rejoin once.
- 0x02 evicted: explicit eviction; clients MUST NOT auto-rejoin.
- 0x7F unknown/app_error: unspecified room-level failure; treat as fatal unless the application decides otherwise.

### Update Status Codes (Ack status byte)

- 0x00 ok: update accepted.
- 0x01 unknown: unspecified failure.
- 0x03 permission_denied: requester has no write permission.
- 0x04 invalid_update: update payload is malformed or rejected.
- 0x05 payload_too_large: a single message or reassembled update exceeded limits.
- 0x06 rate_limited: sender is rate limited.
- 0x07 fragment_timeout: timed out waiting for remaining fragments (use the referenced batch ID).
- 0x7F app_error: application-defined error code; details are application-specific because `Ack` carries only the status byte.

### Local (non-message) issues

- Protocol violations may be reported to the host application via a callback and may result in closing the connection.

### Library hook (optional)

Implementations may expose `onError({ roomId, kind, code, message, app_code? })` for `join` or `room` messages and `onUpdateStatus({ roomId, refId, status })` to surface non-zero `Ack` statuses.

## Keepalive: Ping/Pong (Out‑of‑Band)

Some environments (e.g., browsers) do not expose transport‑level WebSocket ping/pong to applications. To support liveness checks and idle connection keepalive at the application layer, this protocol reserves two special frames that bypass the normal message envelope:

- Format: The entire frame payload is exactly the text `"ping"` or `"pong"` sent as WebSocket text frames (no magic bytes, no room id, no type byte, no length prefixes). Binary frames MUST NOT be used for keepalive.
- Direction: Either side MAY send `"ping"` at any time. The receiver MUST reply with `"pong"` promptly.
- Scope: Keepalive frames are connection‑scoped and MUST NOT be associated with any room. They MUST NOT be forwarded, broadcast, or delivered to application handlers as document updates.
- Parsing: A frame whose payload is exactly `"ping"` or `"pong"` MUST be handled as keepalive and MUST NOT be parsed as a protocol message.
- Rate limiting: Implementations MAY rate‑limit excessive keepalive traffic.
- Timeouts: Applications MAY use `ping`/`pong` round‑trip time to detect dead connections and reconnect.

Implementation note: On platforms that support automatic responses (e.g., Cloudflare Durable Objects), servers MAY configure an auto-response mapping `ping -> pong` to avoid waking application logic for keepalive traffic.

## Version Differences

- v1 appends an 8-byte Update Batch ID to every `DocUpdate` so peers can correlate acknowledgments.
- v1 introduces `Ack` (0x08) to positively confirm or reject updates; v0 relied on `UpdateError` messages and had no explicit success signal.
- v1 repurposes 0x06 from `UpdateError` to `RoomError`, which evicts the peer from the room until it rejoins.
- v1 shifts update status codes: `ok` is now `0x00`, `unknown` moves to `0x01`, and the remaining codes keep their numeric values from v0.
- v1 clarifies that a `RoomError` means the peer will stop receiving room traffic unless it performs a new join handshake.

## Why these changes (v1)

- Reliable delivery semantics: explicit `Ack` for each client‑originated update batch (or fragment batch) lets applications know whether a change was accepted instead of inferring success from silence; clients only emit `Ack` when a server‑originated update fails.
- Clear eviction signal: `RoomError` distinguishes "your update failed" from "you are no longer in the room", enabling clients to stop syncing and prompt rejoin or escalation.
- Better error mapping: moving `ok` to `0x00` and `unknown` to `0x01` aligns status bytes with common success/failure conventions and leaves room for app-specific errors.
- Debuggability: 64-bit batch IDs make ACK correlation collision-resistant even on long-lived, multiplexed connections while adding negligible overhead versus the 256 KiB frame limit.