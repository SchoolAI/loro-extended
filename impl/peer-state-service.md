# Peer State Service: Planning Document

## Part 1: Initial Plan - Unifying Peer State Storage

### Current Problem

The system currently stores peer state in two separate places, leading to duplication and inconsistency:

1. **Network Subsystem** ([`packages/repo/src/network/network-subsystem.ts`](packages/repo/src/network/network-subsystem.ts)):

   - Manages network adapters and receives peer connection/disconnection events
   - Emits [`peer`](packages/repo/src/network/network-subsystem.ts:8) and [`peer-disconnected`](packages/repo/src/network/network-subsystem.ts:9) events
   - No persistent state storage

2. **Synchronizer Program** ([`packages/repo/src/synchronizer-program.ts`](packages/repo/src/synchronizer-program.ts)):
   - Maintains its own peer state in the [`Model.peers`](packages/repo/src/synchronizer-program.ts:11) Set
   - Handles peer additions via [`msg-peer-added`](packages/repo/src/synchronizer-program.ts:57) and removals via [`msg-peer-removed`](packages/repo/src/synchronizer-program.ts:58)
   - Tracks document-specific peer relationships

This duplication causes timing gaps where the synchronizer might try to send messages to peers that the network adapter knows are disconnected, resulting in warnings like:

```
[SSE-ADAPTER] Tried to send message to disconnected peer ${targetId}
```

### Immediate Solution: Basic PeerStateService

We'll implement a simple PeerStateService that serves as the single source of truth for peer connectivity:

```typescript
interface PeerStateService {
  // Get current peer state
  getPeerState(peerId: PeerId): PeerState;

  // Update peer state with validation
  updatePeerState(peerId: PeerId, state: PeerState): void;

  // Check if peer is available for messaging
  isPeerAvailable(peerId: PeerId): boolean;

  // Subscribe to state changes
  onStateChange(callback: (peerId: PeerId, state: PeerState) => void): void;

  // Get all connected peers
  getConnectedPeers(): PeerId[];
}

enum PeerState {
  CONNECTING = "connecting",
  CONNECTED = "connected",
  DISCONNECTING = "disconnecting",
  DISCONNECTED = "disconnected",
}
```

### Implementation Steps

1. **Create PeerStateService class** in a new file: `packages/repo/src/peer-state-service.ts`
2. **Modify NetworkSubsystem** to use PeerStateService instead of emitting events directly
3. **Update Synchronizer** to query PeerStateService instead of maintaining its own peer set
4. **Remove duplicate peer tracking** from SynchronizerProgram
5. **Update Repo** to instantiate and inject PeerStateService

### Pros and Cons

#### Pros:

- **Single Source of Truth**: Eliminates peer state duplication
- **Immediate Bug Fix**: Resolves "Tried to send message to disconnected peer" warnings
- **Simpler Logic**: Reduces complexity in both NetworkSubsystem and Synchronizer
- **Better Testability**: Centralized state is easier to test and mock
- **Foundation for Future**: Provides a base for more sophisticated peer management

#### Cons:

- **Additional Abstraction**: Adds one more layer to the system
- **Minimal Performance Impact**: Slight overhead from state service calls
- **Limited Scope**: Only addresses connectivity, not application health

#### Trade-offs:

- **Simplicity vs. Completeness**: This solution prioritizes simplicity over comprehensive health monitoring
- **Immediate vs. Long-term**: Focuses on immediate bug fix rather than full-featured system
- **Centralization vs. Distribution**: Centralizes state management, which is good for consistency but creates a single point of failure

### Architectural Considerations

This approach follows the "Single Responsibility Principle" by creating a dedicated service for peer state management. It aligns with the "Host-as-Orchestrator" pattern described in [`docs/host-as-orchestrator.md`](docs/host-as-orchestrator.md) by keeping the pure state machines pure while moving state management to the impure host classes.

The implementation maintains backward compatibility and doesn't require changes to the network adapter interfaces, making it a low-risk refactoring.

## Part 2: Peer State Service Implementation: Lessons Learned and Future Guidance

## Executive Summary

Our attempt to implement a unified PeerStateService revealed fundamental architectural tensions between event-driven and query-based approaches to peer state management. While we successfully created a PeerStateService and integrated it into the system, we discovered that the existing event-driven architecture is deeply intertwined with the network synchronization logic.

