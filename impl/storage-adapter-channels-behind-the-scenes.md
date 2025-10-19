# Storage Adapter: Channels Behind the Scenes

## Overview

This document outlines the implementation plan for refactoring `StorageAdapter` from a simple interface into a base class that extends `Adapter<void>`. The goal is to maintain the simple, intuitive storage API (`load()`, `save()`, etc.) while integrating with the new channel-based architecture behind the scenes.

## Problem Statement

After unifying network and storage under a common `Adapter` base class with channel-based communication, we need to:

1. **Preserve the simple storage API** - implementers shouldn't need to understand channels
2. **Integrate with channel protocol** - storage must respond to channel messages
3. **Handle protocol mismatches** - storage is imperative (call method, get result) while channels are message-based
4. **Auto-handle establishment** - storage doesn't have "connection" semantics but channels do

## Design Goals

1. **Single Responsibility**: `StorageAdapter` knows how to be a storage adapter in the channel system
2. **Simple Subclassing**: Users only implement storage operations (`load()`, `save()`, etc.)
3. **Encapsulation**: All channel complexity hidden inside base `StorageAdapter` class
4. **Backward Compatibility**: Existing storage implementations work with minimal changes

## Architecture

### Type Hierarchy

```typescript
// Base adapter (existing)
abstract class Adapter<G> {
  abstract generate(context: G): BaseChannel
  abstract init(callbacks: { addChannel, removeChannel }): void
  abstract deinit(): void
  abstract start(): void
}

// Storage adapter base class (new)
abstract class StorageAdapter extends Adapter<void> {
  // Channel management (implemented by base class)
  protected storageChannel?: Channel
  protected receive?: ReceiveFn
  
  // Storage interface (abstract - implemented by subclasses)
  abstract load(key: StorageKey): Promise<Uint8Array | undefined>
  abstract save(key: StorageKey, data: Uint8Array): Promise<void>
  abstract remove(key: StorageKey): Promise<void>
  abstract loadRange(keyPrefix: StorageKey): Promise<Chunk[]>
  abstract removeRange(keyPrefix: StorageKey): Promise<void>
}

// User implementation (example)
class LevelDBStorageAdapter extends StorageAdapter {
  // Only implements storage methods - no channel knowledge needed
  async load(key: StorageKey): Promise<Uint8Array | undefined> { ... }
  async save(key: StorageKey, data: Uint8Array): Promise<void> { ... }
  // etc.
}
```

### Key Design Decisions

#### 1. Single Channel Per Storage Adapter

**Decision**: Each `StorageAdapter` creates exactly one channel.

**Reasoning**:
- Storage is conceptually a singleton resource (one database, one filesystem, etc.)
- Unlike network adapters which may have multiple peer connections
- Simplifies implementation - no need to track multiple channels
- Matches the mental model: "this adapter talks to this storage"

**Implementation**:
```typescript
init({ addChannel, removeChannel }) {
  // Create THE channel for this storage adapter
  this.storageChannel = addChannel()
}
```

#### 2. Context Type is `void`

**Decision**: `StorageAdapter extends Adapter<void>`

**Reasoning**:
- Storage doesn't need per-channel context (only one channel)
- Configuration happens in constructor (db path, connection string, etc.)
- Keeps the type signature simple
- Alternative considered: `Adapter<StorageConfig>` - rejected as unnecessary complexity

#### 3. Auto-Handle Establishment Protocol

**Decision**: Base class automatically responds to `channel/establish-request`

**Reasoning**:
- Storage has no concept of "connection establishment"
- The channel is always "ready" from storage's perspective
- Subclasses shouldn't need to think about this protocol detail
- Establishment is purely a channel-level concern

**Implementation**:
```typescript
protected generate(): BaseChannel {
  return {
    send: async (msg: ChannelMsg) => {
      if (msg.type === "channel/establish-request") {
        // Auto-respond with establishment
        this.autoEstablish(msg)
        return
      }
      // ... handle other messages
    }
  }
}

private autoEstablish(msg: ChannelMsgEstablishRequest) {
  if (!this.receive || !this.storageChannel) return
  
  this.receive({
    type: "channel/establish-response",
    identity: { name: this.adapterId },
    responderPublishDocId: this.storageChannel.publishDocId,
  })
}
```

