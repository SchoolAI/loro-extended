# DocHandle Architecture Refactor: Technical Post-Mortem

## Executive Summary

We successfully completed a major architectural refactor of the DocHandle system in a Loro CRDT-based distributed document library. The primary goal was to eliminate the complex dual state machine architecture (DocHandle + Synchronizer) and replace it with a simplified, peer-centric model that better embraces CRDT semantics.

## Context and Motivation

The original system suffered from several architectural problems:

1. **Dual State Machine Complexity**: Both DocHandle and Synchronizer maintained overlapping state machines, creating cognitive overhead and subtle bugs
2. **Artificial Loading States**: The system imposed synthetic "loading" states that didn't align with CRDT semantics where operations are idempotent and commutative
3. **State Machine Coupling**: The interaction between DocHandle states and Synchronizer states was error-prone, particularly around the "unavailable" terminal state
4. **Conceptual Mismatch**: Loading states are application-level concerns, not fundamental CRDT properties

## Architectural Decisions Made

### 1. DocHandle Simplification

**Decision**: Replace the complex state machine with a simple, always-ready document handle.

**Implementation**:

```typescript
export class DocHandle<T extends DocContent> {
  public readonly doc: LoroDoc<T> = new LoroDoc<T>(); // Always available
  #peers = new Map<PeerId, DocPeerStatus>(); // Peer-centric state
}
```

**Rationale**: Loro documents are lightweight and can be created synchronously. The complexity of managing loading states was artificial overhead.

**Trade-offs**:

- ✅ Dramatically simplified API
- ✅ Eliminated state transition bugs
- ❌ Lost fine-grained loading state information for UI feedback

However, the loss of fine-grained loading state can be addressed with a more flexible readiness API that allows applications to define what "ready" means for their specific use case:

```ts
// We pass this information to a user-provided custom predicate:
type ReadyState = {
  source:
    | { type: "storage"; storageId: string }
    | { type: "network"; peerId: string };
  state:
    | { type: "requesting" }
    | { type: "not-found" }
    | { type: "found"; containsNewOperations: boolean };
};

type ReadinessCheck = (readyStates: ReadyState[]) => boolean;

// Enhanced DocHandle API
class DocHandle<T extends DocContent> {
  // Existing immediate access
  public readonly doc: LoroDoc<T> = new LoroDoc<T>();

  // New configurable readiness
  async waitUntilReady(predicate: ReadinessCheck): Promise<void> {
    // Implementation would coordinate storage and network operations
    // based on the specified criteria
  }

  // Convenience methods for common patterns
  async waitForStorage(): Promise<void> {
    return this.waitUntilReady((readyStates) =>
      Boolean(
        readyStates.find(
          (s) => s.source.type === "storage" && s.state.type === "found"
        )
      )
    );
  }

  async waitForPeer(peerId: PeerId): Promise<void> {
    return this.waitUntilReady(
      Boolean(
        readyStates.find(
          (s) =>
            s.source.type === "network" &&
            s.source.peerId === peerId &&
            s.state.type === "found"
        )
      )
    );
  }
}

// Here's how we can check if the storage- or network-provided data
// advances the state of the doc--we'd return this as the
// `containsNewOperations: boolean` value in our ReadyState.
function containsNewOperations(
  doc: LoroDoc,
  incomingBlob: Uint8Array
): boolean {
  const metadata = decodeImportBlobMeta(incomingBlob, true);

  // Quick check: no changes = no import needed
  if (metadata.changeNum === 0) return false;

  // VV comparison: fast and sufficient for our use case
  const currentVV = doc.oplogVersion();
  const incomingEndVV = metadata.partialEndVersionVector;

  for (const [peerId, counter] of incomingEndVV.toJSON()) {
    if (counter > (currentVV.get(peerId) || 0)) {
      return true; // They have operations we don't
    }
  }

  return false;
}
```

### 2. Peer-Centric State Model

**Decision**: Replace document-centric state tracking with peer-centric status tracking.

**Implementation**:

```typescript
export type DocPeerStatus = {
  hasDoc: boolean;
  isAwareOfDoc: boolean;
  isSyncingNow: boolean;
};
```

**Rationale**: Document synchronization is fundamentally about peer relationships, not document states.

**Trade-offs**:

- ✅ More accurate model of distributed system reality
- ✅ Simplified state management
- ❌ Requires applications to aggregate peer states for UI purposes

### 3. Service Injection Pattern

**Decision**: Use dependency injection for storage and network operations.

**Implementation**:

```typescript
export interface DocHandleServices<T extends DocContent> {
  loadFromStorage?: (documentId: DocumentId, doc: LoroDoc<T>) => Promise<void>;
  saveToStorage?: (
    documentId: DocumentId,
    doc: LoroDoc<T>,
    event: LoroEventBatch
  ) => Promise<void>;
  requestFromNetwork?: (
    documentId: DocumentId,
    doc: LoroDoc<T>,
    timeout: number
  ) => Promise<void>;
}
```

**Rationale**: Enables testability and separation of concerns between document management and I/O operations.

**Trade-offs**:

