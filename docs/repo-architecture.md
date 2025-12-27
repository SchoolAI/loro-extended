# @loro-extended/repo Architecture

This document describes the internal architecture and design decisions of the `@loro-extended/repo` library. For usage documentation, see the [Getting Started Guide](./getting-started.md) and the [package README](../packages/repo/README.md).

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

The [`Repo`](../packages/repo/src/repo.ts) class is the central orchestrator. It manages document lifecycle, coordinates adapters, and provides the main API for document operations.

**Key Architectural Decision**: The `Repo` class is intentionally kept as a simple orchestrator. It doesn't maintain complex state transitions of its own, but rather coordinates the state machines of its subsystems. This separation of concerns makes the system more maintainable and easier to understand.

**Responsibilities:**
- Document Management: Creating and retrieving documents
- Service Orchestration: Managing the lifecycle and wiring of subsystems
- Identity: Each `Repo` has a unique `peerId` to identify it within the network

### 2. Handle

A [`Handle`](../packages/repo/src/handle.ts) is an always-available wrapper around a single document. It provides immediate access to the underlying `LoroDoc` while offering flexible readiness APIs.

**Key Design Decisions:**

1. **Always-Available Architecture**: Documents are immediately accessible without complex loading states. The underlying `LoroDoc` is created synchronously. This works because CRDTs are inherently always-mergeable—you can edit a document before it has finished loading from storage or network.

2. **Flexible Readiness API**: Rather than a simple "loading/ready/error" state machine, the Handle provides a predicate-based `waitUntilReady()` method. Applications can define custom readiness criteria based on their needs.

3. **Typed Ephemeral Stores**: Ephemeral state (presence, cursors) is managed through typed stores declared at handle creation time. This provides type safety while keeping the ephemeral system flexible.

See [Handle Design](../packages/repo/src/doc-handle.md) for detailed internal documentation.

### 3. Synchronizer

The [`Synchronizer`](../packages/repo/src/synchronizer.ts) implements the peer-to-peer protocol for document discovery and exchange. It uses The Elm Architecture (TEA) for predictable state management.

**Key Design Decisions:**

1. **Pure Functional Core**: The synchronization logic is implemented as a pure state machine in [`synchronizer-program.ts`](../packages/repo/src/synchronizer-program.ts). The `update` function takes a message and model, returning a new model and commands. This makes the protocol testable and debuggable.

2. **Command Pattern**: Side effects (network I/O, storage) are represented as commands returned by the update function, not executed directly. The Synchronizer runtime executes these commands.

3. **Channel Abstraction**: All communication happens through Channels, which abstract away the transport mechanism. This allows the same protocol to work over SSE, WebSocket, WebRTC, or storage.

See [Synchronizer Protocol](../packages/repo/src/synchronizer.md) for detailed internal documentation.

### 4. AdapterManager

The [`AdapterManager`](../packages/repo/src/adapter/adapter-manager.ts) coordinates multiple adapters and routes messages between them and the Synchronizer.

**Key Design Decisions:**

1. **Uniform Interface**: All adapters (storage and network) implement the same base interface. The system treats them uniformly.

2. **Channel Directory**: Each adapter manages its own channels through a [`ChannelDirectory`](../packages/repo/src/channel-directory.ts). Channels are created lazily when needed.

3. **Lifecycle Management**: The AdapterManager handles adapter startup, shutdown, and error recovery.

### 5. Adapters

Adapters abstract away the concrete implementation of communication channels.

**Types:**
- **StorageAdapter**: Base class for persistence adapters. Extends `Adapter` with storage-specific methods (`load`, `save`, `remove`).
- **Network Adapters**: For peer communication. Each creates channels for connected peers.

See [Creating Adapters](./creating-adapters.md) for implementation details.

### 6. Rules (Access Control)

The [`Rules`](../packages/repo/src/rules.ts) system provides fine-grained access control without requiring a separate adapter.

**Key Design Decision**: Rules are pure functions evaluated at sync time, not a separate permission layer. This keeps the architecture simple while allowing complex access patterns.

See [Rules Documentation](./rules.md) for detailed information.

## Architectural Trade-offs

### Immediate Access vs. Strict State Machines

The system employs a hybrid architecture to balance ease of use with robust distributed state management:

| Layer | Pattern | Rationale |
|-------|---------|-----------|
| Handle | Immediate Access | CRDTs are always-mergeable; simplifies UI code |
| Synchronizer | TEA/Elm Architecture | Complex protocol requires predictable state management |
| Repo | Imperative Orchestration | Wires functional core with I/O; keeps API ergonomic |

### Channel-Based Communication

All communication flows through Channels, even for storage:

**Pros:**
- Uniform message handling for all adapters
- Protocol logic doesn't need to know about transport details
- Easy to add new transport types

**Cons:**
- Slight overhead for storage operations
- More complex than direct storage calls

### Hop Count for Cascade Prevention

In hub-and-spoke topologies (e.g., clients connected to a server), updates could cascade infinitely. The system uses a `hopCount` field:

- `hopCount: 0`: Original message from the peer that made the change
- `hopCount: 1`: Message forwarded once by an intermediary
- `hopCount >= 1`: Should NOT be forwarded again

This prevents infinite loops while still allowing server-mediated sync.

## State Management

### Document State

Each document in the Synchronizer maintains:

```typescript
type DocState = {
  doc: LoroDoc
  channelState: Map<ChannelId, {
    awareness: "unknown" | "has-doc" | "no-doc"
    loading: LoadingState
  }>
  ephemeralStores: Map<string, EphemeralStore>
}
```

### Channel State

Channels progress through states:

```
ConnectedChannel → EstablishedChannel
     │                    │
     │ (establish-request/response)
     └────────────────────┘
```

- **ConnectedChannel**: Transport connected, but peer identity unknown
- **EstablishedChannel**: Handshake complete, peer identity known

## Message Flow

See [Message Protocol](./messages.md) for complete message flow documentation.

## Testing Strategy

The architecture supports comprehensive testing:

1. **Unit Tests**: Pure state machines (`synchronizer-program.ts`) are easily testable with mock models.

2. **Integration Tests**: [`BridgeAdapter`](../packages/repo/src/adapter/bridge-adapter.ts) allows testing multi-peer scenarios within a single process by connecting repos directly.

3. **Handler Tests**: Each message handler has dedicated tests in `src/synchronizer/*/handle-*.test.ts`.

## Future Considerations

- **Performance**: Optimization for large numbers of documents (lazy loading, pagination)
- **Persistence**: More sophisticated persistence strategies (incremental saves, compaction)
- **Security**: Enhanced cryptographic identity and verification

## Related Documentation

- [Handle Design](../packages/repo/src/doc-handle.md) - Internal handle architecture
- [Synchronizer Protocol](../packages/repo/src/synchronizer.md) - Internal sync protocol
- [Message Protocol](./messages.md) - Complete message flow documentation
- [Discovery and Sync](./discovery-and-sync-architecture.md) - Discovery architecture details
- [Presence](./presence.md) - Ephemeral data propagation
- [Creating Adapters](./creating-adapters.md) - Adapter implementation guide
- [Rules System](./rules.md) - Access control documentation
