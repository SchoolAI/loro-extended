# Storage Adapter Architecture: Discussion Summary & Recommendations

## Executive Summary

We explored how to design a flexible storage adapter system for a Loro CRDT-based application. The core tension was between keeping adapters simple ("dumb" key-value stores) versus making them sophisticated (document-aware with optimization capabilities). After analyzing use cases and Loro's capabilities, we implemented a minimal fix while preserving architectural flexibility for future enhancement.

## The Journey

### 1. Initial Problem: Documents Not Persisting

The [`Repo`](packages/repo/src/repo.ts:34) class never triggered saves to storage. We added persistence triggers on document state changes and local changes, but this revealed deeper architectural questions.

### 2. First Dead End: StorageSubsystem

We initially had a `StorageSubsystem` wrapper that:

- Added no real value (just translated between DocumentId and StorageKey)
- Made premature decisions (always called `exportSnapshot()`)
- Prevented adapter optimization

**Decision:** Removed StorageSubsystem entirely, letting Repo work directly with StorageAdapter.

### 3. The documentsFromStorage Hack

We tracked which documents came from storage to avoid re-saving them:

```typescript
private readonly documentsFromStorage = new Set<DocumentId>()
```

**Problem:** This conflated "source" with "need to save" - a document from storage might still need saving after network updates.

**Decision:** Removed this tracking, letting storage adapters handle deduplication.

### 4. Architecture Debate: Smart vs Dumb Adapters

#### Model A: "Dumb" Adapters (Automerge-style)

```typescript
// Repo decides everything
await adapter.save([documentId, "incremental", changeHash], message);
```

**Pros:**

- Simple adapter implementations
- Centralized storage strategy
- Consistent behavior

**Cons:**

- Can't optimize for specific backends
- Repo becomes complex
- No flexibility

#### Model B: "Smart" Adapters

```typescript
// Adapter decides strategy
await adapter.saveDocument(documentId, doc, change);
```

**Pros:**

- Backend-specific optimizations
- Different strategies per adapter
- Repo stays simple

**Cons:**

- Complex adapter implementations
- Inconsistent behavior
- Harder to reason about

### 5. The StorageKey Design

Initially seemed awkward that DocumentId became `string[]`:

```typescript
save(key: StorageKey, data: Uint8Array) // StorageKey = string[]
```

But this enables sophisticated storage patterns inspired by Automerge:

- `[documentId, "incremental", changeHash]` - Individual changes
- `[documentId, "snapshot", heads]` - Compacted snapshots
- `[documentId, "branch", branchId]` - Version control

**Insight:** The flexible key structure is essential for future enhancement.

### 6. Loro vs Automerge Considerations

Loro differs from Automerge in important ways:

- **Built-in export modes** (snapshot, update, shallow-snapshot)
- **Atomic Changes** instead of individual operations
- **Native update subscription** via `subscribeLocalUpdates()`

This means Loro already provides the primitives needed for sophisticated storage without replicating Automerge's complex model.

## Use Cases Analyzed

1. **Todo App (Simple)**: Just needs periodic snapshots
2. **Collaborative Editor**: Needs audit trail, incremental changes
3. **Mobile App**: Needs aggressive compaction, batching
4. **Version Control**: Never delete history, branch support
5. **Cloud Storage**: Minimize API calls, batch uploads

These revealed that different backends have fundamentally different cost models and requirements.

## Dead Ends & Lessons Learned

### Dead End 1: PersistenceCoordinator

Initially proposed a separate component to manage persistence policy. Realized this overlapped with DocHandle's existing responsibilities.

### Dead End 2: Extending DocHandle's State Machine

Considered adding save states to DocHandle's TEA architecture. Too invasive and DocHandle already manages document lifecycle well.

### Dead End 3: Premature Optimization

Almost implemented full Automerge-style incremental/snapshot system before realizing Loro's built-in capabilities made this unnecessary.

## Final Implementation

Minimal changes that preserve flexibility:

1. Removed StorageSubsystem
2. Pass sync messages directly to adapters
3. Use StorageKey as `string[]` for flexibility
4. Let adapters decide optimization strategy

## Recommendations for Future Implementation

### 1. Hybrid Approach with Context

```typescript
interface StorageContext {
  doc?: LoroDoc; // Full document (optional)
  change?: Uint8Array; // Sync message (optional)
  type?: "create" | "update" | "delete";
  priority?: "immediate" | "eventual";
}

interface StorageAdapter {
  // Required: Simple key-value operations
  save(
    key: StorageKey,
    data: Uint8Array,
    context?: StorageContext
  ): Promise<void>;
  load(key: StorageKey): Promise<Uint8Array | undefined>;

  // Optional: Declare capabilities
  capabilities?: {
    supportsBatching: boolean;
    supportsIncremental: boolean;
    preferredStrategy: "snapshot" | "incremental" | "hybrid";
  };
}
```

### 2. Storage Strategy Patterns

Create reusable strategy implementations:

- `SnapshotStrategy`: Periodic full saves
- `IncrementalStrategy`: Store each change
- `CompactingStrategy`: Automatic compaction
- `BatchingStrategy`: Group writes for efficiency

### 3. Leverage Loro's Native Capabilities

Don't reinvent what Loro provides:

- Use `export({ mode: "update" })` for incremental storage
- Use `export({ mode: "shallow-snapshot" })` for compaction
- Use `subscribeLocalUpdates()` for change streams

### 4. Keep the Default Simple

The default path should work for 80% of use cases:

