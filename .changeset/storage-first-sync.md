---
"@loro-extended/repo": minor
---

Add storage-first sync coordination and remove eager loading

**Problem:**
When a server has both network (WebSocket) and storage (LevelDB) adapters, network sync-requests were answered BEFORE storage had loaded the document data. This caused clients to incorrectly believe documents were empty, leading to duplicate initialization (e.g., two root nodes in a tree).

**Solution: Storage-First Sync + Lazy Loading**

We implemented two complementary changes:

1. **Storage-First Sync**: Network sync-requests for unknown documents now wait for all storage adapters to be consulted before responding.

2. **Lazy Loading**: Removed eager loading from `StorageAdapter`. Documents are now loaded on-demand when network clients request them, rather than all at once on startup.

**Benefits of Lazy Loading:**
- Scales to millions of documents
- Reduces startup time
- Avoids race conditions with eager loading
- Memory efficient - only loads requested documents

**How Storage-First Sync Works:**

1. When a network request arrives for an unknown document with storage adapters present:
   - Create the document with `pendingStorageChannels` tracking which storage adapters to wait for
   - Queue the network request in `pendingNetworkRequests`
   - Send sync-request to all storage adapters
   - Don't respond to network yet

2. When storage responds:
   - Remove from `pendingStorageChannels`
   - If all storage has responded, process all queued network requests

3. When storage sends a bidirectional sync-request:
   - Create the document with `pendingStorageChannels` tracking the storage channel
   - Respond to storage immediately and send reciprocal sync-request
   - Queue any network requests that arrive before storage responds with data

**Key Design Decisions:**
- No new protocol transmission types - single sync-response to network
- Wait for ALL storage adapters - any storage might have the document
- Fully synchronous - fits the TEA (The Elm Architecture) pattern
- Handles edge cases: storage disconnect, multiple network requests, etc.

**New Types:**
```typescript
type DocState = {
  // ... existing fields ...
  pendingStorageChannels?: Set<ChannelId>
  pendingNetworkRequests?: PendingNetworkRequest[]
}
```

**Files Changed:**
- `types.ts` - Added `pendingStorageChannels` and `pendingNetworkRequests` to DocState
- `storage-adapter.ts` - Removed `requestStoredDocuments()` call from `handleEstablishRequest()` (lazy loading)
- `handle-sync-request.ts` - Queue network requests when storage adapters exist; track pending state for bidirectional storage requests
- `handle-sync-response.ts` - Process pending requests when storage responds
- `handle-channel-removed.ts` - Clean up pending state on disconnect
- New utility: `get-storage-channel-ids.ts`
- New test file: `storage-first-sync.test.ts` (9 tests)
