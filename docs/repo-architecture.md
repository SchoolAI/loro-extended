# @loro-extended/repo Architecture

This document provides a detailed overview of the `@loro-extended/repo` library architecture, design decisions, and internal components.

## System Overview

The repo package follows a layered architecture:

```
┌─────────────────────────────────────────┐
│             Application                 │
├─────────────────────────────────────────┤
│                Repo                     │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │  DocHandle  │  │  Synchronizer    │  │
│  └─────────────┘  └──────────────────┘  │
│         │                  │            │
│         │          ┌───────▼────────┐   │
│         │          │ AdapterManager │   │
│         │          └───────┬────────┘   │
│         │                  │            │
│  ┌──────▼──────────────────▼─────────┐  │
│  │         Adapters (via Channels)   │  │
│  │  ┌─────────┐      ┌────────────┐  │  │
│  │  │ Storage │      │  Network   │  │  │
│  │  └─────────┘      └────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Core Components

### 1. Repo

The `Repo` class is the central orchestrator. It manages document lifecycle, coordinates adapters, and provides the main API for document operations.

**Key Architectural Decision**: The `Repo` class is intentionally kept as a simple orchestrator. It doesn't maintain complex state transitions of its own, but rather coordinates the state machines of its subsystems. This separation of concerns makes the system more maintainable and easier to understand.

**Responsibilities:**
- Document Management: Creating and retrieving documents (`get()`, `delete()`)
- Service Orchestration: Managing the lifecycle and wiring of subsystems
- Identity: Each `Repo` has a unique `peerId` to identify it within the network

### 2. DocHandle

A `DocHandle` is an always-available wrapper around a single document. It provides immediate access to the underlying `LoroDoc` while offering flexible readiness APIs.

**Key Features:**
- **Always-Available Architecture**: Documents are immediately accessible without complex loading states. The underlying `LoroDoc` is created synchronously.
- **Flexible Readiness API**: Applications can define custom readiness criteria using predicates
- **Presence & Ephemeral State**: Provides interfaces for sharing transient data (cursors, user status)
- **Event-Driven**: Emits events for document modifications and sync status updates

### 3. Synchronizer

The `Synchronizer` implements the high-level, peer-to-peer protocol for document discovery and exchange. It uses The Elm Architecture (TEA) for predictable state management.

**Key Features:**
- **Pure Functional Core**: Synchronization logic is implemented as a pure state machine
- **Ephemeral State**: Manages `EphemeralStore`s for presence data
- **Protocol**: Implements an "Announce/Request/Sync" protocol
- **Readiness Tracking**: Tracks document state across peers (`aware`, `loaded`, `absent`)

### 4. Adapters

Adapters abstract away the concrete implementation of communication channels. The system treats all adapters uniformly via an `AdapterManager`.

**Types:**
- **StorageAdapter**: Base class for persistence adapters (IndexedDB, LevelDB, PostgreSQL)
- **Network Adapters**: For peer communication (SSE, WebSocket, WebRTC, HTTP Polling)

## Architectural Trade-offs

### Immediate Access vs. Strict State Machines

The system employs a hybrid architecture to balance ease of use with robust distributed state management:

1. **Immediate Access Pattern (DocHandle)**:
   - CRDTs are inherently always-mergeable
   - You can edit a document before it has finished loading
   - Simplifies UI code by removing complex "loading/error/ready" state handling

2. **The Elm Architecture (Synchronizer)**:
   - Complex peer-to-peer protocol state requires predictable state management
   - Pure functions make the protocol testable and debuggable
   - Declaratively defines state transitions and side effects

3. **Imperative Orchestration (Repo)**:
   - Wires together the functional core with the imperative world of I/O
   - Keeps the public API ergonomic (async/await)

## Synchronization Protocol

The synchronizer uses an explicit three-phase protocol:

1. **Announce**: Peers broadcast `announce-document` messages listing available documents
2. **Request**: Peers send `request-sync` messages to fetch documents
3. **Sync**: Peers respond with document data via `sync` messages

### Cascade Prevention

To prevent infinite loops in hub-and-spoke topologies, sync messages include a `hopCount` field:
- `hopCount: 0`: Original message from the peer that made the change
- `hopCount: 1`: Message forwarded once by an intermediary
- `hopCount >= 1`: Should NOT be forwarded again

## Document Awareness Tracking

The synchronizer maintains two maps for document relationships:

| Map | Purpose | Used For |
|-----|---------|----------|
| `peersWithDoc` | Tracks which peers HAVE each document | Finding peers to fetch from |
| `peersAwareOfDoc` | Tracks which peers KNOW ABOUT each document | Determining update recipients |

## Related Documentation

- [Handle Design](../packages/repo/src/doc-handle.md) - Always-available document design
- [Synchronizer Protocol](../packages/repo/src/synchronizer.md) - Detailed sync protocol
- [Adapter System](../packages/repo/src/adapter/adapter.md) - Adapter implementation guide
- [Message Protocol](../packages/repo/MESSAGES.md) - Complete message flow documentation
- [Discovery and Sync](./discovery-and-sync-architecture.md) - Discovery architecture details
- [Presence](./presence.md) - Ephemeral data propagation
