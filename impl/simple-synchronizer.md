# Simplified Synchronizer Architecture

## Trenchant Observations

### Critical Architectural Smells Identified

1. **The Core Misalignment: Synchronizer vs. DocHandle Worldviews**
   The fundamental tension is that `DocHandle` correctly embraced the "always-available" nature of CRDTs, but the `Synchronizer` has not. The `Synchronizer` still operates with a "document scarcity" model, managing complex state transitions (`searching`, `syncing`), timeouts for document availability, and a central registry (`DocumentPeerRegistry`) to answer "who has what?". `DocHandle`'s design makes this entire apparatus largely redundant.

2. **Complete State Redundancy**: The current architecture maintains identical peer-document relationships in two separate systems:
   - `DocumentPeerRegistry` with `peersWithDoc`/`peersAwareOfDoc` maps
   - `DocPeerStatus` with `hasDoc`/`isAwareOfDoc` booleans
   
   This creates synchronization complexity and violates DRY principles.

3. **`SyncState` is a Ghost**: The `SyncState` in `synchronizer-program.ts` is a remnant of the "find" operation. Its states (`searching`, `syncing`) are now fully covered by the combination of `DocPeerStatus` and `ReadyState` within the `DocHandle` itself. Keeping `SyncState` creates two sources of truth for the same conceptual state.

4. **Obsolete Command Patterns**: Several commands exist purely for historical reasons:
   - `cmd-check-storage-and-respond` - Contains elaborate async waiting logic for document availability that no longer exists
   - `cmd-notify-docs-available` - Meaningless when documents are always available
   - `cmd-load-and-send-sync` - Maintains defensive patterns for non-existent problems

5. **Misnamed Abstractions**: `localDocs` contains all document state regardless of origin, making the name misleading.

6. **Computed vs Stored State**: Properties like `isLoadingFromStorage` and `isRequestingFromNetwork` are stored when they could be computed from `readyStates`.

7. **DataSource Abstraction Concerns**: The generic `request(doc: LoroDoc)` pattern would be a step backward from the current elegant, specific adapter interfaces. The right abstraction is at a coordination layer above the adapters, not forcing them into a single generic pattern.

### Opportunities for Parsimony

1. **Synchronizer Should Own DocHandles**: The current `Synchronizer` is coupled to the `Repo` via the `getDoc` service. This inversion of control is awkward. If the `Synchronizer`'s role is to manage the lifecycle and state of documents as they relate to synchronization, then it should own the state container for those documents. The `Repo` becomes a lightweight shell providing clean public API.

2. **Eliminate DocumentPeerRegistry**: All peer-document relationships can be managed within individual `DocumentState` objects, providing better locality and simpler queries.

3. **Unify Data Source Operations**: Storage and network operations follow identical request/response patterns and can be abstracted through a common coordination layer while preserving existing adapter interfaces.

4. **Remove Parallel State Systems**: The Synchronizer's state machine can be dramatically simplified by eliminating redundant tracking and relying on computed properties.

5. **Preserve TEA Benefits**: Maintain the functional core with mutative updates for observability while simplifying the state model.

6. **Re-integrate Clipped Logic**: The functions in `_clips.ts` are the "lost" logic that belongs in the `Synchronizer`'s command execution handler, acting on a simplified state model.

## Recommended Implementation Plan

### Phase 1: State Model Simplification

#### 1.1 Eliminate State Redundancy

**Remove DocumentPeerRegistry entirely** and consolidate all peer-document relationships into individual `DocumentState` objects:

```typescript
// New simplified model
type SynchronizerModel = {
  documents: Map<DocumentId, DocumentState>  // Renamed from localDocs
  peers: Map<PeerId, PeerMetadata>
  // Removed: remoteDocs, syncStates
}

type DocumentState = {
  documentId: DocumentId
  doc: LoroDoc  // Always available
  peers: Map<PeerId, DocPeerStatus>  // All peer relationships for this doc
  readyStates: Map<string, ReadyState>  // Storage/network loading states
  // Removed: computed properties like isLoadingFromStorage
}

type DocPeerStatus = {
  hasDoc: boolean
  isAwareOfDoc: boolean  
  isSyncingNow: boolean
  lastSyncTime?: Date
}
```

#### 1.2 Replace Registry Functions with Computed Queries

