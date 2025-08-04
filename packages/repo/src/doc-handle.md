# Loro DocHandle Architecture

This document outlines the architecture for the `DocHandle`, a core component in the Loro state synchronization system. The `DocHandle` is responsible for managing the lifecycle, state, and synchronization of a single Loro document.

## 1. Core Purpose

A `DocHandle` is a stateful wrapper around a single `LoroDoc` instance. It provides a higher-level, user-friendly API that abstracts the complexities of document loading, state management, and interaction with storage and network layers. It is inspired by the `DocHandle` in Automerge-Repo but tailored to Loro's specific capabilities.

Key responsibilities include:
- Managing the document's lifecycle (`loading`, `ready`, etc.).
- Providing a simple `change()` API for mutations.
- Emitting events when the document changes.
- Abstracting the persistence strategy (snapshots and updates).
- Generating and applying sync messages for peer-to-peer communication.

## 2. State Machine

To ensure predictable and robust behavior, the `DocHandle` is implemented as an explicit finite state machine.

```mermaid
stateDiagram-v2
    [*] --> idle: created

    idle --> loading: repo.find() [doc in storage]
    loading --> ready: loaded from storage
    loading --> unavailable: failed to load from storage
    
    idle --> searching: repo.find() [doc not in storage]
    searching --> syncing: peer announces document
    searching --> unavailable: discovery timeout
    
    syncing --> ready: sync message with data received
    syncing --> searching: sync timeout / peer disconnects
    
    ready --> deleted: repo.delete()
    searching --> deleted: repo.delete()
    syncing --> deleted: repo.delete()
    loading --> deleted: repo.delete()
```

### States

- **`Idle`**: The initial state. The handle exists, but we haven't tried to load it from storage or the network.
- **`Loading`**: We are actively trying to load the document from storage.
- **`Searching`**: The document wasn't found in storage, so we are now asking peers on the network if they have it. A discovery timer is running.
- **`Syncing`**: A peer has told us they have the document, and we are now waiting for them to send the data. A sync timer is running.
- **`Ready`**: The document is loaded in memory and available for use.
- **`Unavailable`**: We couldn't find the document in storage or on the network within the allotted time.
- **`Deleted`**: The document has been marked for deletion. This is a terminal state.

## 3. Core API

The `DocHandle<T>` will expose the following public API:

```typescript
import { type AsLoro, type LoroProxyDoc } from "loro-change";

class DocHandle<T> extends EventEmitter<DocHandleEvents<T>> {
  public readonly documentId: DocumentId;

  public get state(): HandleState;

  // Returns a promise that resolves when the handle is 'ready'.
  public whenReady(): Promise<void>;

  // Initiates loading by calling the provided async loader function.
  // Only callable when in the 'idle' state.
  public async load(getDoc: () => Promise<LoroProxyDoc<AsLoro<T>>>): Promise<void>;

  // Returns the underlying LoroProxyDoc. Throws if not 'ready'.
  public doc(): LoroProxyDoc<AsLoro<T>>;

  // The primary method for mutating the document. Throws if not 'ready'.
  public change(mutator: (doc: AsLoro<T>) => void): void;

  // Applies a sync message from a remote peer. Throws if not 'ready'.
  public applySyncMessage(message: Uint8Array): void;

  // Marks the document for deletion.
  public delete(): void;
}
```

## 4. Loading Strategy

The responsibility for persistence is delegated to the creator of the `DocHandle` (typically a `Repo` instance). The `DocHandle` itself is agnostic about where the document comes from; it simply orchestrates the state transitions based on the outcome of the `getDoc` promise provided to its `load()` method.

1.  **Initiate Load**: The `Repo` calls `handle.load(getDoc)`, where `getDoc` is a function that attempts to load the document from the `StorageSubsystem`. This immediately transitions the handle from `idle` to `loading`.
2.  **Storage Outcome**: The handle `await`s the `getDoc()` promise.
    -   **On Success**: If `getDoc()` resolves with a `LoroProxyDoc`, the document was found in storage. The handle transitions to `ready`.
    -   **On `null`**: If `getDoc()` resolves with `null`, the document is not in storage. The handle transitions to `searching`, signaling to the `Repo` that it should now query the network.
    -   **On Failure**: If the promise rejects, the handle transitions to `unavailable`.
3.  **Network Search**: While in the `searching` state, the `CollectionSynchronizer` (orchestrated by the `Repo`) broadcasts requests for the document and starts a discovery timer.
    -   **Peer Found**: If a peer announces it has the document, the `CollectionSynchronizer` moves the handle to the `syncing` state and starts a new timer.
    -   **Timeout**: If no peers respond before the discovery timer ends, the handle transitions to `unavailable`.
4.  **Network Sync**: While in the `syncing` state, the handle waits for a `sync` message.
    -   **Data Received**: When the `sync` message arrives, the handle applies it, initializes the `LoroDoc`, and transitions to `ready`.
    -   **Timeout**: If the peer fails to send the data in time, the `CollectionSynchronizer` can transition the handle back to `searching` to find another peer.

This design decouples the `DocHandle` from any specific storage or network implementation, making it a more general-purpose and reusable component. The `Repo` is now solely responsible for managing storage adapters and providing the correct `getDoc` logic.

## 5. Event Emitter Interface

The `DocHandle` emits events to notify the application of important changes.

-   **`on('change', (payload: { doc: LoroProxyDoc<AsLoro<T>> }) => void)`**: Fired whenever the document's content changes, either from a local mutation via `handle.change()` or from a remote change via `handle.applySyncMessage()`. The payload contains the mutated document proxy.
-   **`on('sync-message', (message: Uint8Array) => void)`**: Fired when a local change via `handle.change()` produces a sync message that needs to be broadcast to other peers.
-   **`on('state-change', (payload: { oldState: HandleState; newState: HandleState }) => void)`**: Fired whenever the handle's internal state transitions (e.g., from `loading` to `ready`).
