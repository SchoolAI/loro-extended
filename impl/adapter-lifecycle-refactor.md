# Adapter Lifecycle Refactor: Requirements & Implementation Guide

## Executive Summary

This document outlines a refactoring of the Adapter and Channel lifecycle to eliminate race conditions and improve developer experience. The core principle: **channels should only exist when they're ready to send/receive messages**.

## Problems Solved

### 1. Race Conditions
- **Async initialization**: Channels could be created before they were ready to use
- **Message ordering**: Messages could arrive before `channel.start()` was called
- **State inconsistency**: Multiple overlapping state concepts (lifecycle, connection, peer)

### 2. Complexity
- **Multi-phase lifecycle**: `onBeforeStart` → `onStart` → `channel.start()` → `lifecycle.onReady()`
- **Distributed buffering**: Each adapter had to implement message buffering
- **Unclear contracts**: When can channels be created? When can messages be sent?

### 3. Developer Experience
- **Confusing API**: Why both `onBeforeStart` and `onStart`?
- **Parameter passing**: Having to pass `addChannel` callbacks around
- **Error-prone**: Easy to call methods at the wrong time

## Core Design Principles

### Principle 1: Ready-on-Creation
**Channels should only be created when they're already connected and ready to use.**

```typescript
// ❌ Old way: Create then wait for ready
const channel = addChannel(context)
// ... later, asynchronously ...
channel.start(receive, lifecycle)
// ... later, asynchronously ...
lifecycle.onReady()  // Finally ready!

// ✅ New way: Only create when ready
await connection.connect()  // Adapter handles connection
const channel = this.addChannel(context)  // Already ready!
channel.send(message)  // Works immediately
```

### Principle 2: Lifecycle State Guards
**Enforce the adapter lifecycle contract with runtime guards.**

```typescript
// State progression:
created → initialized → started → stopped

// addChannel/removeChannel only work in "started" state
```

### Principle 3: Methods Over Parameters
**Make `addChannel` and `removeChannel` protected methods, not parameters.**

```typescript
// ❌ Old way: Parameters
async onStart({ addChannel, removeChannel }) {
  this.addChannel = addChannel  // Have to store
}

// ✅ New way: Methods
async onStart() {
  this.addChannel(context)  // Just use it
}
```

## New API Design

### Adapter Base Class