```typescript
// Replace DocumentPeerRegistry functions
function getPeersWithDocument(model: SynchronizerModel, documentId: DocumentId): PeerId[] {
  const docState = model.documents.get(documentId)
  return docState ? Array.from(docState.peers.entries())
    .filter(([, status]) => status.hasDoc)
    .map(([peerId]) => peerId) : []
}

function getPeersAwareOfDocument(model: SynchronizerModel, documentId: DocumentId): PeerId[] {
  const docState = model.documents.get(documentId)
  return docState ? Array.from(docState.peers.entries())
    .filter(([, status]) => status.isAwareOfDoc)
    .map(([peerId]) => peerId) : []
}

// Computed properties instead of stored state
function isLoadingFromStorage(docState: DocumentState): boolean {
  return Array.from(docState.readyStates.values()).some(
    state => state.source.type === "storage" && state.state.type === "requesting"
  )
}

function isRequestingFromNetwork(docState: DocumentState): boolean {
  return Array.from(docState.readyStates.values()).some(
    state => state.source.type === "network" && state.state.type === "requesting"
  )
}
```

### Phase 2: Command Simplification

#### 2.1 Eliminate Obsolete Commands

**Remove entirely**:
- `cmd-check-storage-and-respond` → Replace with direct synchronous response
- `cmd-notify-docs-available` → Documents are always available
- Complex timeout logic for document availability

**Simplify**:
- `cmd-load-and-send-sync` → Remove async waiting, make synchronous

#### 2.2 Introduce Unified Data Source Commands

```typescript
type Command = 
  | { type: "cmd/load-from-source"; documentId: DocumentId; sourceId: string }
  | { type: "cmd/save-to-source"; documentId: DocumentId; sourceId: string }
  | { type: "cmd/request-from-sources"; documentId: DocumentId; sourceIds: string[] }
  | { type: "cmd/send-message"; message: AddressedChannelMsg }
  | { type: "cmd/set-timeout"; documentId: DocumentId; duration: number }
  | { type: "cmd/clear-timeout"; documentId: DocumentId }
  | { type: "cmd/batch"; commands: Command[] }
```

### Phase 3: Data Source Coordination

#### 3.1 Preserve Existing Adapter Interfaces

**Do not change** the simple, elegant adapter interfaces:

```typescript
interface StorageAdapter {
  load(key: StorageKey): Promise<Uint8Array | undefined>
  save(key: StorageKey, data: Uint8Array): Promise<void>
  remove(key: StorageKey): Promise<void>
  loadRange(keyPrefix: StorageKey): Promise<Chunk[]>
  removeRange(keyPrefix: StorageKey): Promise<void>
}

interface NetworkAdapter {
  // Existing interface unchanged
}
```

#### 3.2 Create Unified Coordination Layer

```typescript
class DataSourceCoordinator {
  constructor(
    private storageAdapters: Map<string, StorageAdapter>,
    private networkAdapters: Map<string, NetworkAdapter>
  ) {}

  async loadFromStorage(documentId: DocumentId, storageId: string): Promise<Uint8Array | undefined> {
    const adapter = this.storageAdapters.get(storageId)
    if (!adapter) throw new Error(`Storage adapter ${storageId} not found`)
    
    // Use existing createStorageLoader logic from _clips.ts
    const chunks = await adapter.loadRange([documentId])
    // ... existing logic
  }
  
  async requestFromNetwork(documentId: DocumentId, timeout?: number): Promise<Uint8Array | undefined> {
    // Use existing network protocol via synchronizer's queryNetwork
    // This delegates to the synchronizer's peer-to-peer protocol
    // ... existing logic
  }
  
  async saveToStorage(documentId: DocumentId, doc: LoroDoc, event: LoroEventBatch): Promise<void> {
    // Use existing createSaveToStorage logic from _clips.ts
    // Save incremental updates based on event frontiers
    // ... existing logic
  }
}
```

### Phase 4: Re-integrate Clipped Functionality

#### 4.1 Document Lifecycle Management

Re-integrate functions from `_clips.ts` into the Synchronizer's command execution:

