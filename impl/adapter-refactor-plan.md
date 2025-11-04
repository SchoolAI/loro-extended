# Refactoring the Adapter API for Improved Developer Experience

**Date:** 2025-11-12
**Author:** Roo
**Status:** Revised

## 1. Overview and Motivation

This document outlines a plan to refactor the `@loro-extended/repo` `Adapter` API. The primary motivation is to improve the developer experience (DevX), increase architectural robustness, and resolve a race condition bug discovered in the `SseServerNetworkAdapter`.

The current API suffers from a confusing lifecycle and an inversion of control problem, where adapters with complex, asynchronous setup (like a network server) have to perform internal gymnastics to coordinate with the `Synchronizer`. This led directly to a bug in the `todo-app` example where the server channel would attempt to send a message before its underlying transport (the Express `res` object) was ready.

This refactor will establish a clear, decoupled, and predictable pattern for how adapters interact with the `Synchronizer` core, putting the developer back in control and making the system easier to reason about.

## 2. The Proposed Architecture: Dependency Injection via `setHooks`

The new architecture is based on the **Dependency Injection** pattern. The `Synchronizer` will inject a single, comprehensive `AdapterHooks` object into each `Adapter` instance during initialization. This decouples the adapters from the `Synchronizer`, as they will only interact through a small, well-defined interface.

### 2.1. Key Components

#### `AdapterHooks` Interface
A new generic interface will define the complete contract between the `Adapter` and the `Synchronizer`.

```typescript
// packages/repo/src/adapter/types.ts
export interface AdapterHooks<G = unknown> {
  /**
   * Creates a new channel using the adapter's internal `generate` method,
   * registers it with the Synchronizer, and returns a handle with
   * `activate()` and `disconnect()` lifecycle methods.
   */
  createChannel: (context: G) => ChannelWithLifecycle;

  /** Notifies the Synchronizer that a channel has been added. */
  channelAdded: (channel: Channel) => void;

  /** Notifies the Synchronizer that a channel has been removed. */
  channelRemoved: (channel: Channel) => void;
}

export interface ChannelWithLifecycle extends Channel {
  /** Signals to the Synchronizer that this channel is ready for communication. */
  activate: () => void;
  /** Signals to the Synchronizer that this channel is disconnected. */
  disconnect: () => void;
}
```

#### `Adapter` Base Class
The base class will be modified to receive and store the injected hooks via a new `setHooks` method.

```typescript
// packages/repo/src/adapter/adapter.ts
export abstract class Adapter<G> {
  protected hooks: AdapterHooks<G> | undefined;
  public readonly channels: ChannelDirectory<G>;

  constructor() {
    this.channels = new ChannelDirectory(this.generate.bind(this));
  }

  /**
   * @internal - Called by the Synchronizer to inject dependencies.
   */
  public setHooks(hooks: AdapterHooks<G>): void {
    this.hooks = hooks;
    // Pass the relevant hooks down to the adapter's own channel directory
    this.channels.setHooks({
      channelAdded: hooks.channelAdded,
      channelRemoved: hooks.channelRemoved,
    });
  }

  // ... other abstract methods (onStart, onStop, generate, etc.)
}
```

#### `Synchronizer`
The `Synchronizer` is responsible for creating and injecting the hooks. It constructs a unique set of hooks for each adapter.

```typescript
// packages/repo/src/synchronizer.ts
export class Synchronizer {
  constructor(config: RepoConfig) {
    // ...
    for (const adapter of this.adapters) {
      const adapterHooks: AdapterHooks = {
        // This `createChannel` function is the core of the new API.
        // It's a closure that captures both the specific `adapter` and the `synchronizer` (this).
        createChannel: (context: unknown) => {
          // 1. Delegate creation to the adapter's own ChannelDirectory.
          //    This preserves the adapter's specific setup logic (via `generate`).
          const channel = adapter.channels.create(context);

          // 2. Immediately register the channel with the Synchronizer's central model.
          //    The channel is known to the system but is not yet "active".
          this.addChannel(channel);

          // 3. Enhance the channel with `activate` and `disconnect` methods.
          //    These methods are bound to the Synchronizer, allowing the adapter
          //    to trigger state changes from the outside.
          const channelWithLifecycle: ChannelWithLifecycle = {
            ...channel,
            activate: () => this.activateChannel(channel.channelId),
            disconnect: () => this.disconnectChannel(channel.channelId),
          };
          
          return channelWithLifecycle;
        },
        // Pass bound methods for channel directory management as before.
        channelAdded: this.channelAdded.bind(this),
        channelRemoved: this.channelRemoved.bind(this),
      };

      adapter.setHooks(adapterHooks);
    }
    // ...
  }
}
```

#### `ChannelDirectory`
The `ChannelDirectory` is simplified. Its responsibility is to A) create the raw channel object using the adapter's `generate` function and B) call the `channelAdded`/`channelRemoved` hooks, which are now passed in from the adapter.