```typescript
type AdapterLifecycleState = 
  | "created"      // Constructor finished, not initialized
  | "initialized"  // _initialize() called, ready for onStart()
  | "started"      // onStart() completed, can manage channels
  | "stopped"      // onStop() called, no more channel operations

export abstract class Adapter<G> {
  readonly adapterId: AdapterId
  readonly logger: Logger
  readonly channels: ChannelDirectory<G>
  
  #lifecycleState: AdapterLifecycleState = "created"
  #onChannelAdded?: (channel: Channel) => void
  #onChannelRemoved?: (channel: Channel) => void

  constructor({ adapterId, logger }: AdapterParams) {
    this.adapterId = adapterId
    this.logger = logger ?? getLogger(["@loro-extended", "repo"])
    this.channels = new ChannelDirectory(this.generate.bind(this))
  }

  // ============================================================================
  // PROTECTED API - For Subclasses
  // ============================================================================

  /**
   * Create a channel. Only callable during "started" state.
   * The channel must be ready to send/receive immediately.
   */
  protected addChannel(context: G): Channel {
    this.#assertCanModifyChannels("addChannel")
    const channel = this.channels.create(context)
    this.#onChannelAdded?.(channel)
    return channel
  }

  /**
   * Remove a channel. Only callable during "started" state.
   */
  protected removeChannel(channelId: ChannelId): Channel | undefined {
    this.#assertCanModifyChannels("removeChannel")
    const channel = this.channels.remove(channelId)
    if (channel) {
      this.#onChannelRemoved?.(channel)
    }
    return channel
  }

  /**
   * Generate a BaseChannel for the given context.
   * The returned channel must be ready to use immediately.
   */
  protected abstract generate(context: G): BaseChannel

  /**
   * Start the adapter. Create initial channels here.
   * For dynamic adapters (servers), set up listeners that will
   * call addChannel() when new connections arrive.
   */
  abstract onStart(): Promise<void>

  /**
   * Stop the adapter. Clean up resources and remove channels.
   */
  abstract onStop(): Promise<void>

  // ============================================================================
  // INTERNAL API - For Synchronizer
  // ============================================================================

  _initialize(hooks: {
    onChannelAdded: (channel: Channel) => void
    onChannelRemoved: (channel: Channel) => void
  }): void {
    if (this.#lifecycleState !== "created") {
      throw new Error(`Adapter ${this.adapterId} already initialized`)
    }
    this.#onChannelAdded = hooks.onChannelAdded
    this.#onChannelRemoved = hooks.onChannelRemoved
    this.#lifecycleState = "initialized"
  }

  async _start(): Promise<void> {
    if (this.#lifecycleState !== "initialized") {
      throw new Error(
        `Cannot start adapter ${this.adapterId} in state ${this.#lifecycleState}`
      )
    }
    await this.onStart()
    this.#lifecycleState = "started"
  }

  async _stop(): Promise<void> {
    if (this.#lifecycleState !== "started") {
      this.logger.warn(`Stopping adapter in unexpected state`, {
        adapterId: this.adapterId,
        state: this.#lifecycleState
      })
    }
    await this.onStop()
    this.channels.reset()
    this.#lifecycleState = "stopped"
  }

  #assertCanModifyChannels(method: string): void {
    if (this.#lifecycleState === "created") {
      throw new Error(
        `${this.adapterId}.${method}() called before adapter was initialized. ` +
        `Channels can only be added/removed after onStart() is called.`
      )
    }
    if (this.#lifecycleState === "stopped") {
      throw new Error(
        `${this.adapterId}.${method}() called after adapter was stopped. ` +
        `Channels cannot be modified after onStop().`
      )
    }
  }
}
```

### Simplified Channel Interface

```typescript
/**
 * A BaseChannel is created by adapters and must be ready to use immediately.
 * No start() method, no lifecycle callbacks - just send and stop.
 */
export type BaseChannel = {
  kind: ChannelKind
  adapterId: AdapterId
  send: (msg: ChannelMsg) => void
  stop: () => void
}

/**
 * A Channel is a BaseChannel with identity added by the ChannelDirectory.
 */
export type Channel = BaseChannel & {
  channelId: ChannelId
  peer: { state: "unestablished" } | { state: "established", identity: ... }
  connectionState: "connected" | "disconnected" | "error"
}
```

### Synchronizer Integration

```typescript
class Synchronizer {
  constructor(params: SynchronizerParams) {
    // ... existing setup ...
    
    // Phase 1: Initialize all adapters
    for (const adapter of adapters) {
      adapter._initialize({
        onChannelAdded: this.channelAdded.bind(this),
        onChannelRemoved: this.channelRemoved.bind(this),
      })
    }
    
    // Phase 2: Start all adapters (now they can call addChannel)
    await Promise.all(adapters.map(a => a._start()))
  }

  channelAdded(channel: Channel) {
    // Channel is already ready - just add it and start using it
    this.#dispatch({ type: "msg/channel-added", channel })
  }

  async reset() {
    // Stop all adapters
    await Promise.all(this.adapters.adapters.map(a => a._stop()))
    
    const [initialModel] = programInit(this.model.identity)
    this.model = initialModel
  }
}
```

### Synchronizer Program Changes

```typescript
// In synchronizer-program.ts
case "msg/channel-added": {
  // Channel is already ready - just add it and use it
  model.channels.set(msg.channel.channelId, msg.channel)
  
  // Set up receive handler immediately
  msg.channel.onReceive = (message) => {
    return {
      type: "cmd/dispatch",
      dispatch: {
        type: "msg/channel-receive-message",
        envelope: { fromChannelId: msg.channel.channelId, message }
      }
    }
  }
  
  // Send establish request immediately
  return {
    type: "cmd/send-message",
    envelope: {
      toChannelIds: [msg.channel.channelId],
      message: { 
        type: "channel/establish-request", 
        identity: current(model.identity) 
      }
    }
  }
}