## Implementation Plan

### Phase 1: Core Infrastructure

#### 1.1 Update StorageAdapter Base Class

**File**: `packages/repo/src/storage/storage-adapter.ts`

**Changes**:
- Convert from interface to abstract class
- Extend `Adapter<void>`
- Implement `generate()`, `init()`, `deinit()`, `start()`
- Keep abstract methods for storage operations

**Key Methods**:

```typescript
abstract class StorageAdapter extends Adapter<void> {
  protected storageChannel?: Channel
  protected receive?: ReceiveFn
  
  // Adapter implementation
  protected generate(): BaseChannel {
    return {
      kind: "storage",
      adapterId: this.adapterId,
      send: this.handleChannelMessage.bind(this),
      start: (receive) => { this.receive = receive },
      stop: () => { this.receive = undefined },
    }
  }
  
  init({ addChannel, removeChannel }) {
    this.storageChannel = addChannel()
  }
  
  deinit() {
    // Cleanup if needed
  }
  
  start() {
    // Storage is always "ready" - nothing to do
  }
  
  // Message handling (private)
  private async handleChannelMessage(msg: ChannelMsg): Promise<void>
  private autoEstablish(msg: ChannelMsgEstablishRequest): void
  private async handleSyncRequest(msg: ChannelMsgSyncRequest): Promise<void>
  private async handleDirectoryRequest(msg: ChannelMsgDirectoryRequest): Promise<void>
  private async handleDeleteRequest(msg: ChannelMsgDeleteRequest): Promise<void>
  
  // Storage interface (abstract)
  abstract load(key: StorageKey): Promise<Uint8Array | undefined>
  abstract save(key: StorageKey, data: Uint8Array): Promise<void>
  abstract remove(key: StorageKey): Promise<void>
  abstract loadRange(keyPrefix: StorageKey): Promise<Chunk[]>
  abstract removeRange(keyPrefix: StorageKey): Promise<void>
}
```

#### 1.2 Message Translation Logic

**Responsibility**: Translate channel messages into storage operations

**Key Translations**:

1. **Sync Request → Load Operations**
```typescript
private async handleSyncRequest(msg: ChannelMsgSyncRequest): Promise<void> {
  for (const { docId, requesterDocVersion } of msg.docs) {
    try {
      // Load document data
      const data = await this.load([docId])
      
      if (data) {
        // Send sync response with data
        this.sendSyncResponse(docId, data)
      } else {
        // Send unavailable response
        this.sendUnavailable(docId)
      }
    } catch (error) {
      // Send error response
      this.sendError(docId, error)
    }
  }
}
```

2. **Directory Request → LoadRange**
```typescript
private async handleDirectoryRequest(msg: ChannelMsgDirectoryRequest): Promise<void> {
  try {
    // If specific docIds requested, check each
    if (msg.docIds) {
      const available = await this.checkDocIds(msg.docIds)
      this.sendDirectoryResponse(available)
    } else {
      // List all documents
      const chunks = await this.loadRange([])
      const docIds = chunks.map(chunk => chunk.key[0])
      this.sendDirectoryResponse(docIds)
    }
  } catch (error) {
    this.logger.error("directory request failed", { error })
  }
}
```

3. **Delete Request → Remove**
```typescript
private async handleDeleteRequest(msg: ChannelMsgDeleteRequest): Promise<void> {
  try {
    await this.remove([msg.docId])
    this.sendDeleteResponse(msg.docId, "deleted")
  } catch (error) {
    this.logger.warn("delete failed", { docId: msg.docId, error })
    this.sendDeleteResponse(msg.docId, "ignored")
  }
}
```

#### 1.3 Response Helpers

**Responsibility**: Send responses back through the channel

```typescript
private sendSyncResponse(docId: DocId, data: Uint8Array): void {
  if (!this.receive || !this.storageChannel) return
  
  this.receive({
    type: "channel/sync-response",
    docId,
    hopCount: 0,
    transmission: {
      type: "snapshot", // Storage always sends full snapshots
      data,
      version: {}, // Storage doesn't track versions
    },
  })
}

private sendUnavailable(docId: DocId): void {
  if (!this.receive || !this.storageChannel) return
  
  this.receive({
    type: "channel/sync-response",
    docId,
    hopCount: 0,
    transmission: { type: "unavailable" },
  })
}

private sendDirectoryResponse(docIds: DocId[]): void {
  if (!this.receive) return
  
  this.receive({
    type: "channel/directory-response",
    docIds,
  })
}

private sendDeleteResponse(docId: DocId, status: "deleted" | "ignored"): void {
  if (!this.receive) return
  
  this.receive({
    type: "channel/delete-response",
    docId,
    status,
  })
}
```

