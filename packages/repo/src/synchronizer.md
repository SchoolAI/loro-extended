# Synchronizer Architecture

This document describes the architecture of the `Synchronizer`, a key component of the `@loro-extended/repo` package responsible for orchestrating document synchronization between peers.

## 1. Core Purpose and Role

The `Synchronizer` implements the high-level, peer-to-peer protocol for document discovery and exchange. While the `NetworkSubsystem` manages the low-level details of sending and receiving messages, the `Synchronizer` defines the _meaning_ of those messages and the sequence of interactions required to keep the collection of documents consistent across the network.

Its primary role is to answer the question: "Which peers have which documents, and how do I get the ones I need?"

## 2. Separation of Concerns

The `Synchronizer` is a powerful example of the Single Responsibility Principle and is critical to the conceptual clarity of the entire `repo` architecture. The responsibilities are cleanly divided:

- **`Repo`**: The central orchestrator and public-facing API. It owns all the subsystems and wires them together. It decides _when_ to initiate a sync by observing the state of its `DocHandle`s.
- **`DocHandle`**: Manages the state, lifecycle, and data of a **single document**. It is responsible for loading the document from storage or applying sync changes, but it is completely unaware of _how_ it gets those changes from the network.
- **`NetworkSubsystem`**: Manages the raw connections to other peers. It knows how to send a message from A to B but has no knowledge of what the message contains or why it's being sent.
- **`Synchronizer`**: This class sits between the `Repo` and the `NetworkSubsystem`. It implements the **synchronization protocol** for the entire collection of documents. It maintains a directory of which peers have which documents and orchestrates the multi-step "dance" of requesting and receiving them.

This separation allows each component to be developed, tested, and understood in isolation. The `DocHandle` doesn't need to know about network protocols, and the `NetworkSubsystem` doesn't need to know about document states.

## 3. Relationship to `Repo` and `DocHandle`

The `Synchronizer` is a servant to the `Repo` and operates on its behalf.

- The `Repo` creates and owns a single `Synchronizer` instance.
- **Events from `Repo` to `Synchronizer`**: The `Repo` informs the `Synchronizer` of key events:
  - `synchronizer.addPeer(peerId)`: When the `NetworkSubsystem` connects to a new peer.
  - `synchronizer.removePeer(peerId)`: When a peer disconnects.
  - `synchronizer.addDocument(documentId)`: When the `Repo` creates or finds a handle for a new document.
- **Events from `Synchronizer` to `Repo`**: The `Synchronizer` emits generic messages that the `Repo` is responsible for sending over the network via the `NetworkSubsystem`. It also delivers sync data back to the appropriate `DocHandle`.

The `Synchronizer` and `DocHandle` are decoupled; they do not interact directly. The `Repo` acts as the intermediary, translating a state change in a `DocHandle` (e.g., "I need this document") into an action for the `Synchronizer` (e.g., "Find this document").

## 4. The "Announce/Request/Sync" Protocol

To ensure robustness in a distributed environment, the `Synchronizer` uses an explicit three-phase protocol:

1.  **Announce**: When a peer comes online or acquires a new document, it broadcasts an `announce-document` message to its peers. This message contains a list of `documentId`s it has available. This serves as a form of service discovery.
2.  **Request**: When a synchronizer needs a document, it first checks its internal directory to see if a peer has announced it.
    - If a peer is known, it sends a direct `request-sync` message to that peer.
    - If no peer is known, it broadcasts the `request-sync` message to all peers.
3.  **Sync**: A peer that receives a `request-sync` for a document it has will respond with a `sync` message containing the full document data. The requesting synchronizer then delivers this data to the waiting `DocHandle` to be processed.

This protocol is more verbose than a simple broadcast-on-change model, but it is fundamentally more resilient. It solves the "late-joiner" problem, ensuring that any peer can eventually acquire any document it needs, regardless of when it came online.

## 5. Document Awareness Tracking: The Two-Map Design

The synchronizer maintains two distinct maps to track document relationships with peers:

### 5.1. `peersWithDoc` Map

