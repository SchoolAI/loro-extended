---
"@loro-extended/repo": minor
---

Add `waitForSync()` method with timeout and AbortSignal support

**New Features:**
- `handle.waitForSync()` - Wait for sync completion with network or storage peers
- Accepts both "loaded" (peer has data) and "absent" (peer confirmed no data) states
- Configurable timeout (default 30s, set to 0 to disable)
- AbortSignal support for cancellation
- Enriched error context in `SyncTimeoutError` and `NoAdaptersError`

**Breaking Changes:**
- None - `waitForNetwork()` and `waitForStorage()` are deprecated but still work

**Bug Fixes:**
- Fixed race condition where `waitForSync()` couldn't detect adapter kind before channels were created
- Added `kind` property to `Adapter` base class (default: "network")
- `StorageAdapter` now overrides `kind` to "storage"
- Added `channels` property to `ReadyStateAbsent` type for consistent channel checking

**Usage:**
```typescript
// Wait for network sync (default)
await handle.waitForSync()

// Wait for storage sync
await handle.waitForSync({ kind: "storage" })

// Custom timeout
await handle.waitForSync({ timeout: 5000 })

// Cancellable
const controller = new AbortController()
await handle.waitForSync({ signal: controller.signal })

// initializeIfEmpty pattern now works correctly
await handle.waitForSync()
if (handle.loroDoc.opCount() === 0) {
  initializeDocument(handle)
}
```
