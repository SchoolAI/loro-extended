# Loro Handle Architecture

This document outlines the architecture for the `Handle`, a core component in the Loro state synchronization system. The `Handle` provides an always-available wrapper around a single Loro document that embraces CRDT semantics.

## 1. Core Purpose

A `Handle` is an always-available wrapper around a single `LoroDoc` instance. It provides immediate access to the document while offering flexible readiness APIs for applications that need to coordinate loading from storage or network sources.

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

The architecture eliminates complex state machines in favor of an always-available approach:

```typescript
export class Handle<D extends DocShape, E extends EphemeralDeclarations> {
  public readonly doc: TypedDoc<D>; // Always available, typed document

  // Ephemeral stores (presence, etc.)
  public readonly presence: TypedEphemeral<E["presence"]>; // If declared

  // Flexible readiness API
  async waitUntilReady(predicate: ReadinessCheck): Promise<Handle<D, E>> {
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

Instead of complex state machines, the Handle provides a flexible readiness API that allows applications to define what "ready" means for their specific use case:

```typescript
type ReadyState = {
  state: "requesting" | "loaded" | "not-found";
  channels: Array<{
    kind: "storage" | "network";
    adapterId: string;
    peerId?: string;
  }>;
};

type ReadinessCheck = (readyStates: ReadyState[]) => boolean;

// Handle API
class Handle<D extends DocShape, E extends EphemeralDeclarations> {
  // Typed document access
  public readonly doc: TypedDoc<D>;

  // Configurable readiness
  async waitUntilReady(predicate: ReadinessCheck): Promise<Handle<D, E>> {
    // Implementation coordinates storage and network operations
    // based on the specified criteria
  }

  // Convenience methods for common patterns
  async waitForStorage(): Promise<Handle<D, E>> {
    return this.waitUntilReady((readyStates) =>
      readyStates.some(
        (s) =>
          s.state === "loaded" && s.channels.some((c) => c.kind === "storage")
      )
    );
  }

  async waitForNetwork(): Promise<Handle<D, E>> {
    return this.waitUntilReady((readyStates) =>
      readyStates.some(
        (s) =>
          s.state === "loaded" && s.channels.some((c) => c.kind === "network")
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

The `Handle<D, E>` provides immediate document access with flexible readiness options:

```typescript
class Handle<D extends DocShape, E extends EphemeralDeclarations> {
  public readonly docId: DocId;
  public readonly peerId: PeerID;
  public readonly doc: TypedDoc<D>; // Always available, typed
  public readonly loroDoc: LoroDoc; // Raw LoroDoc access

  // Flexible readiness API
  readonly readyStates: ReadyState[];
  async waitUntilReady(predicate: ReadinessCheck): Promise<Handle<D, E>>;
  async waitForStorage(): Promise<Handle<D, E>>;
  async waitForNetwork(): Promise<Handle<D, E>>;
  onReadyStateChange(cb: (states: ReadyState[]) => void): () => void;

  // Document mutations
  change(fn: (draft: MutableDoc<D>) => void): void;

  // Subscriptions
  subscribe(listener: (event: LoroEventBatch) => void): () => void;
  subscribe<T>(
    selector: PathSelector<D, T>,
    listener: (value: T, prev?: T) => void
  ): () => void;
  subscribe(
    jsonpath: string,
    listener: (values: unknown[]) => void
  ): () => void;

  // Ephemeral stores (dynamically added based on E)
  // e.g., handle.presence: TypedEphemeral<E['presence']>
  addEphemeral(name: string, store: EphemeralStore): void;
  getEphemeral(name: string): EphemeralStore | undefined;
}
```

## 5. Ephemeral Stores (Presence)

The Handle supports multiple typed ephemeral stores for real-time collaboration features:

```typescript
// Define ephemeral declarations
const EphemeralDeclarations = {
  presence: Shape.plain.struct({
    // low-frequency ephemeral updates
    name: Shape.plain.string().placeholder("Anonymous"),
  }),
  mouse: Shape.plain.struct({
    // high-frequency ephemeral updates
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
};

// Get handle with ephemeral stores
const handle = repo.get("doc-id", DocSchema, EphemeralDeclarations);

// Access typed ephemeral stores
handle.presence.setSelf({ name: "Alice" });
handle.mouse.setSelf({ x: 100, y: 200 });

// Read presence
console.log(handle.presence.self); // Your presence
for (const [peerId, presence] of handle.presence.peers) {
  console.log(`${peerId}: ${presence.name}`);
}
```

Key benefits:

- **Type safety**: Full TypeScript inference for ephemeral data
- **Bandwidth isolation**: Multiple stores for different update frequencies
- **Placeholder defaults**: Missing fields filled with schema defaults

## 6. TypedEphemeral Interface

Each ephemeral store provides a unified API:

```typescript
interface TypedEphemeral<T> {
  // Core API - Shared key-value store
  set(key: string, value: T): void;
  get(key: string): T | undefined;
  getAll(): Map<string, T>;
  delete(key: string): void;

  // Convenience API - For the common per-peer pattern
  readonly self: T | undefined;
  setSelf(value: T): void;
  readonly peers: Map<string, T>;

  // Subscription
  subscribe(
    cb: (event: {
      key: string;
      value: T | undefined;
      source: "local" | "remote" | "initial";
    }) => void
  ): () => void;

  // Escape hatch
  readonly raw: EphemeralStore;
}
```

## 7. Creating Handles

Handles are created via `repo.get()`:

```typescript
// With typed document and ephemeral stores
const handle = repo.get("doc-id", DocSchema, { presence: PresenceSchema });

// With typed document only
const handle = repo.get("doc-id", DocSchema);

// With untyped document (Shape.any())
const handle = repo.get("doc-id", Shape.any());
```

The Handle is immediately available - no loading states required. Use `waitForStorage()` or `waitForNetwork()` if you need to ensure data is loaded before proceeding.