case "msg/channel-removed": {
  // Stop the channel
  const channel = model.channels.get(msg.channel.channelId)
  if (channel) {
    channel.stop()
  }
  
  // Remove from model
  model.channels.delete(msg.channel.channelId)
  
  // Remove from all document states
  for (const docState of model.documents.values()) {
    docState.channelState.delete(msg.channel.channelId)
  }
  
  return
}
```

## Implementation Examples

### Storage Adapter (Static Channel)

```typescript
export class InMemoryStorageAdapter extends Adapter<void> {
  private channel?: Channel
  private storage = new Map<DocId, Uint8Array[]>()

  async onStart() {
    // Create the storage channel immediately (it's always "ready")
    this.channel = this.addChannel(undefined)
  }

  async onStop() {
    if (this.channel) {
      this.removeChannel(this.channel.channelId)
      this.channel = undefined
    }
  }

  protected generate(): BaseChannel {
    return {
      kind: "storage",
      adapterId: this.adapterId,
      send: async (msg: ChannelMsg) => {
        // Handle storage operations
        if (msg.type === "channel/sync-request") {
          // Load from storage and respond
        }
      },
      stop: () => {
        // Cleanup if needed
      }
    }
  }
}
```

### SSE Server Adapter (Dynamic Channels)

```typescript
export class SseServerNetworkAdapter extends Adapter<PeerId> {
  private server?: http.Server
  private channelsByPeer = new Map<PeerId, ChannelId>()
  private clients = new Map<PeerId, Response>()

  async onStart() {
    // Set up server to listen for connections
    this.server = http.createServer()
    
    this.server.on('request', async (req, res) => {
      if (req.url?.startsWith('/events')) {
        await this.handleSseConnection(req, res)
      }
    })
    
    await new Promise<void>((resolve) => {
      this.server!.listen(3000, resolve)
    })
  }

  private async handleSseConnection(req: Request, res: Response) {
    const peerId = req.query.peerId as PeerId
    
    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })
    res.flushHeaders()
    
    // Store client connection
    this.clients.set(peerId, res)
    
    // Connection is ready - create channel now
    const channel = this.addChannel(peerId)
    this.channelsByPeer.set(peerId, channel.channelId)
    
    // Handle disconnect
    req.on('close', () => {
      this.handleDisconnect(peerId)
    })
  }

  private handleDisconnect(peerId: PeerId) {
    const channelId = this.channelsByPeer.get(peerId)
    if (channelId) {
      this.removeChannel(channelId)
      this.channelsByPeer.delete(peerId)
    }
    this.clients.delete(peerId)
  }

  async onStop() {
    // Close all client connections
    for (const res of this.clients.values()) {
      res.end()
    }
    this.clients.clear()
    
    // Remove all channels
    for (const channelId of this.channelsByPeer.values()) {
      this.removeChannel(channelId)
    }
    this.channelsByPeer.clear()
    
    // Close server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve())
      })
    }
  }

  protected generate(peerId: PeerId): BaseChannel {
    return {
      kind: "network",
      adapterId: this.adapterId,
      send: (msg: ChannelMsg) => {
        const client = this.clients.get(peerId)
        if (client) {
          client.write(`data: ${JSON.stringify(msg)}\n\n`)
        }
      },
      stop: () => {
        const client = this.clients.get(peerId)
        if (client) {
          client.end()
        }
      }
    }
  }
}
```

### Bridge Adapter (Event-Driven)

```typescript
export class BridgeAdapter extends Adapter<InlineContext> {
  private unsubscribes: (() => void)[] = []
  private channelsByAdapter = new Map<AdapterId, ChannelId>()