```typescript
// From _clips.ts - setupDocumentSubscriptions
function setupDocumentSubscriptions(docState: DocumentState, synchronizer: Synchronizer): void {
  docState.doc.subscribe(event => {
    // Handle doc changes, trigger storage saves
    if (event.by === "local" || event.by === "import") {
      synchronizer.#dispatch({
        type: "msg/document-changed",
        documentId: docState.documentId,
        event
      })
    }
  })

  docState.doc.subscribeLocalUpdates(syncMessage => {
    // Emit for network synchronization
    synchronizer.#dispatch({
      type: "msg/local-doc-change",
      documentId: docState.documentId,
      data: syncMessage
    })
  })
}

// From _clips.ts - loadFromStorage/requestFromNetwork patterns
async function executeLoadFromSource(documentId: DocumentId, sourceId: string): Promise<void> {
  const docState = this.model.documents.get(documentId)
  if (!docState) return

  // Update ready state to requesting
  docState.readyStates.set(sourceId, {
    source: { type: "storage", storageId: sourceId },
    state: { type: "requesting" }
  })

  try {
    const hadContentBefore = hasContent(docState.doc)
    await this.dataSourceCoordinator.loadFromStorage(documentId, sourceId)
    const hasNewContent = hasContent(docState.doc) && !hadContentBefore

    docState.readyStates.set(sourceId, {
      source: { type: "storage", storageId: sourceId },
      state: { type: "found", containsNewOperations: hasNewContent }
    })
  } catch (error) {
    docState.readyStates.set(sourceId, {
      source: { type: "storage", storageId: sourceId },
      state: { type: "not-found" }
    })
  }
}

// From _clips.ts - hasContent helper
function hasContent(doc: LoroDoc): boolean {
  const vv = doc.oplogVersion()
  for (const [, counter] of vv.toJSON()) {
    if (counter > 0) {
      return true
    }
  }
  return false
}
```

### Phase 5: OOP Shell for Developer Experience

#### 5.1 Functional Core, OOP Shell Pattern

```typescript
// Functional core in synchronizer-program.ts
function mutatingUpdate(msg: SynchronizerMessage, model: SynchronizerModel): Command | undefined {
  // Pure functional logic with mutative updates
  // All state changes tracked by mutative for observability
}

// OOP shell for external API - DocHandle becomes a "View"
class DocHandle<T extends DocContent> {
  // No more private state! All state queries go to the Synchronizer
  constructor(private synchronizer: Synchronizer, private documentId: DocumentId) {}
  
  get doc(): LoroDoc<T> {
    const docState = this.synchronizer.getDocumentState(this.documentId)
    return docState.doc as LoroDoc<T>
  }
  
  // Flexible readiness API delegates to Synchronizer
  async waitUntilReady(predicate: ReadinessCheck): Promise<DocHandle<T>> {
    return this.synchronizer.waitUntilReady(this.documentId, predicate)
  }
  
  async waitForStorage(): Promise<DocHandle<T>> {
    return this.waitUntilReady(readyStates =>
      readyStates.some(s => s.source.type === "storage" && s.state.type === "found")
    )
  }

  async waitForNetwork(): Promise<DocHandle<T>> {
    return this.waitUntilReady(readyStates =>
      readyStates.some(s => s.source.type === "network" && s.state.type === "found")
    )
  }

  // Peer state management delegates to Synchronizer
  getPeersWithDoc(): PeerId[] {
    const docState = this.synchronizer.getDocumentState(this.documentId)
    return Array.from(docState.peers.entries())
      .filter(([, status]) => status.hasDoc)
      .map(([peerId]) => peerId)
  }

  getPeersAwareOfDoc(): PeerId[] {
    const docState = this.synchronizer.getDocumentState(this.documentId)
    return Array.from(docState.peers.entries())
      .filter(([, status]) => status.isAwareOfDoc)
      .map(([peerId]) => peerId)
  }

  updatePeerStatus(peerId: PeerId, status: Partial<DocPeerStatus>): void {
    this.synchronizer.updateDocumentPeerStatus(this.documentId, peerId, status)
  }

  // Document mutation API
  change(mutator: LoroDocMutator<T>): DocHandle<T> {
    mutator(this.doc)
    this.doc.commit()
    return this
  }

  applySyncMessage(message: Uint8Array): void {
    this.doc.import(message)
  }
}
```

#### 5.2 Synchronizer as Document State Authority