## What Went Well

### 1. Clean PeerStateService Implementation

The [`PeerStateService`](packages/repo/src/peer-state-service.ts:9) class we created is well-designed:

- Simple, focused interface with [`isPeerConnected()`](packages/repo/src/peer-state-service.ts:21) and [`getConnectedPeers()`](packages/repo/src/peer-state-service.ts:30)
- Properly queries adapters directly for peer state
- No internal state duplication - acts as a true query layer

### 2. Successful Test Updates

We successfully updated the [`synchronizer-program.test.ts`](packages/repo/src/synchronizer-program.test.ts) to reflect the removal of peer tracking from the model, demonstrating that the pure TEA program can function without peer state.

### 3. Proper Dependency Injection

The [`Repo`](packages/repo/src/repo.ts:74) class properly instantiates and injects the PeerStateService into the SynchronizerServices, maintaining clean dependency flow.

## Critical Mistakes and Dead Ends

### 1. Underestimating Event-Driven Architecture

The most significant mistake was underestimating how deeply the event-driven architecture is embedded in the network synchronization system. The [`InProcessNetworkAdapter`](packages/repo/src/network/in-process-network-adapter.ts:17) relies on emitting "peer-candidate" events to establish connections, and the [`NetworkSubsystem`](packages/repo/src/network/network-subsystem.ts:12) was designed to propagate these events.

### 2. Incomplete Event Handling

When we removed event handling from the [`NetworkSubsystem`](packages/repo/src/network/network-subsystem.ts:31), we broke the peer discovery mechanism. The adapter events are not just notifications - they're integral to the connection establishment process.

### 3. Architectural Tension: Events vs Queries

We discovered a fundamental tension between:

- **Event-driven approach**: Proactive notifications when peer state changes
- **Query-based approach**: On-demand polling of peer state

The PeerStateService implements the latter, but the network adapters were designed for the former.

### 4. Testing Revealed Integration Issues

The failing test in [`repo.test.ts`](packages/repo/src/repo.test.ts:102) revealed that our changes broke network synchronization between repos. The test timed out because peer discovery was no longer working.

## Key Insights

### 1. Peer State is Not Just Information - It's Coordination

Peer state in this system isn't merely informational - it's coordinative. When a peer connects, it triggers a cascade of actions:

- Document announcements
- Synchronization requests
- State updates

### 2. Adapters Need Both Event Emission and State Querying

Network adapters need to both:

- Emit events to trigger actions (event-driven)
- Provide state querying capabilities (query-based)

### 3. The TEA Program Model Has Limits

While the TEA (The Elm Architecture) pattern works well for document state management, peer state management may not fit neatly into this model due to its inherently event-driven nature.

## Recommendations for Future Implementation

### 1. Hybrid Approach: Events + Queries

Instead of replacing events with queries, implement a hybrid approach:

- Keep events for triggering actions (peer connected/disconnected)
- Use PeerStateService for querying current state
- Ensure both systems stay in sync

### 2. Two-Phase Implementation

Consider a two-phase approach:

1. **Phase 1**: Keep existing events but add PeerStateService for state queries
2. **Phase 2**: Gradually migrate to query-based approach where appropriate

### 3. Adapter Interface Enhancement

Enhance the [`NetworkAdapter`](packages/repo/src/network/network-adapter.ts:19) interface to better support both paradigms:

- Keep event emission for coordination
- Add robust state querying capabilities
- Ensure consistency between evented state and queried state

### 4. Careful Test Design

Future implementations should include integration tests that specifically verify:

- Peer discovery works correctly
- Document synchronization between peers functions
- Event-driven and query-based approaches remain consistent

### 5. Consider the Use Case

The original problem was "Tried to send message to disconnected peer" warnings. This suggests that:

- The issue might be better solved with message filtering rather than state unification
- A simpler solution might be to check peer connectivity before sending messages
- The complexity of state unification may not be justified for this specific problem

## Conclusion

Our attempt revealed that unifying peer state storage is more complex than initially anticipated due to the deeply event-driven nature of the network architecture. The PeerStateService we created is sound, but integrating it requires careful consideration of how events and queries coexist.

A future implementation should embrace a hybrid approach that leverages the strengths of both paradigms rather than trying to replace one with the other. The key insight is that peer state management is not just about storing information - it's about coordinating distributed actions across the network.