### Phase 2: Update Existing Implementations

#### 2.1 InMemoryStorageAdapter

**File**: `packages/repo/src/storage/in-memory-storage-adapter.ts`

**Changes**:
- Change from `implements StorageAdapter` to `extends StorageAdapter`
- Remove any channel-related code (if any)
- Ensure constructor calls `super({ adapterId: "in-memory" })`

**Before**:
```typescript
export class InMemoryStorageAdapter implements StorageAdapter {
  async load(key: StorageKey): Promise<Uint8Array | undefined> { ... }
  // etc.
}
```

**After**:
```typescript
export class InMemoryStorageAdapter extends StorageAdapter {
  constructor() {
    super({ adapterId: "in-memory", logger })
  }
  
  async load(key: StorageKey): Promise<Uint8Array | undefined> { ... }
  // etc. - no other changes needed
}
```

#### 2.2 External Storage Adapters

**Files**: 
- `packages/adapters/src/storage/level-db/server.ts`
- `packages/adapters/src/storage/indexed-db/client.ts`

**Changes**: Same pattern as InMemoryStorageAdapter

### Phase 3: Testing Strategy

#### 3.1 Unit Tests for StorageAdapter Base Class

**File**: `packages/repo/src/storage/storage-adapter.test.ts`

**Test Cases**:
1. **Channel Creation**: Verify single channel is created
2. **Auto-Establishment**: Verify automatic response to establish-request
3. **Sync Request Translation**: Verify load() is called correctly
4. **Directory Request Translation**: Verify loadRange() is called
5. **Delete Request Translation**: Verify remove() is called
6. **Error Handling**: Verify errors are translated to appropriate responses
7. **Response Formatting**: Verify responses match channel protocol

**Test Structure**:
```typescript
class MockStorageAdapter extends StorageAdapter {
  loadCalls: StorageKey[] = []
  
  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    this.loadCalls.push(key)
    return new Uint8Array([1, 2, 3])
  }
  // etc.
}

describe("StorageAdapter", () => {
  it("creates single channel on init", () => { ... })
  it("auto-responds to establishment", () => { ... })
  it("translates sync-request to load()", () => { ... })
  // etc.
})
```

#### 3.2 Integration Tests

**File**: `packages/repo/src/storage-network-sync.test.ts`

**Test Cases**:
1. **End-to-End Sync**: Verify document can be saved and loaded through channels
2. **Multiple Adapters**: Verify storage and network adapters work together
3. **Error Propagation**: Verify storage errors surface correctly

### Phase 4: Documentation

#### 4.1 Update README

**File**: `packages/repo/README.md`

**Changes**:
- Update storage adapter examples to show extending `StorageAdapter`
- Clarify that storage adapters don't need channel knowledge
- Add note about automatic establishment handling

#### 4.2 Add Migration Guide

**File**: `packages/repo/MIGRATION.md` (new)

**Content**:
- How to migrate existing storage adapters
- Before/after code examples
- Common pitfalls and solutions

## Alternatives Considered

### Alternative 1: Separate Bridge Class

**Approach**: Create `StorageAdapterBridge extends Adapter<StorageAdapter>`

**Pros**:
- Clear separation between storage interface and channel integration
- Could support multiple storage backends per bridge

**Cons**:
- Extra class adds complexity
- Users must understand two classes instead of one
- Doesn't match the mental model (storage adapter IS an adapter)

**Decision**: Rejected in favor of base class approach

### Alternative 2: Storage Adapter as Pure Interface

**Approach**: Keep `StorageAdapter` as interface, create separate channel wrapper

**Pros**:
- Maximum flexibility for implementations
- No inheritance required

**Cons**:
- Users must manually wire up channel integration
- Duplicated channel handling code across implementations
- Doesn't hide complexity as intended

**Decision**: Rejected - defeats the purpose of hiding channels

### Alternative 3: Multiple Channels Per Storage