```typescript
class Synchronizer {
  #model: SynchronizerModel
  #dataSourceCoordinator: DataSourceCoordinator
  #handles = new Map<DocumentId, DocHandle>()
  #updateFunction: (msg: SynchronizerMessage, model: SynchronizerModel) => [SynchronizerModel, Command?]

  constructor(
    storageAdapter: StorageAdapter,
    networkAdapters: NetworkAdapter[],
    options: SynchronizerOptions = {}
  ) {
    this.#dataSourceCoordinator = new DataSourceCoordinator(storageAdapter, networkAdapters)
    this.#updateFunction = createSynchronizerUpdate(
      createPermissions(options.permissions),
      options.onPatch
    )
    
    const [initialModel] = programInit()
    this.#model = initialModel
  }

  // Main entry point - replaces Repo's getDoc service
  getOrCreateHandle<T extends DocContent>(documentId: DocumentId): DocHandle<T> {
    let handle = this.#handles.get(documentId)
    if (!handle) {
      // Dispatch message to create document state in the model
      this.#dispatch({ type: "msg/document-added", documentId })
      
      handle = new DocHandle<T>(this, documentId)
      this.#handles.set(documentId, handle)
      
      // Auto-load from storage using clipped logic
      this.#executeCommand({ type: "cmd/load-from-source", documentId, sourceId: "default" })
    }
    return handle as DocHandle<T>
  }

  getDocumentState(documentId: DocumentId): DocumentState {
    const docState = this.#model.documents.get(documentId)
    if (!docState) throw new Error(`Document ${documentId} not found`)
    return docState
  }

  // Flexible readiness API for DocHandle
  async waitUntilReady<T extends DocContent>(
    documentId: DocumentId,
    predicate: ReadinessCheck
  ): Promise<DocHandle<T>> {
    const docState = this.getDocumentState(documentId)
    const handle = this.#handles.get(documentId) as DocHandle<T>
    
    // Check if already ready
    const readyStates = Array.from(docState.readyStates.values())
    if (predicate(readyStates)) return handle
    
    // Wait for state changes (implementation would use events/promises)
    // This is a simplified version - full implementation would use event emitters
    return handle
  }

  updateDocumentPeerStatus(documentId: DocumentId, peerId: PeerId, status: Partial<DocPeerStatus>): void {
    this.#dispatch({
      type: "msg/update-doc-channel-state",
      documentId,
      peerId,
      status
    })
  }

  // Network protocol methods (existing)
  addPeer(peerId: PeerId): void {
    this.#dispatch({ type: "msg/channel-added", peerId })
  }

  removePeer(peerId: PeerId): void {
    this.#dispatch({ type: "msg/channel-removed", peerId })
  }

  handleRepoMessage(message: ChannelMsg): void {
    // Existing network message handling
  }

  queryNetwork<T extends DocContent>(documentId: DocumentId, timeout = 5000): Promise<LoroDoc<T> | null> {
    // Existing network query logic
  }

  #dispatch(message: SynchronizerMessage): void {
    const [newModel, command] = this.#updateFunction(message, this.#model)
    this.#model = newModel

    if (command) {
      this.#executeCommand(command)
    }
  }

  #executeCommand(command: Command): void {
    // Enhanced command execution with clipped logic integration
    switch (command.type) {
      case "cmd/load-from-source":
        this.#executeLoadFromSource(command.documentId, command.sourceId)
        break
      case "cmd/save-to-source":
        this.#executeSaveToSource(command.documentId, command.sourceId)
        break
      // ... other commands
    }
  }

  async #executeLoadFromSource(documentId: DocumentId, sourceId: string): Promise<void> {
    // Implementation from Phase 4.1 above
  }

  async #executeSaveToSource(documentId: DocumentId, sourceId: string): Promise<void> {
    // Implementation using clipped saveToStorage logic
  }

  #ensureDocumentState(documentId: DocumentId): void {
    if (!this.#model.documents.has(documentId)) {
      const docState: DocumentState = {
        documentId,
        doc: new LoroDoc(),
        peers: new Map(),
        readyStates: new Map()
      }
      
      this.#model.documents.set(documentId, docState)
      
      // Setup document subscriptions using clipped logic
      setupDocumentSubscriptions(docState, this)
    }
  }
}
```

### Phase 6: Migration Strategy

#### 6.1 Backward Compatibility

1. **Keep existing Repo API unchanged** - `repo.get()`, `repo.delete()` work identically
2. **Preserve adapter interfaces** - No changes to StorageAdapter or NetworkAdapter

