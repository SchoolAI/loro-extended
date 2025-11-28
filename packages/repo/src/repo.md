# `@loro-extended/repo` Architecture Document

This document provides a high-level overview of the `@loro-extended/repo` library, its architecture, and the key design decisions made during its development. It is intended for developers who wish to understand, extend, or maintain the library.

## 1. Core Concepts

The `@loro-extended/repo` library provides a framework for managing and synchronizing a collection of `Loro` CRDT documents between multiple peers. It is built around a few central concepts:

### 1.1. The `Repo`

The `Repo` class is the central orchestrator of the entire system. It is the main entry point for all user interactions. Its primary responsibilities are:

- **Document Management**: Creating and retrieving documents (`get()`, `delete()`).
- **Service Orchestration**: Managing the lifecycle and wiring of its underlying subsystems (Synchronizer, Adapters).
- **Identity**: Each `Repo` has a unique `peerId` to identify it within the network.

**Key Architectural Decision**: The `Repo` class is intentionally kept as a simple orchestrator. It doesn't maintain complex state transitions of its own, but rather coordinates the state machines of its subsystems. This separation of concerns makes the system more maintainable and easier to understand.

### 1.2. The `DocHandle`

A `DocHandle` is an always-available wrapper around a single document within the `Repo`. It provides immediate access to the underlying `LoroDoc` while offering flexible readiness APIs for applications that need to coordinate loading from storage or network sources.

**Key Features:**

- **Always-Available Architecture**: The `DocHandle` embraces CRDT semantics where documents are immediately accessible without complex loading states. The underlying `LoroDoc` is created synchronously and available via the `doc` property.

- **Flexible Readiness API**: Applications can define custom readiness criteria using predicates:

  ```typescript
  await handle.waitUntilReady((readyStates) =>
    readyStates.some(
      (s) =>
        s.state === "loaded" && s.channels.some((c) => c.kind === "storage")
    )
  );
  ```

- **Presence & Ephemeral State**: Provides a `presence` interface for sharing transient data (like cursors or user status) that doesn't need to be persisted in the document history.

- **Event-Driven**: Emits `change` events for document modifications and `ready-state-changed` events for sync status updates.

### 1.3. Adapters

Adapters abstract away the concrete implementation of communication channels. This makes the `Repo` highly flexible and configurable.

- **`Adapter`**: The base abstract class for all adapters.
- **`StorageAdapter`**: A base class for Adapters that persist data.
- **`network adapters`**: Other network adapters that connect to peers can be built by extending the Adapter base class.

The system treats all adapters uniformly, managing them via an `AdapterManager`.

### 1.4. Rules (Access Control)

Instead of a separate "PermissionAdapter", the system uses a `Rules` object to define access control policies.

- **`canBeginSync`**: Should we start syncing with this peer?
- **`canReveal`**: Can we tell this peer about a document?
- **`canUpdate`**: Do we accept updates from this peer for this document?
- **`canDelete`**: Can this peer delete this document?
- **`canCreate`**: Can this peer create a new document?

## 2. System Architecture

The `Repo` orchestrates the `Synchronizer` and `DocHandle`s:

```
┌──────────────────┐
│       Repo       │ ← Simple Orchestrator
│  (Async Public   │
│      API)        │
└──────────────────┘
         │
         ├─── Creates & Manages ───┐
         │                          │
         ▼                          ▼
┌──────────────────┐      ┌──────────────────┐
│    DocHandle     │      │   Synchronizer   │
│ (Always Available)      │   (TEA-based)    │
└──────────────────┘      └──────────────────┘
                                    │
                                    │
                          ┌──────────────────┐
                          │  AdapterManager  │
                          └──────────────────┘
                                    │
                        ┌───────────┴───────────┐
                        ▼                       ▼
                 ┌─────────────┐         ┌─────────────┐
                 │  Adapter A  │         │  Adapter B  │
                 └─────────────┘         └─────────────┘
```

### 2.1. Architectural Trade-offs

**Immediate Access vs. Strict State Machines**:

The system employs a hybrid architecture to balance ease of use with robust distributed state management.