**Approach**: Allow storage adapters to create multiple channels

**Pros**:
- More flexible for complex storage scenarios
- Could support sharding or partitioning

**Cons**:
- Adds complexity that 99% of storage adapters don't need
- Harder to reason about which channel handles which request
- Storage is conceptually singular

**Decision**: Rejected - YAGNI (You Aren't Gonna Need It)

## Resolved Design Questions

### Q1: Version Vector Handling & Incremental Storage

**Question**: Should storage track version vectors, or always send full snapshots? How do we handle incremental updates efficiently?

**Resolution**: Storage supports BOTH snapshots and incremental updates through hierarchical keys, but the base `StorageAdapter` class handles version vector logic using Loro.

**Key Insights**:

1. **Storage Implementers Don't Track Version Vectors**
   - They only implement: `load()`, `save()`, `loadRange()`, `remove()`, `removeRange()`
   - They work with opaque `Uint8Array` blobs and hierarchical `StorageKey` arrays
   - No CRDT knowledge required

2. **Base StorageAdapter Class IS Loro-Aware**
   - Uses temporary `LoroDoc` instances to reconstruct documents from storage
   - Handles version-aware exports when responding to sync requests
   - Manages the translation between channel protocol and storage operations

3. **Hierarchical Key Structure**
   ```typescript
   ["docId"]                    // Base snapshot (optional)
   ["docId", "update", "v1"]    // Incremental update 1
   ["docId", "update", "v2"]    // Incremental update 2
   ```

4. **Incremental Update Flow**
   ```typescript
   // Synchronizer saves incremental updates
   doc.subscribeLocalUpdates((updateBytes) => {
     const version = doc.oplogVersion()
     const key = [docId, "update", encodeVersion(version)]
     await storage.save(key, updateBytes)
   })
   
   // StorageAdapter reconstructs on sync request
   private async handleSyncRequest(msg: ChannelMsgSyncRequest) {
     // Load snapshot + all updates
     const snapshot = await this.load([docId, "snapshot"])
     const updates = await this.loadRange([docId, "update"])
     
     // Reconstruct in temp doc
     const tempDoc = new LoroDoc()
     if (snapshot) tempDoc.import(snapshot)
     for (const chunk of updates) {
       tempDoc.import(chunk.data)
     }
     
     // Export version-aware response
     const data = tempDoc.export({
       mode: "update",
       from: requesterDocVersion
     })
     
     this.sendSyncResponse(docId, data)
   }
   ```

5. **Periodic Compaction** (Synchronizer's responsibility)
   ```typescript
   async compactDocument(docId: DocId) {
     const snapshot = doc.export({ mode: "snapshot" })
     await storage.save([docId, "snapshot"], snapshot)
     await storage.removeRange([docId, "update"])
   }
   ```

**Rationale**:
- **Efficiency**: Incremental updates avoid rewriting entire documents
- **Simplicity**: Storage implementers work with simple key-value operations
- **Correctness**: Loro handles all version vector logic and reconciliation
- **Flexibility**: Synchronizer controls compaction strategy

**Trade-off Accepted**: The base `StorageAdapter` class depends on `loro-crdt` and creates temporary `LoroDoc` instances. This is acceptable because:
- It's a thin wrapper - just import/export operations
- Storage implementers still have a simple API
- The complexity is encapsulated in the base class
- It enables efficient incremental storage

### Q2: Batch Operations

**Question**: Should we add batch operations to the storage interface?

**Resolution**: Not in initial implementation - can add later if needed.

**Rationale**:
- YAGNI - optimize when needed
- Batch operations complicate the interface
- Can be added backward-compatibly later
- Current interface is sufficient for correctness

### Q3: Storage Initialization

**Question**: Should storage adapters have an async `initialize()` method?

**Resolution**: Use `start()` for async initialization.

**Rationale**:
- Matches existing pattern in `Adapter` base class
- `start()` is already async and called by framework
- Keeps constructor simple
- Most storage adapters can initialize synchronously anyway

### Q4: Key Encoding Strategy

**Question**: How should version information be encoded in storage keys?

**Resolution**: The synchronizer provides string representations; storage treats them as opaque.

**Implementation**:
```typescript
// In Synchronizer
function makeUpdateKey(docId: DocId, version: VersionVector): StorageKey {
  // Option 1: Use Loro's built-in encoding
  const versionStr = Buffer.from(version.encode()).toString('base64')
  return [docId, "update", versionStr]
  
  // Option 2: Simple string representation
  // const versionStr = Array.from(version.toJSON().entries())
  //   .map(([peer, counter]) => `${peer}:${counter}`)
  //   .join(',')
  // return [docId, "update", versionStr]
}
```

**Key Points**:
- Storage doesn't interpret the version string
- Keys should be sortable if possible (helps with range queries)
- Loro handles out-of-order imports anyway via `ImportStatus`

### Q5: Update Ordering

**Question**: Must storage return updates in causal order?

**Resolution**: No - Loro handles out-of-order imports automatically.

**Rationale**:
- Loro's `import()` returns `ImportStatus` with pending operations
- Simplifies storage implementation
- More robust to storage backend variations

## Success Criteria

1. ✅ Existing storage adapters work with minimal changes (extend instead of implement)
2. ✅ Storage implementers don't need to understand channels OR version vectors
3. ✅ All channel protocol messages are handled automatically by base class
4. ✅ Incremental updates work efficiently without full document rewrites
5. ✅ Base class handles version-aware sync responses using Loro
6. ✅ Tests pass for both unit and integration scenarios
7. ✅ Documentation clearly explains the new approach
8. ✅ No performance regression compared to old implementation

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Update `StorageAdapter` from interface to abstract class extending `Adapter<void>`
- [ ] Add Loro dependency to base class
- [ ] Implement channel message handling in base class
- [ ] Add auto-establishment logic
- [ ] Implement document reconstruction from snapshot + updates
- [ ] Implement version-aware sync response generation
- [ ] Add response helper methods
- [ ] Implement message translation (sync, directory, delete)

### Phase 2: Storage Key Management
- [ ] Define hierarchical key structure conventions
- [ ] Implement version encoding helpers (in synchronizer)
- [ ] Document key structure for implementers
- [ ] Add compaction strategy documentation

### Phase 3: Update Implementations
- [ ] Update `InMemoryStorageAdapter` to extend base class
- [ ] Ensure it handles hierarchical keys correctly
- [ ] Update external storage adapters (LevelDB, IndexedDB)
- [ ] Test incremental update storage/retrieval

### Phase 4: Testing
- [ ] Write unit tests for base class
- [ ] Test document reconstruction from incremental updates
- [ ] Test version-aware sync responses
- [ ] Write integration tests with real storage backends
- [ ] Test compaction scenarios
- [ ] Performance benchmarks (incremental vs. full snapshot)

### Phase 5: Documentation
- [ ] Update README with new examples
- [ ] Document hierarchical key structure
- [ ] Create migration guide
- [ ] Add examples of incremental update patterns
- [ ] Document compaction strategies
- [ ] Review and merge

## Timeline Estimate

- Phase 1 (Core Infrastructure): 6-8 hours (more complex with Loro integration)
- Phase 2 (Storage Key Management): 2-3 hours
- Phase 3 (Update Implementations): 2-3 hours
- Phase 4 (Testing): 4-5 hours (more scenarios to test)
- Phase 5 (Documentation): 2-3 hours

**Total**: 16-22 hours of focused development time

## Additional Considerations

### Performance Implications

**Incremental Updates**:
- **Pro**: Avoid rewriting entire documents on each change
- **Pro**: Faster saves (smaller data)
- **Con**: Slower loads (must reconstruct from multiple chunks)
- **Mitigation**: Periodic compaction to merge updates into snapshots

**Temporary Doc Creation**:
- **Pro**: Clean separation - no state pollution
- **Con**: Memory allocation overhead per sync request
- **Mitigation**: Reuse temp doc instances where possible, clear after use

**Compaction Strategy**:
- Compact after N updates (e.g., 100)
- Compact after total update size exceeds threshold (e.g., 1MB)
- Compact on idle (no changes for X seconds)
- Let application configure strategy

### Security Considerations

**Key Structure Exposure**:
- Storage keys may reveal version information
- Consider encryption if storage backend is untrusted
- Document security implications for implementers

**Temporary Doc Isolation**:
- Ensure temp docs don't leak between requests
- Clear sensitive data after use
- Consider memory limits for large documents