---
"@loro-extended/repo": minor
---

### Added `channel/batch` message type for transport optimization

Introduced a new `channel/batch` message type that wraps multiple channel messages into a single network transmission. This enables:

- **Uniform message structure**: All message types now have a single `docId` subject (refactored `ChannelMsgSyncRequest` from multi-doc to single-doc format)
- **Heartbeat efficiency**: Reduced heartbeat messages from O(docs × peers) to O(peers) by batching ephemeral messages per peer
- **Generic batching**: Any `BatchableMsg` can be wrapped in a `channel/batch` for transport optimization

### Rate limiter behavior with batched messages

The rate limiter operates at the **network packet level** - a `channel/batch` message counts as one rate limit hit, preserving atomic all-or-nothing behavior. This means:

- A batch of 10 sync-requests counts as 1 message for rate limiting purposes
- If a batch is rate-limited, all messages in the batch are rejected together
- This matches the previous behavior where a multi-doc sync-request was atomic

### New types

- `BatchableMsg` - Union of message types that can be batched
- `ChannelMsgBatch` - Wrapper type for batched messages
- `SyncRequestDoc` - Type for docs array used by `cmd/send-sync-request`

### New command

- `cmd/broadcast-ephemeral-batch` - Sends multiple docs' ephemeral data in one batched message per peer