#### 6.2 Implementation Order

1. **Update synchronizer-program.ts** with new state model and simplified messages/commands
2. **Modify synchronizer.ts** to own DocHandles and use new command execution with clipped logic
3. **Update doc-handle.ts** to become a "view" that delegates to Synchronizer
4. **Update Repo** to delegate handle creation to Synchronizer (becomes lightweight shell)
5. **Create DataSourceCoordinator** to unify storage/network operations while preserving adapter interfaces
6. **Update tests** to reflect new internal structure
7. **Remove obsolete files**: `document-peer-registry.ts`, obsolete commands, move logic from `_clips.ts`

#### 6.3 New Messages and Commands

**New Messages**:
```typescript
| { type: "msg/update-doc-channel-state"; documentId: DocumentId; peerId: PeerId; status: Partial<DocPeerStatus> }
| { type: "msg/document-changed"; documentId: DocumentId; event: LoroEventBatch }
| { type: "msg/doc-channel-state-changed"; documentId: DocumentId; sourceId: string; readyState: ReadyState }
```

**Simplified Commands**:
```typescript
// Remove: cmd-check-storage-and-respond, cmd-notify-docs-available, cmd-load-and-send-sync
// Add: cmd-load-from-source, cmd-save-to-source, cmd-request-from-sources
```

### Phase 7: Testing Strategy

#### 7.1 Preserve Existing Test Coverage

- All existing integration tests should pass without modification
- Synchronizer unit tests need updates for new state model
- Add tests for new computed properties and unified data source operations

#### 7.2 New Test Categories

- Test state model simplification (no redundant state)
- Test multiple data source coordination
- Test OOP shell delegates correctly to functional core
- Test mutative patch generation for observability

## Expected Benefits

1. **Reduced Complexity**: Eliminate ~40% of synchronizer code by removing redundant state tracking
2. **Better Performance**: Remove unnecessary async waits and defensive checks
3. **Improved Maintainability**: Single source of truth for document state
4. **Enhanced Observability**: Mutative patches capture all state changes
5. **Cleaner Architecture**: Functional core with OOP shell provides best of both worlds
6. **Multiple Data Sources**: Natural support for multiple storage and network adapters
7. **Preserved DX**: Familiar DocHandle API with always-available documents

## Risk Mitigation

1. **Incremental Migration**: Implement in phases with backward compatibility
2. **Comprehensive Testing**: Maintain existing test coverage throughout migration
3. **Clear Rollback Plan**: Each phase can be reverted independently
4. **Documentation Updates**: Update architecture docs to reflect new design

This architecture eliminates the fundamental mismatch between "document scarcity" design and "document abundance" reality, creating a simpler, more maintainable system that better leverages CRDT semantics.

## Implementation Progress Notes

### ✅ Completed: waitUntilReady Implementation (2025-01-21)

**Key Learning**: The `waitUntilReady` method in `Synchronizer` uses async iteration over `DocHandle` events:

```typescript
async waitUntilReady<T extends DocContent>(
  documentId: DocumentId,
  predicate: (readyStates: ReadyState[]) => boolean,
): Promise<DocHandle<T>> {
  const docState = this.getDocumentState(documentId)
  const handle = this.#handles.get(documentId) as DocHandle<T>

  // Check if already ready
  const readyStates = Array.from(docState.readyStates.values())
  if (predicate(readyStates)) return handle

  // Wait for ready-state-changed events using async iteration
  for await (const event of handle._emitter.events("ready-state-changed")) {
    // The event contains the readyStates array directly
    if (predicate(event.readyStates)) {
      // Condition met, we're done waiting
      break
    }
  }

  return handle
}
```

**Critical Pattern**: The `for await...of` loop over `handle._emitter.events("ready-state-changed")` provides an elegant async iterator that:
1. Yields each `ready-state-changed` event as it occurs
2. Each event contains `{ readyStates: ReadyState[] }` directly in the event payload
3. No need to re-query the model state - the event contains the current ready states
4. Loop terminates when predicate returns true

**Next Steps**:
- Ensure `ready-state-changed` events are emitted from both storage and network operations
- The `#executeLoadFromSource` method should dispatch `msg-doc-channel-state-changed` after updating ready states
- Network sync operations should also emit these events when they complete