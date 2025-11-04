# Bug Report: Document Reconstruction from Incremental Updates Fails in Storage Adapter

This document summarizes the investigation into a flaky test, `should reconstruct document from updates alone (no snapshot)`, located in `packages/repo/src/e2e.test.ts`.

## 1. The Problem

The test intermittently failed, asserting that a document reconstructed in a new repo instance (`repo2`) from data persisted by `repo1` was empty. Specifically, `expect(root2.get("step")).toBe(2)` would fail with `expected undefined to be 2`.

This flakiness indicated a race condition or a subtle bug in the storage and synchronization layer. The test was unique in that it forced the storage adapter to reconstruct a document's state purely from a series of incremental "update" chunks, rather than a single, self-contained "snapshot".

## 2. Initial Investigation & Misdiagnoses

The investigation followed several paths based on the symptoms:

### Hypothesis 1: Premature Promise Resolution (`waitForStorage`)

- **Symptom:** The test assertion runs before the document content is available.
- **Theory:** The `handle.waitForStorage()` promise resolves as soon as the `loading.state` becomes `"found"`, but before the `doc.import()` operation completes internally.
- **Result:** This was partially correct. Adding a `setTimeout` changed the failure mode to a timeout, indicating `waitForStorage` was never resolving at all. This led to the next hypothesis.

### Hypothesis 2: Incorrect `VersionVector` Comparison

- **Symptom:** The `storage-adapter` was responding with an `"up-to-date"` message to `repo2`'s sync request, when it should have sent an `"update"`.
- **Theory:** The `VersionVector` sent from `repo2` (for an empty document) was being deserialized from a plain object incorrectly in the `storage-adapter`. This caused `requesterVV.compare(currentVersion)` to return `0` (equal), leading to the erroneous `"up-to-date"` response.
- **Result:** While the `VersionVector` reconstruction was indeed flawed and required a fix for type-safety, correcting it did not solve the underlying issue. The tests began to fail more broadly, indicating this fix exposed a deeper problem.

### Hypothesis 3: Test Timing and Async Operations

- **Symptom:** The broader test failures after the `VersionVector` fix suggested a fundamental timing issue.
- **Theory:** The test was not properly `await`ing the asynchronous save operations from `repo1`. `vi.runAllTimersAsync()` was not sufficient to flush the entire `async` promise chain within the storage adapter. As a result, `repo2` was being created and attempting to load data *before* `repo1`'s data was ever committed to the shared `InMemoryStorageAdapter`.
- **Result:** This was **correct** for the other storage tests. Adding an extra `await vi.runAllTimersAsync()` after the `change` calls fixed all storage-related tests *except* for the original flaky one.

## 3. The Root Cause: Flawed Reconstruction from Update Chunks

The final, correct diagnosis was identified by adding detailed logging to the `handleSyncRequest` method in `packages/repo/src/storage/storage-adapter.ts`.

The process is as follows:
1.  The adapter loads multiple update `chunks` from storage.
2.  It creates a new, temporary `LoroDoc` instance: `const tempDoc = new LoroDoc()`.
3.  It iterates through the chunks and imports them one-by-one: `tempDoc.import(chunk.data)`.

Logging revealed the critical flaw:

- After importing the **first** update chunk, the `tempDoc`'s version was correctly updated.
- After importing the **second** and subsequent update chunks, the `tempDoc`'s version **did not change**.

**Conclusion:** A `LoroDoc` instance created with `new LoroDoc()` does not correctly accumulate state when importing a series of "update" blobs from another peer. It appears to only apply the first update successfully. This is likely a bug or a design constraint within the `loro-crdt` library itself, where a document can only be reliably reconstructed from a full snapshot, not a sequence of partial updates.

When the `tempDoc` is not fully reconstructed, its version is incomplete. This leads to the storage adapter sending a partial update to `repo2`, causing the final assertion in the test to fail.

## 4. The Successful (But Unapplied) Fix

The most robust solution is to change the persistence strategy within the `StorageAdapter` to always save a full snapshot. This was achieved by modifying `handleSyncResponse`:

```typescript
// packages/repo/src/storage/storage-adapter.ts

private async handleSyncResponse(msg: ChannelMsg): Promise<void> {
  if (msg.type !== "channel/sync-response") return;

  const { docId, transmission } = msg;

  if (transmission.type === "update" || transmission.type === "snapshot") {
    // Reconstruct the document to get a full snapshot
    const tempDoc = new LoroDoc();
    const existingChunks = await this.loadRange([docId]);
    for (const chunk of existingChunks) {
      tempDoc.import(chunk.data);
    }
    tempDoc.import(transmission.data);

    // Save a complete snapshot for this document ID
    const snapshot = tempDoc.export({ mode: "snapshot" });
    const key: StorageKey = [docId];

    // Overwrite the existing data with the new complete snapshot
    await this.removeRange([docId]);
    await this.save(key, snapshot);
  }
}
```

This change ensures that `handleSyncRequest` always loads a single, reliable snapshot, which circumvents the bug in `LoroDoc.import()` with multiple updates. **When this change was applied locally, it fixed all failing tests.**

This fix was not committed, as the underlying issue appears to be within the `loro-crdt` dependency and should be addressed there.