```typescript
// packages/repo/src/channel-directory.ts
export class ChannelDirectory<G> {
  private channelAdded?: (channel: Channel) => void;
  private channelRemoved?: (channel: Channel) => void;

  constructor(readonly generate: GenerateFn<G>) {}

  public setHooks(hooks: {
    channelAdded: (channel: Channel) => void;
    channelRemoved: (channel: Channel) => void;
  }) {
    this.channelAdded = hooks.channelAdded;
    this.channelRemoved = hooks.channelRemoved;
  }
  
  public create(context: G): Channel {
    const channelId = generateChannelId();
    // The `generate` function is provided by the specific Adapter subclass.
    const channel: Channel = Object.assign(this.generate(context), {
      channelId,
      // ... other core properties
    });

    this.channels.set(channelId, channel);
    this.channelAdded?.(channel); // Notify that a channel was created
    return channel;
  }
}
```

### 2.2. "After" Example: `SseServerNetworkAdapter` Integration
This architecture provides a clean, injectable toolkit. The adapter developer no longer needs to implement `onBeforeStart` for channel creation; instead, they will use the injected `hooks.createChannel`.

```typescript
// examples/todo-app/src/server/server.ts (Reimagined)
const sseAdapter = new SseServerNetworkAdapter();
const repo = new Repo({ adapters: [sseAdapter, /*...*/] });

const router = express.Router();

router.get("/events/:peerId", (req, res) => {
  // Gracefully handle requests made before the repo is fully initialized.
  if (!sseAdapter.hooks) {
    res.status(503).send("Service Unavailable: Loro Repo not ready");
    return;
  }
  
  // 1. The adapter's public method now uses the injected hook to create a channel.
  //    The context passed to `createChannel` is specific to this adapter's needs.
  const channel = sseAdapter.setupSseConnection(req, res, req.params.peerId);
  
  // 2. The developer now has full control and explicitly activates the channel
  //    only when the underlying transport (the `res` object) is ready.
  channel.activate();

  // 3. The developer is also responsible for cleanup.
  req.on("close", () => channel.disconnect());
});

app.use("/loro", router);
```

This pattern puts the developer in full control of their routes, middleware, and the channel lifecycle, making the system's behavior explicit and structurally preventing the original race condition.

## 3. Implementation Steps

1.  **`@loro-extended/repo`:**
    1.  Define the generic `AdapterHooks<G>` and `ChannelWithLifecycle` interfaces in `packages/repo/src/adapter/types.ts`.
    2.  Update the `Adapter` base class in `packages/repo/src/adapter/adapter.ts` to include the `setHooks` method and `hooks` property. The old `onBeforeStart` will be removed or refactored on a per-adapter basis.
    3.  Modify the `Synchronizer` constructor to create and inject the consolidated `AdapterHooks` object for each adapter, as detailed in the example above.
    4.  Update `ChannelDirectory` to receive its hooks from the `Adapter`'s `setHooks` method.
    5.  Implement `synchronizer.activateChannel(channelId)` to dispatch `msg/channel-ready` and `disconnectChannel` to dispatch `msg/channel-disconnected`.

2.  **`@loro-extended/adapters`:**
    1.  Refactor `SseServerNetworkAdapter`:
        *   Remove `getExpressRouter()`.
        *   Add a public `setupSseConnection` method that internally calls `this.hooks.createChannel()` and returns the resulting `ChannelWithLifecycle`.
        *   Add a public `handleSyncMessage` method for the POST endpoint.
        *   Remove its `onBeforeStart` implementation.
    2.  Review and update other adapters (`SseClient`, `IndexedDB`, `LevelDB`, `BridgeAdapter`) to align with the new pattern. Simple adapters like storage will likely call `this.hooks.createChannel(...).activate()` immediately within their `onStart` method.

3.  **`examples/todo-app`:**
    1.  Update `src/server/server.ts` to use the new adapter API as detailed in section 2.2.

4.  **Testing:**
    1.  Update all relevant unit and end-to-end tests to reflect the API changes.
    2.  Add a new test specifically for the `SseServerNetworkAdapter` to verify that the race condition is resolved and that manual activation works as expected.

## 4. Alternatives Considered

1.  **`manualActivation` Flag:**
    *   **Description:** Add a boolean flag, e.g., `manualActivation: true`, to the `Adapter` class. The `Synchronizer` would check this flag and, if true, would defer calling `onReady` until a public method like `synchronizer.activateChannel()` was called.
    *   **Why Rejected:** While simpler to implement, it's a less elegant form of inversion of control. It creates a "special case" behavior in the `Synchronizer` that is less discoverable and more "magical" than the explicit dependency injection pattern.

2.  **Simple Patch:**
    *   **Description:** Add a small `setTimeout` or similar hack inside the `SseServerNetworkAdapter` to delay the `onReady` call, hoping the `res` object would be available by then.
    *   **Why Rejected:** This is a brittle, non-deterministic solution that doesn't address the underlying architectural flaw. It would be prone to failure under different load conditions and fails to improve the developer experience.

By proceeding with the `setHooks` pattern, we choose a robust, scalable, and developer-friendly architecture over less-ideal alternatives.