```typescript
// Simple adapter just stores whatever it receives
class SimpleAdapter implements StorageAdapter {
  async save(key: StorageKey, data: Uint8Array) {
    await this.db.put(key.join("/"), data);
  }
}
```

### 5. Document the Contract Clearly

Make it explicit what adapters can expect:

- When saves are triggered (on every local change)
- What data they receive (sync messages)
- How they should use StorageKey
- That they may receive duplicate calls

## Conclusion

The current implementation is intentionally minimal but architecturally sound. It:

- ✅ Fixes the immediate persistence issue
- ✅ Preserves flexibility for future enhancement
- ✅ Doesn't over-engineer for unknown requirements
- ✅ Respects Loro's built-in capabilities

Future developers should start with use-case-driven requirements before adding complexity. The architecture supports evolution from simple snapshot storage to sophisticated incremental/compacting systems without breaking changes.

# Additional Notes from Subsequent Work

## Summary: Storage Architecture Refactoring for Loro-Extended

### What We Did

We refactored the storage system in the Repo class to properly handle document persistence and loading, addressing a critical architectural mismatch between how documents were saved and loaded.

### Key Architectural Decisions

1. **Removed Snapshot-Only Storage**: Initially, the system was trying to save documents with complex keys like `[documentId, "snapshot", versionKey]` but loading with simple keys `[documentId]`. This mismatch meant documents couldn't be loaded back from storage.

2. **Adopted Updates-Only Approach**: We aligned with Loro's operation-based CRDT architecture by:
   - Removing snapshot functionality entirely (snapshots are just an optimization/compaction feature)
   - Focusing on saving each update/operation with a unique version key: `[documentId, "update", versionKey]`
   - Using `loadRange()` to retrieve all updates for a document
   - Reconstructing documents by replaying all updates in order

3. **Created a Storage Loader Utility**: Implemented `createStorageLoader()` function that:
   - Uses `storageAdapter.loadRange([documentId])` to get all stored chunks
   - Filters and sorts updates by version key
   - Creates a new LoroDoc and applies all updates sequentially
   - Returns the fully reconstructed document

### Design Principles Followed

- **Dumb Storage Adapters**: Storage adapters remain simple key-value stores with range queries
- **Smart Repo**: The intelligence for document reconstruction lives in the Repo class
- **Operation-Based**: Aligns with Loro's CRDT model where documents are sequences of operations
- **No Required Snapshots**: Documents can be fully reconstructed from updates alone (snapshots would be an optional optimization)

### Current State

- ✅ Storage saves updates with proper versioned keys
- ✅ Documents can be loaded using `loadRange()` 
- ✅ Most tests passing (81/82)
- ⚠️ One test still failing - needs investigation of why updates aren't being properly saved/loaded in that specific case

### Future Considerations

- Snapshot functionality could be re-added as an optimization for large documents
- Compaction strategies could be implemented to merge old updates
- The version key generation could be optimized for better sorting

This refactoring ensures that the storage system properly supports Loro's operation-based architecture while maintaining clean separation between dumb storage adapters and smart orchestration logic.

# Final Solution: Frontier-Based Storage Keys

After identifying that the root cause of the failing test was a storage overwrite issue—where network and local changes could generate the same version vector, leading to data loss—we implemented a robust solution using frontiers as unique storage keys. This approach not only resolved the bug but also led to significant architectural improvements.

## How Frontier-Based Storage Works

The core of the solution is to treat storage as a log of changes, where each new entry is uniquely identified by the state of the document *before* the change was applied. This is accomplished by using the document's frontier as a storage key.

1.  **Enhanced `doc-handle-change` Event**: We modified the `doc-handle-change` event to emit both the document's current `frontier` and the new `change` object. The `frontier` represents the Lamport timestamps of the latest changes from all peers, effectively capturing the document's state at a point in time.

2.  **Frontiers as Unique Storage Keys**: Instead of using a simple version vector, which could be identical for concurrent local and remote changes, we serialize the `frontier` and use it as part of the storage key. This guarantees that every stored change gets a unique key, preventing overwrites.
    -   A **local change** is keyed by the document's frontier *before* the change is applied.
    -   A **remote change** (from the network) is also keyed by the document's frontier *before* it's merged.

3.  **Capturing All Changes**: By subscribing to the enhanced `doc-handle-change` event, the storage subsystem now reliably captures every change, whether it originates locally or from the network.

4.  **Incremental Updates**: To load a document, the storage adapter retrieves all changes and converts the frontier-keyed updates back into a version vector. Loro then efficiently reconstructs the document state by applying these incremental updates.

## Architectural Improvements

This frontier-based approach introduced several key improvements to the architecture:

-   **Decoupling of Storage and Network Sync**: By listening to a unified `doc-handle-change` event, the storage subsystem no longer needs to be tightly coupled with the network subsystem. It simply reacts to document state changes, regardless of their origin. This simplifies the logic and makes the system more modular.

-   **Guaranteed Data Integrity**: Using frontiers as storage keys eliminates race conditions and prevents data loss from overwrites. Every change is preserved, ensuring a complete and accurate history of the document.

-   **Simplified Storage Adapters**: The storage adapters can remain "dumb," focusing solely on key-value storage. All the logic for key generation (using frontiers) and document reconstruction is centralized within the Repo, adhering to the "Smart Repo, Dumb Adapters" principle.

-   **Foundation for Future Optimizations**: While the current implementation focuses on correctness, the structured, incremental nature of the stored data provides a solid foundation for future optimizations like snapshotting, compaction, and efficient version history traversal.

This solution provides a correct, robust, and architecturally sound foundation for persistence in Loro-extended, resolving the immediate issues while maintaining flexibility for future development.