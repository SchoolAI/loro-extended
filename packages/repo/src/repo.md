# `@loro-extended/repo` Architecture Document

This document provides a high-level overview of the `@loro-extended/repo` library, its architecture, and the key design decisions made during its development. It is intended for developers who wish to understand, extend, or maintain the library.

## 1. Core Concepts

The `@loro-extended/repo` library provides a framework for managing and synchronizing a collection of `Loro` CRDT documents between multiple peers. It is heavily inspired by the design of `automerge-repo`. The system is built around a few central concepts:

### 1.1. The `Repo`

The `Repo` class is the central orchestrator of the entire system. It is the main entry point for all user interactions. Its primary responsibilities are:

- **Document Management**: Creating new documents (`create()`) and finding existing ones (`find()`).
- **Service Orchestration**: Managing the lifecycle and wiring of its underlying subsystems (Storage, Network, and Synchronization).
- **Dependency Injection**: Providing services to `DocHandle` instances and coordinating between subsystems.
- **Identity**: Each `Repo` has a unique `peerId` to identify it within the network.

**Key Architectural Decision**: Unlike `DocHandle` and `Synchronizer` which use The Elm Architecture (TEA) for complex state management, the `Repo` class is intentionally kept as a simple orchestrator. It doesn't maintain complex state transitions of its own, but rather coordinates the state machines of its subsystems. This separation of concerns makes the system more maintainable and easier to understand.

### 1.2. The `DocHandle`

A `DocHandle` is a reference to a single document within the `Repo`. It is not the document itself, but a stateful wrapper that manages the document's lifecycle. A user never interacts with a `LoroDoc` directly; they always go through a `DocHandle`.

**Key Features:**

- **TEA-Based State Machine**: The `DocHandle` implements The Elm Architecture with a pure functional core (`doc-handle-program.ts`) and an impure runtime host (`doc-handle.ts`). It progresses through a series of states:
  - `idle`: The handle has been created, but we haven't tried to load it.
  - `storage-loading`: We are actively trying to load the document from storage.
  - `network-loading`: The document wasn't found in storage, so we are querying the network.
  - `creating`: We are creating a new document.
  - `ready`: The document is loaded and available.
  - `unavailable`: We couldn't find the document in storage or on the network.
  - `deleted`: The document has been marked for deletion.
  
- **Promise-Based API**: All public methods (`find()`, `create()`, `findOrCreate()`) return Promises that resolve when the operation completes, providing a modern async/await interface.

- **Event-Driven**: It emits `change` events whenever the underlying document is modified, either by the local user or through a sync message from a peer.

### 1.3. Adapters: Pluggable Backends

A core design principle is the use of adapters for abstracting away the concrete implementation of storage and networking. This makes the `Repo` highly flexible and configurable.

- **`StorageAdapter`**: Defines the interface for a key-value storage backend. Its responsibility is to save, load, and remove raw document data (`Uint8Array`). An `InMemoryStorageAdapter` is provided for testing and simple use cases.
- **`NetworkAdapter`**: Defines the interface for a peer-to-peer communication channel. Its responsibility is to send and receive arbitrary messages between peers. An `InProcessNetworkAdapter` is provided, which allows multiple `Repo` instances within the same JavaScript process to communicate, facilitating robust testing.
- **`PermissionAdapter`**: An optional interface for implementing access control. It provides a set of functions (`canList`, `canWrite`, `canDelete`) that are used by the `Synchronizer` to authorize actions. If a method is not provided, the action is permitted. See the "Access Control" section under `Synchronizer` for details.

## 2. System Architecture

The `Repo` orchestrates several subsystems, each with distinct responsibilities:

```
┌──────────────────┐
│       Repo       │ ← Simple Orchestrator (No TEA)
│  (Async Public   │
│      API)        │
└──────────────────┘
         │
         ├─── Creates & Manages ───┐
         │                          │
         ▼                          ▼
┌──────────────────┐      ┌──────────────────┐
│    DocHandle     │      │ CollectionSync   │
│   (TEA-based)    │      │   (TEA-based)    │
└──────────────────┘      └──────────────────┘
         │                          │
         │     ┌──────────────────┐ │
         ├───► │ StorageSubsystem │ │
         │     └──────────────────┘ │
         │                          │
         │     ┌──────────────────┐ │
         └───► │ NetworkSubsystem ├─┘
               └──────────────────┘
```

### 2.1. Architectural Trade-offs

**TEA vs Simple Orchestration**: 
- **Where TEA is Used**: `DocHandle` and `Synchronizer` use The Elm Architecture because they manage complex state transitions. Their state machines have multiple states, complex transition logic, and need to be highly testable.
- **Where TEA is NOT Used**: The `Repo` class is a simple orchestrator. It was initially implemented with TEA but was refactored to a plain class because:
  - It has minimal state (just a cache of handles)
  - Its primary role is dependency injection and service wiring
  - The TEA pattern added unnecessary complexity without providing value
  - Direct async/await APIs are more ergonomic for users