**Purpose**: Tracks which peers HAVE each document (they announced it to us).
**Used for**: Finding peers to fetch/sync a document from when we need it.
**Populated when**: A peer announces documents to us via `announce-document` message.

### 5.2. `peersAwareOfDoc` Map

**Purpose**: Tracks which peers KNOW ABOUT each document (we announced to them or they requested it).
**Used for**: Determining which peers should receive updates when we make local changes.
**Populated when**:

- We announce documents to a peer
- A peer requests a document from us
- A peer announces documents to us (they're both aware and have it)

### 5.3. Decision Matrix

| Scenario                        | `peersWithDoc` (They Have)  | `peersAwareOfDoc` (They Know About) | Action Required                              |
| ------------------------------- | --------------------------- | ----------------------------------- | -------------------------------------------- |
| **We create a new doc locally** | Empty                       | Empty → Add peers after announce    | Announce to permitted peers, track awareness |
| **Peer announces doc to us**    | Add peer                    | Add peer (they know they have it)   | Both maps updated                            |
| **We announce doc to peer**     | Empty (unless they confirm) | Add peer                            | Track that peer knows                        |
| **We make local change**        | N/A                         | **Use this set**                    | Send sync to aware peers                     |
| **Peer requests doc from us**   | N/A                         | Add peer (now they know)            | Send doc, track awareness                    |
| **We need to fetch a doc**      | **Use this set**            | N/A                                 | Request from peers who have it               |
| **Peer disconnects**            | Remove from set             | Remove from set                     | Clean both maps                              |
| **We delete a doc**             | Clear entry                 | Clear entry                         | Notify all aware peers                       |

This two-map design eliminates semantic ambiguity and ensures:

- Local changes are properly propagated to all interested peers
- We can efficiently find peers who have documents we need
- Permission boundaries are respected (via `canList` checks before adding to `peersAwareOfDoc`)
- The system correctly tracks bidirectional document awareness

## 6. Timeout Strategy: Event-Driven vs Polling

### 6.1. Evolution from Exponential Backoff

The synchronizer originally used exponential backoff (5s → 10s → 20s → 40s) for retrying failed sync requests. However, this polling-based approach was problematic because:

- It created poor UX for `findOrCreate` operations (30+ second waits)
- It was redundant with our event-driven architecture
- New peer connections naturally trigger document announcements

### 6.2. Current Approach: Single Timeouts

The synchronizer now uses single timeouts with no retries:

- **User-specified timeouts**: When DocHandle calls `queryNetwork` with a timeout (e.g., for `findOrCreate`), the synchronizer respects this timeout and fails immediately when it expires
- **Default timeouts**: For regular sync operations, a default 5-second timeout is used
- **Event-driven recovery**: If a document isn't found within the timeout, the sync fails, but if a new peer connects later with the document, synchronization happens naturally through the announce/request protocol

This approach provides:
- **Predictable behavior**: Timeouts mean exactly what they say
- **Better UX**: `findOrCreate` operations complete quickly
- **Simpler code**: No retry logic or backoff calculations
- **Natural resilience**: The event-driven protocol handles recovery

## 7. State Management & The Elm Architecture (TEA)

Like the `DocHandle`, the `Synchronizer` is built using a pure-functional core based on The Elm Architecture.

- **`synchronizer-program.ts`**: This file contains the pure, synchronous `update` function and the `Model` for the synchronizer's state. It declaratively defines how the state should change in response to messages and what side effects (Commands) should occur. The Model includes the two tracking maps (`peersWithDoc` and `peersAwareOfDoc`) that maintain document awareness state.
- **`synchronizer.ts`**: This class is the "impure" runtime. It holds the state and executes the `Command`s (e.g., sending network messages, setting timeouts) generated by the pure `update` function.

This architectural pattern makes the complex, stateful logic of the synchronization protocol manageable, testable, and easier to reason about, which was critical to identifying and fixing the bugs in this system. The clear separation of concerns between "who has documents" and "who knows about documents" ensures correct message routing and prevents synchronization failures.
