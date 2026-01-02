---
"@loro-extended/repo": major
---

BREAKING: Remove deprecated `waitForNetwork()` and `waitForStorage()` methods from Handle

These methods had a critical bug: they only resolved when a peer had data (`state === "loaded"`), but would hang forever if the peer confirmed it didn't have the document (`state === "absent"`).

**Migration:**

Replace:
```typescript
await handle.waitForNetwork()
await handle.waitForStorage()
```

With:
```typescript
await handle.waitForSync({ kind: "network" })  // or just waitForSync() since network is default
await handle.waitForSync({ kind: "storage" })
```

**Benefits of `waitForSync()`:**
- Resolves when peer has data OR confirms document doesn't exist
- Enables the "initializeIfEmpty" pattern correctly
- Has configurable timeout (default 30s, set to 0 to disable)
- Supports AbortSignal for cancellation
- Throws `NoAdaptersError` if no adapters of requested kind exist
- Throws `SyncTimeoutError` on timeout with diagnostic context