This hybrid approach gives us the best of both worlds: predictable state management where it matters, and simplicity where it doesn't.

### 2.2. `StorageSubsystem`

This subsystem manages all interactions with the `StorageAdapter`. It provides a simple, consistent API to the rest of the `Repo` for document persistence, abstracting away the specifics of the chosen backend.

### 2.3. `NetworkSubsystem`

This subsystem manages the lifecycle of all `NetworkAdapter` instances. It is responsible for:

- Connecting and disconnecting peers.
- Sending outgoing messages to the specific peers designated by the `Synchronizer`.
- Routing incoming messages to the appropriate handler (e.g., the `Synchronizer`).

### 2.4. `Synchronizer`

This is the heart of the synchronization logic. It implements a TEA-based state machine for managing document synchronization across peers.

**Key Features:**
- **Pure Functional Core**: The synchronization logic is implemented as a pure state machine in `synchronizer-program.ts`
- **Retry Logic**: Implements exponential backoff for network requests
- **Peer Discovery**: Maintains a directory of which peers have which documents

**Protocol Design:**

The synchronizer implements an **"Announce/Request/Sync"** protocol:

1. **Announce Document**: When a peer connects, it is sent a list of all documents this repo has (that the peer is allowed to see via `canList`). When a new document is added locally, it is announced to all connected peers (again, subject to `canList`).
2. **Request Sync**: When a peer needs a document, it sends a `request-sync` message. If it knows which peer has the document (from an announcement), it sends the request directly. Otherwise, it sends the request to all connected peers.
3. **Sync**: The peer with the document responds with a `sync` message containing the document's data.

This design is more complex than simple broadcast-on-change, but it's **fundamentally more robust**. It guarantees that any peer can eventually acquire any document it learns about.

**Access Control:**

The `Synchronizer` is responsible for enforcing access control rules via the `PermissionAdapter`.

- **Outgoing (Discovery & Updates)**: When a new document is created or a new peer connects, the `canList(peerId, documentId)` function is called. If it returns `false`, the peer will not be told about the document. This is the **discovery** gate. Once a peer is aware of a document (i.e., they are in `docAvailability`), they will receive all subsequent `sync` messages for it.
- **Incoming (Updates)**: When a `sync` message is received from a remote peer, the `canWrite(peerId, documentId)` function is called. If it returns `false`, the message is ignored, preventing unauthorized changes.

This design is more complex than simple broadcast-on-change, but it's **fundamentally more robust**. It guarantees that any peer can eventually acquire any document it learns about.

## 3. Document Lifecycle & Data Flow

Here is the typical flow when working with documents:

### 3.1. Creating a Document

```typescript
// User calls create() - returns a Promise
const handle = await repo.create<MyDoc>({ 
  initialValue: () => ({ text: "Hello" }) 
})
// Handle is immediately ready
```

1. `Repo` creates a new `DocHandle` with injected services
2. `DocHandle` transitions through states: `idle` → `creating` → `ready`
3. The Promise resolves with the ready handle
4. Document is saved to storage and announced to peers

### 3.2. Finding a Document

```typescript
// User calls find() - returns a Promise
const handle = await repo.find<MyDoc>(documentId)
// Handle is ready when document is found
```

1. `Repo` creates or retrieves a `DocHandle`
2. `DocHandle` attempts to load from storage first
3. If not in storage, queries the network via `Synchronizer`
4. Promise resolves when document is found or rejects if unavailable

### 3.3. State Coordination

The `Repo` coordinates between subsystems through event listeners:

```typescript
// When a handle has a local change, we tell the synchronizer about it.
handle.on("doc-handle-local-change", (message) => {
  synchronizer.onLocalChange(documentId, message)
})

// When a handle is ready, we tell the synchronizer to announce it.
handle.on("doc-handle-state-transition", ({ newState }) => {
  if (newState.state === "ready") {
    synchronizer.addDocument(documentId)
  }
})
```

## 4. Testing Strategy

The architecture supports comprehensive testing at multiple levels:

1. **Unit Tests**: Pure state machines (`doc-handle-program.ts`, `synchronizer-program.ts`) are easily testable with simple input/output assertions.

2. **Integration Tests**: The `InProcessNetworkAdapter` allows testing multi-peer scenarios within a single process.

3. **Async Testing**: The Promise-based API makes async testing straightforward with async/await.

## 5. Future Considerations

- **Performance**: The current architecture could be optimized for large numbers of documents by implementing lazy loading strategies.
- **Persistence**: The storage subsystem could be extended to support more sophisticated persistence strategies (e.g., incremental saves).
- **Security**: The permission adapter system provides hooks for implementing fine-grained access control.

This architecture ensures that document state is managed consistently, whether loaded from local storage or synchronized from network peers, leading to a resilient and predictable system.
