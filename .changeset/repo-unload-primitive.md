---
"@loro-extended/repo": minor
---

### New API: `Repo.unload(docId)` — evict a document from memory while retaining storage

Adds an eviction primitive that frees the in-memory (wasm-backed) `LoroDoc` and
its per-doc bookkeeping without deleting anything.

Unlike `Repo.delete(docId)`, `unload`:

- sends **no** `channel/delete-request` to any peer, and
- does **not** touch storage.

Persisted chunks survive, so calling `repo.get(docId)` again rehydrates the
document from the storage adapter via storage-first sync. Peer `subscriptions`
are intentionally left intact (stale-but-harmless; the re-get's sync-request
re-establishes them).

Use this for resource management — LRU caches, idle sweeps — where you want to
release memory without signalling that the document is gone (it isn't; it lives
on disk and on other replicas).

```typescript
await repo.unload("my-doc") // frees memory, keeps storage
const doc = repo.get("my-doc", DocSchema) // rehydrates from disk
await sync(doc).waitForSync({ kind: "storage" }) // await storage consult
```

To await rehydration after a re-get, use the existing
`sync(doc).waitForSync({ kind: "storage" })`, which resolves once storage has
been consulted (whether or not it held data) — no new wait API is needed.

**Caveat:** unloading a document with in-flight storage/network requests orphans
those queued requests; a late storage sync-response then re-creates the doc via
the snapshot path. Unload only quiescent documents.

Also adds `Synchronizer.unloadDocument(docId)` (dispatches the new
`synchronizer/doc-unload` message and clears the doc's `readyStates` entry and
namespaced ephemeral stores) and `EphemeralStoreManager.removeDoc(docId)`.