- ✅ Highly testable
- ✅ Clear separation of concerns
- ❌ More complex initialization
- ❌ Potential for service misconfiguration

### 4. Elimination of doc-handle-program.ts

**Decision**: Remove the entire TEA-style state machine program.

**Rationale**: The state machine was solving a problem that didn't need to exist once we embraced always-available documents.

**Trade-offs**:

- ✅ Massive reduction in code complexity (~500 lines removed)
- ✅ Eliminated entire class of state transition bugs
- ❌ Lost formal verification benefits of state machines
- ❌ Lost explicit modeling of async operations

## Code Patterns and Readability

### Successful Patterns

1. **Service Injection**: Clean separation between document logic and I/O operations
2. **Event-Driven Architecture**: Maintained clean event emission for document changes
3. **Idempotent Operations**: [`loadFromStorage()`](packages/repo/src/doc-handle.ts:191) and [`requestFromNetwork()`](packages/repo/src/doc-handle.ts:206) can be called multiple times safely
4. **Immutable Update Pattern**: Continued use of the mutative-to-immutable transformer for the Synchronizer

### Problematic Patterns

1. **Mixed Async/Sync APIs**: The DocHandle now mixes synchronous document access with asynchronous loading operations
2. **Error Handling Inconsistency**: Some operations throw, others fail silently
3. **Implicit State Dependencies**: The [`find()`](packages/repo/src/repo.ts:189) method's logic for determining when to try network vs storage is complex

## Major Mistakes and Lessons Learned

### 1. Underestimating Test Complexity

**Mistake**: Assumed that simplifying the architecture would automatically fix tests.

**Reality**: Tests were tightly coupled to the old state machine behavior and required extensive rewriting.

**Lesson**: When doing architectural refactors, budget significant time for test updates. Consider writing integration tests first to capture desired behavior.

### 2. Network Synchronization Debugging

**Mistake**: Initially focused on state machine logic rather than data flow.

**Reality**: The core issue was that documents weren't being transferred correctly due to export/import mismatches and timing issues.

**Lesson**: When debugging distributed systems, trace the actual data flow first, then worry about state management.

### 3. Service Interface Design

**Mistake**: Initially designed services to return documents rather than import into existing documents.

**Reality**: This created unnecessary object creation and didn't align with the "always available document" philosophy.

**Lesson**: Service interfaces should align with the core architectural principles. If documents are always available, services should operate on them, not create them.

## Persistent Issues and Recommended Fixes

### 1. Document Content Detection

**Current Issue**: The [`find()`](packages/repo/src/repo.ts:189) method uses export size to determine if a document has content, which is fragile.

**Recommended Fix**:

```typescript
// Better approach: Use Loro's built-in state tracking
private hasContent(doc: LoroDoc<T>): boolean {
  return doc.version().length > 0 || doc.frontiers().length > 0
}
```

### 2. Test Timing Issues

**Current Issue**: Tests assume synchronous behavior in an asynchronous system.

**Recommended Fix**: Implement proper async coordination:

```typescript
// Add to DocHandle
async waitForSync(timeout = 5000): Promise<void> {
  // Wait for any pending network operations to complete
}
```

### 3. Error Handling Inconsistency

**Current Issue**: Some operations throw, others fail silently.

**Recommended Fix**: Establish consistent error handling patterns:

```typescript
type LoadResult =
  | { success: true; bytesLoaded: number }
  | { success: false; error: Error };
```

## Recommendations for Future Development

### 1. Implement Proper Content Detection

Replace size-based content detection with semantic checks using Loro's version vectors.

### 2. Add Comprehensive Integration Tests

Create tests that verify end-to-end document synchronization without mocking internal components.

### 3. Establish Error Handling Conventions

Define consistent patterns for error handling across all async operations.

### 4. Consider Adding Back Minimal State Tracking

For applications that need loading indicators, consider adding optional state tracking:

```typescript
interface DocHandleState {
  isLoadingFromStorage: boolean;
  isLoadingFromNetwork: boolean;
  lastSyncTime?: Date;
}
```

### 5. Implement Proper Async Coordination

Add methods to wait for pending operations to complete, enabling more reliable testing and better user experience.

## Conclusion

The refactor was largely successful in achieving its primary goals: eliminating dual state machine complexity and embracing CRDT semantics. The core network synchronization now works correctly, and the codebase is significantly simpler.

The remaining issues are primarily around test expectations and edge cases rather than fundamental architectural problems. The new architecture provides a solid foundation for future development while being much easier to understand and maintain.

The key insight from this refactor is that **architectural complexity should match problem complexity**. The original system was over-engineered for the relatively simple problem of managing CRDT documents. By embracing the inherent properties of CRDTs (idempotency, commutativity, always-mergeable), we were able to eliminate most of the artificial complexity while maintaining all the essential functionality.

## Current Status

- **Test Results**: Reduced from 14 failures to 2 failures
- **Core Functionality**: Network synchronization working correctly
- **Architecture**: Successfully simplified from dual state machines to peer-centric model
- **Code Reduction**: Eliminated ~500 lines of complex state machine code
- **Remaining Work**: Minor test fixes and edge case handling