  async onStart() {
    // Register with bridge
    this.bridge.addAdapter(this)
    
    // Set up event listeners for dynamic channel creation
    this.unsubscribes.push(
      this.bridge.on("adapter-added", ({ adapterId }) => {
        if (adapterId !== this.adapterId) {
          this.handleAdapterAdded(adapterId)
        }
      })
    )

    this.unsubscribes.push(
      this.bridge.on("adapter-removed", ({ adapterId }) => {
        this.handleAdapterRemoved(adapterId)
      })
    )

    // Create channels for existing adapters
    for (const adapterId of this.bridge.adapterIds) {
      if (adapterId !== this.adapterId) {
        this.handleAdapterAdded(adapterId)
      }
    }

    // Announce ourselves to the bridge
    this.bridge.announceAdapterAdded(this.adapterId)
  }

  private handleAdapterAdded(adapterId: AdapterId) {
    if (this.channelsByAdapter.has(adapterId)) {
      return  // Already have a channel
    }

    const channel = this.addChannel({
      send: (msg: ChannelMsg) => {
        this.bridge.send(adapterId, msg)
      },
      subscribe: (fn: (msg: ChannelMsg) => void) => {
        return this.bridge.subscribe(this.adapterId, fn)
      }
    })

    this.channelsByAdapter.set(adapterId, channel.channelId)
  }

  private handleAdapterRemoved(adapterId: AdapterId) {
    const channelId = this.channelsByAdapter.get(adapterId)
    if (channelId) {
      this.removeChannel(channelId)
      this.channelsByAdapter.delete(adapterId)
    }
  }

  async onStop() {
    // Clean up event listeners
    for (const unsub of this.unsubscribes) {
      unsub()
    }
    this.unsubscribes = []

    // Remove all channels
    for (const channelId of this.channelsByAdapter.values()) {
      this.removeChannel(channelId)
    }
    this.channelsByAdapter.clear()

    // Announce removal and unregister
    this.bridge.announceAdapterRemoved(this.adapterId)
    this.bridge.removeAdapter(this.adapterId)
  }

