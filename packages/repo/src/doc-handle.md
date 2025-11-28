# Loro DocHandle Architecture

This document outlines the architecture for the `DocHandle`, a core component in the Loro state synchronization system. The `DocHandle` provides an always-available wrapper around a single Loro document that embraces CRDT semantics.

## 1. Core Purpose

A `DocHandle` is an always-available wrapper around a single `LoroDoc` instance. It provides immediate access to the document while offering flexible readiness APIs for applications that need to coordinate loading from storage or network sources.

The architecture embraces the fundamental properties of CRDTs:
- **Idempotency**: Operations can be applied multiple times safely
- **Commutativity**: Operations can be applied in any order
- **Always-mergeable**: Documents can always be merged without conflicts

Key responsibilities include:

- Providing immediate access to a `LoroDoc` instance without complex loading states
- Offering flexible readiness APIs that let applications define what "ready" means
- Managing peer state to track which peers have or are aware of the document
- Executing background loading from storage and network sources
- Emitting events when the document's content changes or peer state updates

## 2. Architecture: Always-Available with Flexible Readiness

The new architecture eliminates the complex state machine in favor of an always-available approach:

```typescript
export class DocHandle<T extends DocContent> {
  public readonly doc: LoroDoc<T> = new LoroDoc<T>(); // Always available
  #peers = new Map<PeerId, DocPeerStatus>(); // Peer-centric state
  
  // Flexible readiness API
  async waitUntilReady(predicate: ReadinessCheck): Promise<void> {
    // Applications define what "ready" means
  }
}
```

This approach provides:
- **Immediate availability**: Documents can be used right away
- **Flexible readiness**: Applications choose their own readiness criteria
- **Simplified testing**: No complex state transitions to mock
- **Better UX**: No artificial loading delays

## 3. Flexible Readiness API

Instead of complex state machines, the DocHandle provides a flexible readiness API that allows applications to define what "ready" means for their specific use case:

```typescript
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
    // Implementation coordinates storage and network operations
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
    return this.waitUntilReady((readyStates) =>
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
```

### Key Architectural Benefits

#### Embraces CRDT Semantics
- Documents are always available because CRDTs are lightweight and can be created synchronously
- Loading from storage/network is additive - operations are merged, not replaced
- No artificial "loading" states that don't align with CRDT properties

#### Application-Defined Readiness
- Different apps have different definitions of "ready"
- Some apps may want to wait for storage, others for specific peers
- The predicate system allows fine-grained control over readiness criteria

#### Simplified Architecture
- Eliminated ~500 lines of complex state machine code
- No dual state machine complexity (DocHandle + Synchronizer)
- Easier to test, debug, and maintain

## 4. Core API

The `DocHandle<T>` provides immediate document access with flexible readiness options:

```typescript
class DocHandle<T extends DocContent> extends EventEmitter<DocHandleEvents<T>> {
  public readonly documentId: DocumentId;
  public readonly doc: LoroDoc<T> = new LoroDoc<T>(); // Always available

  // Flexible readiness API
  async waitUntilReady(predicate: ReadinessCheck): Promise<void>;
  async waitForStorage(): Promise<void>;
  async waitForNetwork(): Promise<void>;

  // Peer state management
  getPeersWithDoc(): Set<PeerId>;
  getPeersAwareOfDoc(): Set<PeerId>;
  updatePeerStatus(peerId: PeerId, status: Partial<DocPeerStatus>): void;

  // Background loading (called automatically by Repo)
  loadFromStorage(): Promise<void>;
  requestFromNetwork(timeout?: number): Promise<void>;

  // Typed Presence
  typedPresence<S>(shape: S, emptyState: InferPlainType<S>): TypedPresence<S>;
}
```

## 5. Service Injection Pattern

The `DocHandle` uses dependency injection for I/O operations, maintaining clean separation of concerns:

```typescript
interface DocHandleServices<T extends DocContent> {
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

const handle = new DocHandle(documentId, services, { autoLoad: true });
```

Key benefits:
- **Testability**: Easy to mock services for testing
- **Flexibility**: Different storage/network implementations
- **Separation of concerns**: Document logic separate from I/O

## 6. Event Interface

The `DocHandle` emits events for document changes and peer state updates:

```typescript
type DocHandleEvents<T extends DocContent> = {
  "doc-handle-change": {
    doc: LoroDoc<T>;
    event: LoroEventBatch;
  };
  "doc-handle-local-change": Uint8Array; // Sync message for network
  "peer-status-changed": {
    peerId: PeerId;
    status: DocPeerStatus;
  };
};
```

- **`doc-handle-change`**: Fired for any document changes (local or remote)
- **`doc-handle-local-change`**: Fired for local changes, emits sync message for network
- **`peer-status-changed`**: Fired when peer status updates (has doc, aware of doc, etc.)

## 7. Peer State Management

The DocHandle tracks peer relationships for efficient synchronization:

```typescript
type DocPeerStatus = {
  hasDoc: boolean;        // Peer announced they have this document
  isAwareOfDoc: boolean;  // Peer knows about this document
  isSyncingNow: boolean;  // Currently syncing with this peer
};
```

This peer-centric model replaces document-centric state tracking, providing:
- **Better accuracy**: Models the reality of distributed systems
- **Efficient sync**: Only sync with relevant peers
- **Clear semantics**: Separates "has document" from "knows about document"
