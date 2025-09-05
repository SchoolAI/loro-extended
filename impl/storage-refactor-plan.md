# Storage Architecture Refactoring Plan

## Goal

Move storage responsibility from Repo to DocHandle by adding a `saveToStorage` service, making persistence explicit and testable at the DocHandle level.

## Current Architecture

### Problems

1. **Asymmetric Design**: DocHandle has `loadFromStorage` but no `saveToStorage`
2. **Implicit Persistence**: DocHandle doesn't know its changes are being saved
3. **Event-Driven Coupling**: Repo listens to DocHandle's internal events
4. **Testing Challenges**: Can't test persistence at DocHandle level in isolation

### Current Flow

```
DocHandle Change → Emits Event → Repo Listener → Storage Adapter
```

## Proposed Architecture

### Benefits

1. **Symmetric Design**: Both load and save services in DocHandleServices
2. **Explicit Persistence**: DocHandle explicitly calls saveToStorage
3. **Service-Driven**: Clean dependency injection pattern
4. **Testable**: Can mock saveToStorage service in DocHandle tests

### New Flow

```
DocHandle Change → Call saveToStorage Service → Storage Adapter
```

## Implementation Steps

### Step 1: Update DocHandleServices Interface

```typescript
export interface DocHandleServices<T extends DocContent> {
  loadFromStorage: (documentId: DocumentId) => Promise<LoroDoc<T> | null>;
  saveToStorage?: (
    documentId: DocumentId,
    doc: LoroDoc<T>,
    event: LoroEventBatch
  ) => Promise<void>;
  queryNetwork: (
    documentId: DocumentId,
    timeout: number
  ) => Promise<LoroDoc<T> | null>;
}
```

### Step 2: Add SaveToStorageCommand

```typescript
export type SaveToStorageCommand<T extends DocContent> = {
  type: "cmd-save-to-storage";
  documentId: DocumentId;
  doc: LoroDoc<T>;
  event: LoroEventBatch;
};
```

### Step 3: Update doc-handle-program.ts

- After local changes in "ready" state, emit SaveToStorageCommand
- After remote changes in "ready" state, emit SaveToStorageCommand
- After transitioning to "ready" state, emit SaveToStorageCommand for initial save

### Step 4: Update DocHandle Command Executor

```typescript
case "cmd-save-to-storage": {
  if (!this.#services.saveToStorage) {
    // Storage is optional - just log if not provided
    console.debug("No saveToStorage service provided, skipping save")
    return
  }
  await this.#services.saveToStorage(
    command.documentId,
    command.doc,
    command.event
  )
  break
}
```

### Step 5: Refactor Repo

```typescript
private createSaveToStorage<T extends DocContent>(
  documentId: DocumentId
): (documentId: DocumentId, doc: LoroDoc<T>, event: LoroEventBatch) => Promise<void> {
  return async (_, doc, event) => {
    if (event.by === "local" || event.by === "import") {
      const frontiersKey = this.frontiersToKey(event.to)
      const fromVersion = doc.frontiersToVV(event.from)
      const update = doc.export({ mode: "update", from: fromVersion })

      await this.storageAdapter.save(
        [documentId, "update", frontiersKey],
        update
      )
    }
  }
}
```

### Step 6: Update getOrCreateHandle

```typescript
const handle = new DocHandle<T>(documentId, {
  loadFromStorage: createStorageLoader<T>(this.storageAdapter),
  saveToStorage: this.createSaveToStorage<T>(documentId),
  queryNetwork: this.synchronizer.queryNetwork.bind(this.synchronizer),
});
```

### Step 7: Remove Event-Based Storage

- Remove the `doc-handle-change` listener in Repo
- Remove the storage logic from the event handler

### Step 8: Update Tests

- Add tests for saveToStorage service in DocHandle tests
- Mock saveToStorage to verify it's called correctly
- Ensure existing tests still pass

## Testing Plan

### Unit Tests

- Test DocHandle calls saveToStorage on local changes
- Test DocHandle calls saveToStorage on remote changes
- Test DocHandle handles missing saveToStorage gracefully
- Test Repo provides correct saveToStorage implementation

### Integration Tests

- Test end-to-end document persistence
- Test document loading after saves
- Test concurrent saves don't overwrite
- Test frontier-based keys remain unique

## Risks and Mitigations

### Risk 1: Performance Impact

**Mitigation**: saveToStorage is async and non-blocking

### Risk 2: Breaking Existing Code

**Mitigation**: saveToStorage is optional, existing event listeners continue to work

### Risk 3: Storage Errors

**Mitigation**: Wrap saveToStorage calls in try-catch, log errors but don't fail operations

## Success Criteria

1. ✅ DocHandleServices has symmetric load/save services
2. ✅ DocHandle explicitly calls saveToStorage
3. ✅ Storage logic is removed from Repo's event listeners
4. ✅ All existing tests pass
5. ✅ New tests verify storage behavior at DocHandle level
6. ✅ Storage remains reliable with frontier-based keys