  protected generate(context: InlineContext): BaseChannel {
    return {
      kind: "network",
      adapterId: this.adapterId,
      send: context.send,
      stop: () => {
        // Cleanup handled in onStop
      }
    }
  }
}
```

## Migration Guide

### Step 1: Update Adapter Base Class
- Add lifecycle state tracking
- Implement `addChannel` and `removeChannel` as protected methods
- Add `_initialize`, `_start`, `_stop` internal methods
- Remove `onBeforeStart` (merge into `onStart`)
- Rename `onAfterStop` to `onStop`

### Step 2: Update Channel Interface
- Remove `start()` method from BaseChannel
- Remove `ChannelLifecycle` callbacks
- Channels are ready immediately upon creation

### Step 3: Update Synchronizer
- Call `adapter._initialize()` for all adapters
- Call `adapter._start()` for all adapters (can be async)
- Remove `cmd/start-channel` command
- Simplify `msg/channel-added` handler

### Step 4: Update Synchronizer Program
- Remove channel start logic
- Channels are ready when added to model
- Remove message queueing (not needed)

### Step 5: Update Each Adapter
- Merge `onBeforeStart` logic into `onStart`
- Remove parameter storage (use `this.addChannel` directly)
- Ensure channels are only created when ready
- Update `generate()` to return ready channels

### Step 6: Update Tests
- Remove fake timers for channel initialization
- Channels are ready immediately
- Simpler test setup

## Benefits Summary

### Correctness
✅ Eliminates race conditions through ready-on-creation principle
✅ Enforces lifecycle contract with runtime guards
✅ Clear state transitions with validation

### Developer Experience
✅ Simpler API: just `onStart()` and `onStop()`
✅ Methods over parameters: `this.addChannel()` everywhere
✅ Clear error messages when used incorrectly
✅ Natural async support

### Maintainability
✅ Less code overall
✅ Clearer responsibilities
✅ Easier to test
✅ Better documentation

## Testing Strategy

### Unit Tests
- Test lifecycle state transitions
- Test guard assertions (calling methods at wrong time)
- Test each adapter in isolation

### Integration Tests
- Test adapter + synchronizer interaction
- Test channel creation and removal
- Test message flow

### E2E Tests
- Test multi-repo synchronization
- Test dynamic channel creation/removal
- Test error handling

## Rollout Plan

1. **Phase 1**: Implement new Adapter base class (backward compatible)
2. **Phase 2**: Update Synchronizer to use new lifecycle
3. **Phase 3**: Migrate adapters one by one
4. **Phase 4**: Remove old lifecycle code
5. **Phase 5**: Update documentation and examples

## Success Criteria

- ✅ All tests pass
- ✅ No race conditions in e2e tests
- ✅ Simpler adapter implementations
- ✅ Clear error messages for misuse
- ✅ Documentation updated

---

## Implementation Progress Notes (2025-11-15)

### Current Test Status

Please note that we have 5 failing tests, even before beginning this refactor:



### Incremental Migration Approach

During implementation, we discovered that a "big bang" refactor was too risky. Instead, we adopted an **incremental migration strategy**:

1. **Migration Marker**: Added `usesNewLifecycle` getter to `Adapter` base class (defaults to `false`)
2. **Dual Lifecycle Support**: `Synchronizer` checks this marker and routes to appropriate lifecycle methods
3. **Backward Compatibility**: Old adapters continue working while new ones are migrated one at a time

### Key Learnings About Adapter Reuse

**Problem**: Tests commonly reuse adapter instances across multiple `Repo` instances without explicit cleanup:

```typescript
const storage = new InMemoryStorageAdapter()
const repo1 = new Repo({ adapters: [storage] })
// ... repo1 goes out of scope ...
const repo2 = new Repo({ adapters: [storage] }) // Reuses same adapter!
```

**Solutions Attempted**:
1. ❌ **Async initialization with stop/reset**: Made `_initialize()` async to stop before reinitializing
   - Problem: Created race conditions, tests timed out
2. ✅ **Synchronous cleanup on reinit**: Clean up old channels when `_initialize()` is called on running adapter
   - Status: Partially working but still has timing issues

### Architectural Tension: Sync Constructors vs Async Adapters

The core tension:
- **Synchronous construction**: `Repo`/`Synchronizer` constructors must be sync for ease of use
- **Asynchronous adapters**: Network/storage adapters often need async initialization

**Current Compromise**:
- Adapters start asynchronously after construction (`void adapter._startNew()`)
- Channels signal readiness via lifecycle callbacks
- Tests use `waitForStorage()`/`waitForNetwork()` to wait for readiness

**Remaining Challenge**: When adapters are reused, async start happens again, but test's `waitFor*()` might happen before channel is ready.

### Recommendations for Future Work

1. **Explicit Adapter Lifecycle Management**:
   - Make `Repo` responsible for adapter cleanup
   - Or implement ref-counting for shared adapters
   - Or require explicit `adapter.reset()` between uses

2. **Simplify Async Initialization**:
   - Keep initialization synchronous
   - Allow channels to become ready asynchronously after creation
   - Ensure `waitFor*()` methods wait for channel readiness, not just existence

3. **Test Patterns**:
   - Discourage adapter reuse in tests (create new instances)
   - Or provide test utilities that properly clean up adapters
   - Document expected lifecycle for adapter reuse

4. **Channel Readiness**:
   - "Ready-on-creation" principle is sound but needs careful implementation
   - Channels should only be created when underlying transport is ready
   - Storage: ready immediately; Network: ready after connection established

### Current Status

**Test Results**: 89 passing, 9 failing
- 4 pre-existing failures (unrelated to refactor)
- 5 new failures: storage persistence tests timing out due to adapter reuse

**Next Steps**:
1. Resolve adapter reuse timing issues
2. Complete migration of remaining adapters
3. Remove old lifecycle code
4. Update documentation with lessons learned