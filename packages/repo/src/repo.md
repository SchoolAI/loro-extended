# `@loro-extended/repo` Architecture Document

This document provides a high-level overview of the `@loro-extended/repo` library, its architecture, and the key design decisions made during its development. It is intended for developers who wish to understand, extend, or maintain the library.

## 1. Core Concepts

The `@loro-extended/repo` library provides a framework for managing and synchronizing a collection of `Loro` CRDT documents between multiple peers. It is heavily inspired by the design of `automerge-repo`. The system is built around a few central concepts:

### 1.1. The `Repo`

The `Repo` class is the central coordinator of the entire system. It is the main entry point for all user interactions. Its primary responsibilities are:

- **Document Management**: Creating new documents (`create()`) and finding existing ones (`find()`).
- **Orchestration**: Managing the lifecycle and interaction of its underlying subsystems (Storage and Network).
- **Identity**: Each `Repo` has a unique `peerId` to identify it within the network.

A `Repo` instance acts as a container for a collection of documents, ensuring they are persistently stored and kept in sync with other peers.

### 1.2. The `DocHandle`

A `DocHandle` is a reference to a single document within the `Repo`. It is not the document itself, but a stateful wrapper that manages the document's lifecycle. A user never interacts with a `LoroDoc` directly; they always go through a `DocHandle`.

**Key Features:**

- **State Machine**: A `DocHandle` progresses through a series of states:
  - `idle`: The handle has been created, but the document has not been loaded from storage or the network.
  - `loading`: The document is being actively fetched from storage or requested from peers.
  - `ready`: The document is loaded, and its data is available for use (`handle.doc`).
  - `deleted`: The document has been marked for deletion.
- **Asynchronous Loading**: The `whenReady()` promise on the handle allows code to wait until the document is in the `ready` state before interacting with it.
- **Event-Driven**: It emits `change` events whenever the underlying document is modified, either by the local user or through a sync message from a peer.

### 1.3. Adapters: Pluggable Backends

A core design principle is the use of adapters for abstracting away the concrete implementation of storage and networking. This makes the `Repo` highly flexible and configurable.

- **`StorageAdapter`**: Defines the interface for a key-value storage backend. Its responsibility is to save, load, and remove raw document data (`Uint8Array`). An `InMemoryStorageAdapter` is provided for testing and simple use cases.
- **`NetworkAdapter`**: Defines the interface for a peer-to-peer communication channel. Its responsibility is to send and receive arbitrary messages between peers. An `InProcessNetworkAdapter` is provided, which allows multiple `Repo` instances within the same JavaScript process to communicate, facilitating robust testing.

## 2. System Architecture

The `Repo` is composed of several internal subsystems that work together.

```
┌──────────────────┐
│       Repo       │
│    (Public API)  │
└──────────────────┘
         │
         │     ┌──────────────────┐      ┌─────────────────┐
         ├───► │ StorageSubsystem ├────► │ StorageAdapter  │
         │     └──────────────────┘      └─────────────────┘
         │
         │     ┌──────────────────┐      ┌────────────────────┐
         └───► │ NetworkSubsystem ├────► │ NetworkAdapters... │
               └──────────────────┘      └────────────────────┘
                         │
                         │
               ┌─────────▼──────────┐
               │ CollectionSync...  │
               └────────────────────┘
```

### 2.1. `StorageSubsystem`

This subsystem manages all interactions with the `StorageAdapter`. It provides a simple, consistent API to the rest of the `Repo` for document persistence, abstracting away the specifics of the chosen backend.

### 2.2. `NetworkSubsystem`

This subsystem manages the lifecycle of all `NetworkAdapter` instances. It is responsible for:

- Connecting and disconnecting peers.
- Broadcasting outgoing messages to all connected peers.
- Routing incoming messages to the appropriate handler (e.g., the `CollectionSynchronizer`).

### 2.3. `CollectionSynchronizer`

This is the heart of the synchronization logic. It sits on top of the `NetworkSubsystem` and implements the actual protocol for how documents are exchanged between peers.

**Key Trade-off & Design Decision:**

Initially, the design was simpler: peers would broadcast any local changes, and other peers would apply them. **This was flawed.** If a peer came online and learned of a document it didn't have, it had no way to acquire it.

The architecture was refactored to an explicit **"Announce/Request/Sync"** protocol:

1.  **Announce**: A peer periodically broadcasts a list of all `documentId`s it has.
2.  **Request Sync**: When a peer receives an "announce" for a document it doesn't have, it sends a direct `request-sync` message to the announcer.
3.  **Sync**: The announcing peer responds with a `sync` message containing the full document snapshot. Any subsequent changes to the document are also sent as incremental `sync` messages.

This design is more complex and requires more network chatter, but it is **fundamentally more robust**. It guarantees that any peer can eventually acquire any document it learns about, which is a critical requirement for a distributed system.

## 3. Document Lifecycle & Data Flow

Here is the typical flow of data when a document is created and synchronized:

1.  **Creation**:

    - `userA` calls `repoA.create()`.
    - A new `DocHandle` is created with a new `LoroDoc`.
    - The `DocHandle` is immediately `ready`.
    - The `StorageSubsystem` saves the initial snapshot of the document to its `StorageAdapter`.

2.  **Synchronization begins**:

    - `repoA`'s `CollectionSynchronizer` sends an `announce` message over the `NetworkSubsystem` containing the new `documentId`.
    - `repoB`'s `NetworkSubsystem` receives the message and passes it to its `CollectionSynchronizer`.

3.  **Discovery and Request**:

    - `repoB` sees the new `documentId`. It calls `repoB.find()` to get a `DocHandle`.
    - This `DocHandle` starts in the `idle` state, as the document is not in `repoB`'s storage.
    - The `CollectionSynchronizer` sees that the handle is `idle` and sends a `request-sync` message to `repoA`.
    - The `DocHandle` in `repoB` transitions to `loading`.

4.  **Full Sync**:

    - `repoA` receives the `request-sync` and replies with a `sync` message containing the full document snapshot.
    - `repoB` receives the `sync` message. Its `DocHandle` imports the snapshot, initializes its internal `LoroDoc`, subscribes to future changes, and transitions to `ready`.
    - The `whenReady()` promise on `repoB`'s handle resolves.

5.  **Incremental Updates**:
    - `userA` modifies their document. The `DocHandle` in `repoA` detects the `change` and emits an incremental update.
    - The `CollectionSynchronizer` wraps this in a `sync` message and broadcasts it.
    - `repoB` receives the `sync` message and applies the incremental update to its copy of the document. The `change` event is fired on its `DocHandle`.

This architecture ensures that document state is managed consistently, whether loaded from local storage or initialized from a network peer, leading to a resilient and predictable system.