- **Immediate Access Pattern (`DocHandle`)**:

  - **Concept**: Instead of forcing the user to wait for a document to "load" (async), the `DocHandle` provides immediate, synchronous access to an empty or existing `LoroDoc`.
  - **Why**: CRDTs are inherently always-mergeable. You can edit a document before it has finished loading from disk or network, and those edits will merge cleanly once the data arrives.
  - **Benefit**: This simplifies UI code by removing the need for complex "loading/error/ready" state handling in every component. The application can simply render the current state of the document, which updates reactively as data flows in.

- **The Elm Architecture (TEA) (`Synchronizer`)**:

  - **Concept**: The core synchronization logic is implemented as a pure function that takes a `Message` and a `Model` and returns a new `Model` and `Commands`.
  - **Why**: The synchronization protocol involves complex, asynchronous state transitions (handshakes, discovery, sync, ephemeral state) across multiple peers. Managing this with ad-hoc mutable state is error-prone and hard to debug.
  - **Benefit**: TEA provides a predictable, testable, and pure state machine for the core protocol logic, ensuring correctness in a distributed environment.

- **Imperative Orchestration (`Repo`)**:
  - **Concept**: The `Repo` class is a simple, imperative orchestrator.
  - **Why**: It needs to wire together the functional core (`Synchronizer`) with the imperative world of I/O (Adapters) and user interactions.
  - **Benefit**: Keeps the public API ergonomic (async/await) and easy to integrate with existing application frameworks.

### 2.2. `Synchronizer`

This is the heart of the synchronization logic. It implements a TEA-based state machine for managing document synchronization across peers.

**Key Features:**

- **Pure Functional Core**: The synchronization logic is implemented as a pure state machine in `synchronizer-program.ts`.
- **Ephemeral State**: Manages `EphemeralStore`s for presence data.
- **Protocol**: Implements an "Announce/Request/Sync" protocol.
- **Readiness Tracking**: Tracks the state of documents across peers (`aware`, `loaded`, `absent`).

**Protocol Design:**

1.  **Establishment**: Channels are established via a handshake.
2.  **Discovery**: Peers exchange information about which documents they have.
3.  **Sync**: Peers exchange document updates or snapshots.
4.  **Ephemeral**: Peers exchange transient data (presence).

## 3. Document Lifecycle & Data Flow

### 3.1. Creating/Getting a Document

```typescript
// User calls get() - returns a DocHandle immediately
const handle = repo.get<MyDoc>("my-doc-id");

// Handle is immediately available, doc property ready to use
handle.change((doc) => {
  doc.text = "Hello";
});
```

1.  `Repo` creates or retrieves a `DocHandle`.
2.  `DocHandle` ensures the document exists in the `Synchronizer`.
3.  `Synchronizer` manages loading from storage/network in the background.
4.  `DocHandle` emits events as state changes.

### 3.2. Waiting for Data

The `DocHandle` provides a flexible `waitUntilReady` method that accepts a predicate function. This allows you to define exactly what "ready" means for your application.

```typescript
// Wait for storage to load
await handle.waitForStorage();

// Wait for network peers
await handle.waitForNetwork();

// Custom readiness: Wait for a specific peer to have the document
await handle.waitUntilReady((readyStates) =>
  readyStates.some(
    (s) => s.state === "aware" && s.identity.peerId === "specific-peer-id"
  )
);
```

You can also monitor synchronization state across the entire repository by accessing the synchronizer's event emitter:

```typescript
repo.synchronizer.emitter.on(
  "ready-state-changed",
  ({ docId, readyStates }) => {
    console.log(`Document ${docId} state changed:`, readyStates);
  }
);
```

### 3.3. Presence

```typescript
// Set local presence
handle.presence.set({ name: "Alice", cursor: { x: 10, y: 20 } });

// Subscribe to others' presence
handle.presence.subscribe((peers) => {
  console.log("Peer presence:", peers);
});
```

## 4. Testing Strategy

The architecture supports comprehensive testing:

1.  **Unit Tests**: Pure state machines (`synchronizer-program.ts`) are easily testable.
2.  **Integration Tests**: `InProcessNetworkAdapter` (or similar) allows testing multi-peer scenarios within a single process.
3.  **Async Testing**: The Promise-based API makes async testing straightforward.

## 5. Future Considerations

- **Performance**: Optimization for large numbers of documents (lazy loading).
- **Persistence**: More sophisticated persistence strategies (incremental saves).
- **Security**: Enhanced cryptographic identity and verification.
