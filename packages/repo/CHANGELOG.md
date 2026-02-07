# @loro-extended/repo

## 5.4.2

### Patch Changes

- Updated dependencies
  - @loro-extended/change@5.4.2

## 5.4.1

### Patch Changes

- Updated dependencies [e1588f2]
  - @loro-extended/change@5.4.1

## 5.4.0

### Minor Changes

- b2614e6: BridgeAdapter now delivers messages asynchronously via `queueMicrotask()` to better simulate real network adapter behavior.

  This change ensures that tests using BridgeAdapter exercise the same async codepaths as production adapters (WebSocket, SSE, etc.), helping catch race conditions and async state management bugs that would otherwise only surface in production.

  **Migration**: Tests using BridgeAdapter should use `waitForSync()` or `waitUntilReady()` to await synchronization:

  ```typescript
  // Before (may have worked due to synchronous delivery)
  handleA.change((draft) => {
    draft.text.insert(0, "hello");
  });
  expect(handleB.doc.toJSON().text).toBe("hello");

  // After (correct async pattern)
  handleA.change((draft) => {
    draft.text.insert(0, "hello");
  });
  await handleB.waitForSync();
  expect(handleB.doc.toJSON().text).toBe("hello");
  ```

  Most existing tests already follow this pattern and will continue to work without changes.

### Patch Changes

- cab74a3: Externalize `loro-crdt` from bundle output to fix Bun compatibility

  Added `external: ["loro-crdt"]` to tsup configs for all core packages. This prevents `loro-crdt` from being bundled into the dist output, allowing bundlers like Bun to resolve it separately and handle WASM initialization correctly.

  This fixes the `examples/todo-minimal` example which uses Bun's bundler and was failing due to top-level await issues when `loro-crdt` was bundled inline.

- Updated dependencies [cab74a3]
- Updated dependencies [e66f01c]
- Updated dependencies [cf2b22c]
- Updated dependencies [0266dfb]
  - @loro-extended/change@5.4.0

## 5.3.0

### Minor Changes

- c97a468: Add send interceptor pattern to Adapter base class

  Adapters now support a middleware-style interceptor chain for outgoing messages. This enables:

  - Simulating network conditions (delay, packet loss)
  - Debugging message flow
  - Testing message sequences

  ```typescript
  // Delay all messages by 3 seconds
  const unsubscribe = adapter.addSendInterceptor((ctx, next) => {
    setTimeout(next, 3000);
  });

  // Drop 10% of messages
  adapter.addSendInterceptor((ctx, next) => {
    if (Math.random() > 0.1) next();
  });

  // Log all messages
  adapter.addSendInterceptor((ctx, next) => {
    console.log("Sending:", ctx.envelope.message.type);
    next();
  });

  // Remove interceptor
  unsubscribe();

  // Clear all interceptors
  adapter.clearSendInterceptors();
  ```

### Patch Changes

- @loro-extended/change@5.3.0

## 5.2.0

### Patch Changes

- 6048f48: Remove lodash-es dependency to fix "WeakMap is not a constructor" error in Next.js with Turbopack

  The bundled lodash-es code used `Function("return this")()` for global detection, which breaks under Turbopack's strict mode handling. Replaced with a native `omit` helper function.

- Updated dependencies [6b074ee]
- Updated dependencies [7414993]
- Updated dependencies [408c543]
  - @loro-extended/change@5.2.0

## 5.1.0

### Patch Changes

- @loro-extended/change@5.1.0

## 5.0.0

### Patch Changes

- f254aa2: Fix LoroDoc PeerID to match Repo identity

  Previously, each LoroDoc created by the Repo had a random PeerID instead of the Repo's `identity.peerId`. This caused issues with:

  1. **UndoManager behavior** - While the UndoManager still worked correctly (each LoroDoc had its own unique PeerID), the PeerID didn't match the Repo's identity, making debugging difficult.

  2. **Change attribution** - Changes in the oplog were attributed to random PeerIDs instead of the Repo's identity.

  3. **External tools** - Tools that rely on PeerID matching the Repo's identity would not work correctly.

  Now, `createDocState` requires a `peerId` parameter, and all handlers pass `model.identity.peerId` when creating documents. This ensures that:

  - `handle.loroDoc.peerId` matches `repo.identity.peerId`
  - All documents created by the same Repo have the same PeerID
  - UndoManager correctly identifies local vs remote changes
  - Changes are properly attributed in the oplog

- Updated dependencies [9a8048b]
- Updated dependencies [cb7e307]
- Updated dependencies [6e49a81]
  - @loro-extended/change@5.0.0

## 4.0.0

### Major Changes

- 14b9193: BREAKING: Remove deprecated `waitForNetwork()` and `waitForStorage()` methods from Handle

  These methods had a critical bug: they only resolved when a peer had data (`state === "loaded"`), but would hang forever if the peer confirmed it didn't have the document (`state === "absent"`).

  **Migration:**

  Replace:

  ```typescript
  await handle.waitForNetwork();
  await handle.waitForStorage();
  ```

  With:

  ```typescript
  await handle.waitForSync({ kind: "network" }); // or just waitForSync() since network is default
  await handle.waitForSync({ kind: "storage" });
  ```

  **Benefits of `waitForSync()`:**

  - Resolves when peer has data OR confirms document doesn't exist
  - Enables the "initializeIfEmpty" pattern correctly
  - Has configurable timeout (default 30s, set to 0 to disable)
  - Supports AbortSignal for cancellation
  - Throws `NoAdaptersError` if no adapters of requested kind exist
  - Throws `SyncTimeoutError` on timeout with diagnostic context

### Minor Changes

- 37cdd5e: Add storage-first sync coordination and remove eager loading

  **Problem:**
  When a server has both network (WebSocket) and storage (LevelDB) adapters, network sync-requests were answered BEFORE storage had loaded the document data. This caused clients to incorrectly believe documents were empty, leading to duplicate initialization (e.g., two root nodes in a tree).

  **Solution: Storage-First Sync + Lazy Loading**

  We implemented two complementary changes:

  1. **Storage-First Sync**: Network sync-requests for unknown documents now wait for all storage adapters to be consulted before responding.

  2. **Lazy Loading**: Removed eager loading from `StorageAdapter`. Documents are now loaded on-demand when network clients request them, rather than all at once on startup.

  **Benefits of Lazy Loading:**

  - Scales to millions of documents
  - Reduces startup time
  - Avoids race conditions with eager loading
  - Memory efficient - only loads requested documents

  **How Storage-First Sync Works:**

  1. When a network request arrives for an unknown document with storage adapters present:

     - Create the document with `pendingStorageChannels` tracking which storage adapters to wait for
     - Queue the network request in `pendingNetworkRequests`
     - Send sync-request to all storage adapters
     - Don't respond to network yet

  2. When storage responds:

     - Remove from `pendingStorageChannels`
     - If all storage has responded, process all queued network requests

  3. When storage sends a bidirectional sync-request:
     - Create the document with `pendingStorageChannels` tracking the storage channel
     - Respond to storage immediately and send reciprocal sync-request
     - Queue any network requests that arrive before storage responds with data

  **Key Design Decisions:**

  - No new protocol transmission types - single sync-response to network
  - Wait for ALL storage adapters - any storage might have the document
  - Fully synchronous - fits the TEA (The Elm Architecture) pattern
  - Handles edge cases: storage disconnect, multiple network requests, etc.

  **New Types:**

  ```typescript
  type DocState = {
    // ... existing fields ...
    pendingStorageChannels?: Set<ChannelId>;
    pendingNetworkRequests?: PendingNetworkRequest[];
  };
  ```

  **Files Changed:**

  - `types.ts` - Added `pendingStorageChannels` and `pendingNetworkRequests` to DocState
  - `storage-adapter.ts` - Removed `requestStoredDocuments()` call from `handleEstablishRequest()` (lazy loading)
  - `handle-sync-request.ts` - Queue network requests when storage adapters exist; track pending state for bidirectional storage requests
  - `handle-sync-response.ts` - Process pending requests when storage responds
  - `handle-channel-removed.ts` - Clean up pending state on disconnect
  - New utility: `get-storage-channel-ids.ts`
  - New test file: `storage-first-sync.test.ts` (9 tests)

- c3e5d1f: Add `waitForSync()` method with timeout and AbortSignal support

  **New Features:**

  - `handle.waitForSync()` - Wait for sync completion with network or storage peers
  - Accepts both "loaded" (peer has data) and "absent" (peer confirmed no data) states
  - Configurable timeout (default 30s, set to 0 to disable)
  - AbortSignal support for cancellation
  - Enriched error context in `SyncTimeoutError` and `NoAdaptersError`

  **Breaking Changes:**

  - None - `waitForNetwork()` and `waitForStorage()` are deprecated but still work

  **Bug Fixes:**

  - Fixed race condition where `waitForSync()` couldn't detect adapter kind before channels were created
  - Added `kind` property to `Adapter` base class (default: "network")
  - `StorageAdapter` now overrides `kind` to "storage"
  - Added `channels` property to `ReadyStateAbsent` type for consistent channel checking

  **Usage:**

  ```typescript
  // Wait for network sync (default)
  await handle.waitForSync();

  // Wait for storage sync
  await handle.waitForSync({ kind: "storage" });

  // Custom timeout
  await handle.waitForSync({ timeout: 5000 });

  // Cancellable
  const controller = new AbortController();
  await handle.waitForSync({ signal: controller.signal });

  // initializeIfEmpty pattern now works correctly
  await handle.waitForSync();
  if (handle.loroDoc.opCount() === 0) {
    initializeDocument(handle);
  }
  ```

### Patch Changes

- Updated dependencies [587efb3]
- Updated dependencies [73f7b32]
- Updated dependencies [64e81c1]
  - @loro-extended/change@4.0.0

## 3.0.0

### Major Changes

- 702871b: **BREAKING CHANGE**: Replace `rules` API with `permissions` and `middleware`

  The `rules` configuration option has been replaced with a new two-layer architecture:

  ### Migration Guide

  **Before:**

  ```typescript
  const repo = new Repo({
    rules: {
      canReveal: (ctx) => ctx.docId.startsWith("public/"),
      canUpdate: (ctx) => ctx.peerType !== "bot",
      canCreate: (ctx) => ctx.peerType === "user",
      canDelete: (ctx) => ctx.peerType === "service",
    },
  });
  ```

  **After:**

  ```typescript
  const repo = new Repo({
    permissions: {
      visibility: (doc, peer) => doc.id.startsWith("public/"),
      mutability: (doc, peer) => peer.peerType !== "bot",
      creation: (docId, peer) => peer.peerType === "user",
      deletion: (doc, peer) => peer.peerType === "service",
    },
  });
  ```

  ### Key Changes

  1. **Renamed options:**

     - `rules` → `permissions`
     - `canReveal` → `visibility`
     - `canUpdate` → `mutability`
     - `canCreate` → `creation`
     - `canDelete` → `deletion`

  2. **New function signature:**

     - Old: `(ctx: RuleContext) => boolean`
     - New: `(doc: DocContext, peer: PeerContext) => boolean`
     - Document and peer context are now separate parameters

  3. **Removed `canBeginSync`:**

     - This rule was never implemented and has been removed

  4. **New middleware layer:**
     - For async operations (external auth, rate limiting, audit logging)
     - See `docs/middleware.md` for details

  ### New Features

  - **Middleware support**: Async operations like external auth services, rate limiting, and audit logging
  - **Cleaner API**: Separated document and peer context for better ergonomics
  - **Deletion now enforced**: The `deletion` permission is now actually checked (was never implemented before)

### Minor Changes

- 786b8b1: ### Added `channel/batch` message type for transport optimization

  Introduced a new `channel/batch` message type that wraps multiple channel messages into a single network transmission. This enables:

  - **Uniform message structure**: All message types now have a single `docId` subject (refactored `ChannelMsgSyncRequest` from multi-doc to single-doc format)
  - **Heartbeat efficiency**: Reduced heartbeat messages from O(docs × peers) to O(peers) by batching ephemeral messages per peer
  - **Generic batching**: Any `BatchableMsg` can be wrapped in a `channel/batch` for transport optimization

  ### Rate limiter behavior with batched messages

  The rate limiter operates at the **network packet level** - a `channel/batch` message counts as one rate limit hit, preserving atomic all-or-nothing behavior. This means:

  - A batch of 10 sync-requests counts as 1 message for rate limiting purposes
  - If a batch is rate-limited, all messages in the batch are rejected together
  - This matches the previous behavior where a multi-doc sync-request was atomic

  ### New types

  - `BatchableMsg` - Union of message types that can be batched
  - `ChannelMsgBatch` - Wrapper type for batched messages
  - `SyncRequestDoc` - Type for docs array used by `cmd/send-sync-request`

  ### New command

  - `cmd/broadcast-ephemeral-batch` - Sends multiple docs' ephemeral data in one batched message per peer

- cf064fa: Improve Repo DevX with optional identity, optional adapters, and dynamic adapter management

  ### New Features

  - **Optional Identity**: `identity` parameter is now optional with sensible defaults

    - `peerId` auto-generated if not provided
    - `name` is now optional (undefined is fine)
    - `type` defaults to "user"

  - **Optional Adapters**: `adapters` parameter is now optional (defaults to empty array)

  - **Dynamic Adapter Management**: Add and remove adapters at runtime

    - `repo.addAdapter(adapter)` - Add an adapter (idempotent)
    - `repo.removeAdapter(adapterId)` - Remove an adapter (idempotent)
    - `repo.hasAdapter(adapterId)` - Check if adapter exists
    - `repo.getAdapter(adapterId)` - Get adapter by ID
    - `repo.adapters` - Get all current adapters

  - **Adapter IDs**: Each adapter now has a unique `adapterId`
    - Auto-generated as `{adapterType}-{uuid}` if not provided
    - Can be explicitly set via constructor parameter

  ### API Examples

  ```typescript
  // Minimal - all defaults
  const repo = new Repo();

  // Just adapters
  const repo = new Repo({ adapters: [storageAdapter] });

  // Partial identity
  const repo = new Repo({
    identity: { type: "service" },
  });

  // Add adapters dynamically
  await repo.addAdapter(networkAdapter);

  // Remove when done
  await repo.removeAdapter(networkAdapter.adapterId);
  ```

  ### Breaking Changes

  None - all changes are backwards compatible.

- 1b2a3a4: Enhanced RuleContext with full peer identity information

  ### Changes

  The `RuleContext` type now includes complete peer identity information for more robust permission rules:

  - **`peerId`** (new): Unique peer identifier - use this for reliable identity checks
  - **`peerType`** (new): `"user" | "bot" | "service"` - use for role-based permissions
  - **`peerName`** (changed): Now optional (`string | undefined`) - human-readable label only

  ### Migration

  If your rules use `peerName`, consider migrating to `peerId` or `peerType`:

  ```typescript
  // Before (fragile - relies on name which is now optional)
  canUpdate: (ctx) => ctx.peerName === "admin";

  // After (robust - uses unique identifier or type)
  canUpdate: (ctx) => ctx.peerId === "admin-123" || ctx.peerType === "service";
  ```

  ### Breaking Changes

  - `RuleContext.peerName` is now `string | undefined` instead of `string`
  - Rules that depend on `peerName` should check for undefined or migrate to `peerId`/`peerType`

### Patch Changes

- d893fe9: Add synchronous receive queue to Synchronizer for recursion prevention

  The Synchronizer now uses a receive queue to handle incoming messages iteratively,
  preventing infinite recursion when adapters deliver messages synchronously.

  **Key changes:**

  - Synchronizer.channelReceive() now queues messages and processes them iteratively
  - Removed queueMicrotask() from BridgeAdapter.deliverMessage() - now synchronous
  - Removed queueMicrotask() from StorageAdapter.reply() - now synchronous
  - Removed queueMicrotask() from WsConnection.handleProtocolMessage() and simulateHandshake()
  - Removed queueMicrotask() from WsClientNetworkAdapter.handleProtocolMessage()
  - Updated test-utils.ts documentation to explain flushMicrotasks() is rarely needed

  **Benefits:**

  - Single location for recursion prevention (Synchronizer, not scattered across adapters)
  - Works for all adapters automatically (BridgeAdapter, StorageAdapter, WebSocket, future adapters)
  - Simpler tests - no async utilities needed for basic message handling
  - Completely synchronous message processing within a single dispatch cycle

- 8061a20: Add unit tests for all command handlers in synchronizer

  - Add `createMockCommandContext()` and related mock factories to test-utils.ts for isolated handler testing
  - Create 14 co-located test files with 81 tests covering all command handlers
  - Tests cover edge cases like empty data, missing stores, invalid channels, and multi-doc scenarios
  - Fix circular type dependency: export `SynchronizerEvents` from command-executor.ts and import in synchronizer.ts
  - Remove unnecessary non-null assertion in `#encodeAllPeerStores`

- 27cdfb7: Refactor: Extract focused modules from Synchronizer

  Decomposed the monolithic Synchronizer class into focused, testable modules:

  - `WorkQueue` - Unified work queue for deferred execution
  - `OutboundBatcher` - Batches outbound messages by channel
  - `EphemeralStoreManager` - Manages namespaced ephemeral stores
  - `HeartbeatManager` - Manages periodic heartbeat
  - `MiddlewareProcessor` - Handles middleware execution

  The Synchronizer now implements `MiddlewareContextProvider` interface for clean abstraction.

  This is an internal refactor with no public API changes.

  - @loro-extended/change@3.0.0

## 2.0.0

### Major Changes

- 977922e: # Unified Ephemeral Store System v2

  This release implements a major refactor of the ephemeral (presence) store system, providing a unified API for managing ephemeral data across documents.

  ## Breaking Changes

  ### Handle API Changes

  - **`TypedDocHandle` removed** - Use `Handle` or `HandleWithEphemerals` instead
  - **`UntypedDocHandle` removed** - Use `Handle` with `Shape.any()` for untyped documents
  - **`usePresence(handle)` deprecated** - Use `useEphemeral(handle.presence)` instead
  - **`handle.presence.set(value)` changed** - Use `handle.presence.setSelf(value)` instead
  - **`handle.presence.all` removed** - Use `{ self, peers }` from `useEphemeral()` or access `handle.presence.self` and `handle.presence.peers` directly

  ### Schema API Changes

  - **`Shape.map()` deprecated** - Use `Shape.struct()` for CRDT container structs
  - **`Shape.plain.object()` deprecated** - Use `Shape.plain.struct()` for plain value structs

  ### Ephemeral Declarations Format

  The third argument to `repo.get()` now expects an `EphemeralDeclarations` object:

  ```typescript
  // Before
  const handle = repo.get(docId, DocSchema, PresenceSchema);

  // After
  const handle = repo.get(docId, DocSchema, { presence: PresenceSchema });
  ```

  ## New Features

  ### Unified Handle Class

  All handle types are now unified into a single `Handle<D, E>` class:

  - `doc` is always a `TypedDoc<D>` (use `Shape.any()` for untyped)
  - Ephemeral stores are accessed as properties via the declarations
  - Full sync infrastructure (readyStates, waitUntilReady, etc.)

  ### Multiple Ephemeral Stores

  You can now declare multiple ephemeral stores per document for bandwidth isolation:

  ```typescript
  const handle = repo.get(docId, DocSchema, {
    mouse: MouseShape, // High-frequency updates
    profile: ProfileShape, // Low-frequency updates
  });

  handle.mouse.setSelf({ x: 100, y: 200 });
  handle.profile.setSelf({ name: "Alice" });
  ```

  ### TypedEphemeral Interface

  New unified interface for ephemeral stores:

  ```typescript
  interface TypedEphemeral<T> {
    // Core API
    set(key: string, value: T): void;
    get(key: string): T | undefined;
    getAll(): Map<string, T>;
    delete(key: string): void;

    // Convenience API for per-peer pattern
    readonly self: T | undefined;
    setSelf(value: T): void;
    readonly peers: Map<string, T>;

    // Subscription
    subscribe(cb: (event) => void): () => void;

    // Escape hatch
    readonly raw: EphemeralStore;
  }
  ```

  ### External Store Integration

  Libraries can register their own ephemeral stores for network sync:

  ```typescript
  const externalStore = new LibraryEphemeralStore();
  handle.addEphemeral("library-data", externalStore);
  ```

  ### useEphemeral Hook

  New hook for subscribing to ephemeral store changes:

  ```typescript
  const { self, peers } = useEphemeral(handle.presence);
  ```

  ## Migration Guide

  ### Updating Schema Definitions

  ```typescript
  // Before
  const MessageSchema = Shape.map({
    id: Shape.plain.string(),
    content: Shape.text(),
  });

  const PresenceSchema = Shape.plain.object({
    name: Shape.plain.string(),
  });

  // After
  const MessageSchema = Shape.struct({
    id: Shape.plain.string(),
    content: Shape.text(),
  });

  const PresenceSchema = Shape.plain.struct({
    name: Shape.plain.string(),
  });

  const EphemeralDeclarations = {
    presence: PresenceSchema,
  };
  ```

  ### Updating Handle Usage

  ```typescript
  // Before
  const handle = repo.get(docId, DocSchema, PresenceSchema);
  const { self, peers } = usePresence(handle);
  handle.presence.set({ name: "Alice" });

  // After
  const handle = repo.get(docId, DocSchema, { presence: PresenceSchema });
  const { self, peers } = useEphemeral(handle.presence);
  handle.presence.setSelf({ name: "Alice" });
  ```

  ### Updating Server Code

  ```typescript
  // Before
  import { TypedDocHandle } from "@loro-extended/repo";
  const handle = new TypedDocHandle(untypedHandle, DocSchema, PresenceSchema);

  // After
  import { HandleWithEphemerals } from "@loro-extended/repo";
  const handle = repo.get(docId, DocSchema, { presence: PresenceSchema });
  ```

### Minor Changes

- 686006d: Add `Shape.any()`, `Shape.plain.any()`, and `Shape.plain.bytes()` for graceful untyped integration

  This release adds escape hatches for integrating with external libraries that manage their own document structure (like loro-prosemirror):

  ### @loro-extended/change

  - **`Shape.any()`** - Container escape hatch that represents "any LoroContainer". Use at document root level when you want typed presence but untyped document content.
  - **`Shape.plain.any()`** - Value escape hatch that represents "any Loro Value". Use in presence schemas for flexible metadata.
  - **`Shape.plain.bytes()`** - Alias for `Shape.plain.uint8Array()` for better discoverability when working with binary data like cursor positions.
  - **`Shape.plain.uint8Array().nullable()`** - Added `.nullable()` support for binary data.

  ### @loro-extended/repo

  - **`repo.get(docId, Shape.any(), presenceShape)`** - New overload that returns an `UntypedWithPresenceHandle` when `Shape.any()` is passed directly as the document shape. This provides raw `LoroDoc` access with typed presence.
  - **`UntypedWithPresenceHandle`** - New handle type for documents where the structure is untyped but presence is typed.

  ### Example usage

  ```typescript
  // Option 1: Shape.any() directly (entire document is untyped)
  const handle = repo.get(docId, Shape.any(), CursorPresenceSchema)
  handle.doc // Raw LoroDoc
  handle.presence.set({ ... }) // Typed presence

  // Option 2: Shape.any() in a container (one container is untyped)
  const ProseMirrorDocShape = Shape.doc({
    doc: Shape.any(), // loro-prosemirror manages this
  })
  const handle = repo.get(docId, ProseMirrorDocShape, CursorPresenceSchema)
  handle.doc.toJSON() // { doc: unknown }
  handle.presence.set({ ... }) // Typed presence

  // Fully typed presence with binary cursor data
  const CursorPresenceSchema = Shape.plain.struct({
    anchor: Shape.plain.bytes().nullable(),
    focus: Shape.plain.bytes().nullable(),
    user: Shape.plain.struct({
      name: Shape.plain.string(),
      color: Shape.plain.string(),
    }).nullable(),
  })

  // Presence is fully typed, Uint8Array works directly (no base64 encoding needed!)
  handle.presence.set({
    anchor: cursor.encode(), // Uint8Array directly
    focus: null,
    user: { name: "Alice", color: "#ff0000" },
  })
  ```

- ae0ed28: Add JSONPath subscription support to `TypedDocHandle.subscribe()`

  The `subscribe` method now supports an optional JSONPath pattern as the first argument, enabling efficient subscriptions to specific document paths. The callback automatically receives the query result and a helper function for querying related paths:

  ```typescript
  // Subscribe to all changes (existing behavior)
  const unsubscribe = handle.subscribe((event) => {
    console.log("Document changed:", event.by);
  });

  // Subscribe to JSONPath changes (new)
  const unsubscribe = handle.subscribe(
    "$.books[?@.price>10].title",
    (titles, getPath) => {
      // `titles` is already the result of the subscribed JSONPath query
      console.log("Expensive book titles:", titles);

      // `getPath` makes it easy to query related paths
      const allBooks = getPath("$.books");
    }
  );
  ```

  This leverages Loro's new `subscribeJsonpath` feature (loro-crdt 1.10.3) which uses an NFA-based matcher to efficiently filter events at the path-matching level, avoiding the need to re-evaluate queries on every change.

  Key characteristics:

  - Callback receives `(value: unknown[], getPath: (path: string) => unknown[])` for improved DX
  - May produce false positives (extra notifications) but never false negatives
  - Supports wildcards (`[*]`), filters (`[?...]`), and recursive descent (`..`)

- a901004: Add type-safe path selector DSL for `TypedDocHandle.subscribe`

  ## `@loro-extended/change`

  New exports for building type-safe path selectors:

  - `createPathBuilder(docShape)` - Creates a path builder for a document schema
  - `compileToJsonPath(segments)` - Compiles path segments to JSONPath strings
  - `evaluatePath(doc, selector)` - Evaluates a path selector against a TypedDoc
  - `evaluatePathOnValue(value, segments)` - Evaluates path segments against plain values
  - `hasWildcard(segments)` - Checks if a path contains wildcard segments
  - `PathBuilder<D>` - Type for the path builder
  - `PathSelector<T>` - Type for path selectors with result type inference
  - `PathSegment` - Type for individual path segments
  - `PathNode<S, InArray>` - Type for path nodes in the DSL

  ## `@loro-extended/repo`

  ### New `TypedDocHandle.subscribe` overload

  Type-safe path selector DSL for subscriptions with full TypeScript type inference:

  ```typescript
  // Type-safe path selector DSL:
  handle.subscribe(
    (p) => p.books.$each.title, // PathSelector<string[]>
    (titles, prev) => {
      // titles: string[], prev: string[] | undefined
      console.log("Titles changed from", prev, "to", titles);
    }
  );
  ```

  **DSL constructs:**

  - Property access: `p.config.theme`
  - Array wildcards: `p.books.$each`
  - Array indices: `p.books.$at(0)`, `p.books.$first`, `p.books.$last`
  - Negative indices: `p.books.$at(-1)` (last element)
  - Record wildcards: `p.users.$each`
  - Record keys: `p.users.$key("alice")`

  **Two-stage filtering:**

  1. WASM-side: `subscribeJsonpath` NFA matcher for fast O(1) path matching
  2. JS-side: Deep equality check to filter false positives from wildcard paths

  ### Simplified JSONPath subscription

  The raw JSONPath escape hatch now has a simpler callback signature:

  ```typescript
  // Before (deprecated getPath parameter):
  handle.subscribe("$.books[*].title", (values, getPath) => { ... })

  // After (simpler):
  handle.subscribe("$.books[*].title", (values) => { ... })
  ```

  ### New `TypedDocHandle.jsonPath` method

  General-purpose JSONPath query method for ad-hoc queries:

  ```typescript
  const expensiveBooks = handle.jsonPath("$.books[?@.price>10]");
  const allTitles = handle.jsonPath("$..title");
  ```

  See also:

  - https://loro.dev/docs/advanced/jsonpath
  - https://github.com/loro-dev/loro/pull/883

### Patch Changes

- ccdca91: # ProseMirror Collaborative Editing Example

  Added a new example app demonstrating elegant integration between loro-extended and external libraries that bring their own `EphemeralStore`.

  ## Key Features

  - **`handle.addEphemeral()`** - Register external stores for automatic network sync
  - **Zero bridge code** - loro-prosemirror's `CursorEphemeralStore` works directly
  - **Shape.any()** - Opt out of document typing when external libraries manage structure

  ## Integration Pattern

  ```typescript
  // Create loro-prosemirror's cursor store
  const cursorStore = new CursorEphemeralStore(handle.peerId);

  // Register it for network sync - ONE LINE!
  handle.addEphemeral("cursors", cursorStore);

  // Use with loro-prosemirror plugins
  LoroEphemeralCursorPlugin(cursorStore, { user: { name, color } });
  ```

  The Synchronizer automatically:

  - Subscribes to store changes (`by='local'` triggers broadcast)
  - Applies incoming network data (`by='import'` updates the store)

  This demonstrates that loro-extended can integrate with external libraries **with beauty and grace**.

- Updated dependencies [686006d]
- Updated dependencies [a901004]
- Updated dependencies [977922e]
  - @loro-extended/change@2.0.0

## 1.1.0

### Patch Changes

- 4896d83: Add `subscribe` convenience method to `TypedDocHandle` for subscribing to document changes.

  The method provides a type-safe way to listen for all changes on the document:

  ```typescript
  const handle = repo.get(docId, docSchema);

  const unsubscribe = handle.subscribe((event) => {
    // event is a LoroEventBatch containing:
    // - by: "local" | "import" | "checkout"
    // - origin: optional string identifying the change source
    // - currentTarget: container ID (undefined for root doc)
    // - events: array of LoroEvent objects with diffs
    // - from/to: frontiers before/after the change
    console.log("Document changed:", event.by);
  });

  // Later: unsubscribe()
  ```

  The return type `() => void` is consistent with `TypedPresence.subscribe` and other subscription patterns in the codebase.

- Updated dependencies [0c6aef6]
  - @loro-extended/change@1.1.0

## 1.0.1

### Patch Changes

- f982d45: # Documentation cleanup: Update READMEs to use current API

  Updated all README documentation to use the current recommended APIs:

  ## API Function Name

  - Replaced all `batch()` references with `change()` - the actual exported function name

  ## Struct Terminology

  - Replaced `Shape.map()` with `Shape.struct()` for fixed-key objects
  - Replaced `Shape.plain.object()` with `Shape.plain.struct()` for plain struct values

  These changes align the documentation with the v1.0.0 API where:

  - The `change()` function is the primary mutation helper
  - "Struct" terminology is used for fixed-key objects to avoid confusion with JavaScript's `Map`

- Updated dependencies [f982d45]
  - @loro-extended/change@1.0.1

## 1.0.0

### Minor Changes

- 5d8cfdb: # Grand Unified API v3: Proxy-based TypedDoc with $ namespace

  This release transforms the `@loro-extended/change` API to provide a cleaner, more intuitive interface for working with typed Loro documents.

  ## Breaking Changes

  ### New Proxy-based API

  TypedDoc is now a Proxy that allows direct access to schema properties:

  ```typescript
  // Before (old API)
  doc.value.title.insert(0, "Hello")
  doc.value.count.increment(5)
  doc.batch(draft => { ... })
  doc.loroDoc

  // After (new API)
  doc.title.insert(0, "Hello")
  doc.count.increment(5)
  batch(doc, draft => { ... })
  getLoroDoc(doc)
  ```

  ### Meta-operations via `$` namespace

  All internal meta-operations can be accessed via the `$` property:

  - `doc.$.batch(fn)` - Batch multiple mutations into a single transaction
  - `doc.$.change(fn)` - Deprecated alias for `batch()`
  - `doc.$.rawValue` - Get raw CRDT state without placeholders
  - `doc.$.loroDoc` - Access underlying LoroDoc

  ### Direct Schema Access

  Schema properties are accessed directly on the doc object:

  ```typescript
  // Direct mutations - commit immediately
  doc.title.insert(0, "Hello");
  doc.count.increment(5);
  doc.users.set("alice", { name: "Alice" });

  // Check existence
  doc.users.has("alice"); // true
  "alice" in doc.users; // true (via Proxy has trap)
  ```

  ## Migration Guide

  1. Replace `doc.value.` with `doc.`:

     - `doc.value.title` → `doc.title`
     - `doc.value.count` → `doc.count`

  2. Replace `doc.` meta-operations with `batch()` and `getLoroDoc()` (preferred), or if needed, you can reach into internal properties:
     - `doc.batch()` → `doc.$.batch()`
     - `doc.change()` → `doc.$.change()` (deprecated, use `$.batch()`)
     - `doc.rawValue` → `doc.$.rawValue`
     - `doc.loroDoc` → `doc.$.loroDoc`

  ## Other Changes

  - Updated `TypedDocHandle` to use new API internally
  - Updated `useDoc` hook types to use `Infer<D>` instead of `DeepReadonly<Infer<D>>`

### Patch Changes

- dafd365: Fixed an issue where large data payloads could cause a stack overflow
- Updated dependencies [0f4ce81]
- Updated dependencies [5d8cfdb]
- Updated dependencies [73997a6]
  - @loro-extended/change@1.0.0

## 0.9.1

### Patch Changes

- Updated dependencies [05343c9]
- Updated dependencies [2d554c6]
- Updated dependencies [54ac30d]
  - @loro-extended/change@0.9.1

## 0.9.0

### Minor Changes

- 9ba361d: Add `peers` property to PresenceInterface, deprecate `all`;

  **Breaking Change (soft deprecation):**

  The `all` property on `PresenceInterface` is now deprecated in favor of the new `peers` property.

  **Key differences:**

  - `peers`: Returns `Map<string, ObjectValue>` - does NOT include self
  - `all` (deprecated): Returns `Record<string, ObjectValue>` - includes self

  **Migration:**

  ```typescript
  // Before
  const allPresence = handle.presence.all;
  for (const peerId of Object.keys(allPresence)) {
    // process allPresence[peerId]
  }

  // After
  const { self, peers } = handle.presence;
  // Process self separately if needed
  for (const [peerId, presence] of peers) {
    // process presence (Map iteration)
  }
  ```

  **Changes:**

  - `PresenceInterface.peers`: New `Map<string, ObjectValue>` property (excludes self)
  - `PresenceInterface.all`: Deprecated, still works for backward compatibility
  - `TypedPresence.peers`: New `Map<string, Infer<S>>` property (excludes self)
  - `TypedPresence.all`: Deprecated
  - `TypedPresence.subscribe`: Callback now receives `{ self, peers, all }` (peers is new)
  - `usePresence` / `useUntypedPresence` hooks: Now return `peers` alongside `all`

- d9ea24e: Add strongly typed `TypedDocHandle` from `Repo.get()`

  ## New Features

  ### TypedDocHandle

  `Repo.get()` now supports typed document and presence schemas:

  ```typescript
  import { Shape } from "@loro-extended/change";

  const DocSchema = Shape.doc({
    title: Shape.text(),
    count: Shape.counter(),
  });

  const PresenceSchema = Shape.plain.object({
    cursor: Shape.plain.object({
      x: Shape.plain.number(),
      y: Shape.plain.number(),
    }),
    name: Shape.plain.string().placeholder("Anonymous"),
  });

  // Get a typed handle with doc and presence schemas
  const handle = repo.get("my-doc", DocSchema, PresenceSchema);

  // Type-safe document mutations
  handle.doc.change((draft) => {
    draft.title.insert(0, "Hello");
    draft.count.increment(1);
  });

  // Type-safe presence with placeholder defaults
  handle.presence.set({ cursor: { x: 100, y: 200 } });
  console.log(handle.presence.self.name); // "Anonymous" (from placeholder)
  ```

  ### API Changes

  - **`repo.get(docId, docShape, presenceShape)`** - Returns `TypedDocHandle<D, P>` with typed `doc` and `presence`
  - **`repo.get(docId, docShape)`** - Returns `TypedDocHandle<D, ValueShape>` with typed `doc`
  - **`repo.get(docId)`** - Returns `UntypedDocHandle` (backward compatible)
  - **`repo.getUntyped(docId)`** - Explicit method to get `UntypedDocHandle`

  ### TypedPresence moved to @loro-extended/change

  `TypedPresence` is now exported from `@loro-extended/change` and works with any `PresenceInterface`:

  ```typescript
  import { TypedPresence, Shape } from "@loro-extended/change";

  const typedPresence = new TypedPresence(PresenceSchema, handle.presence);
  ```

  ### Breaking Changes

  - `DocHandle` renamed to `UntypedDocHandle` (alias provided for backward compatibility)
  - `handle.untypedPresence` renamed to `handle.presence`
  - `TypedPresence` moved from `@loro-extended/repo` to `@loro-extended/change`

  ### Backward Compatibility

  - `DocHandle` is re-exported as an alias for `UntypedDocHandle`
  - `repo.get(docId)` without schemas returns `UntypedDocHandle` as before
  - `TypedPresence` is re-exported from `@loro-extended/repo` for compatibility

### Patch Changes

- 702af3c: Renamed internal DraftNode classes to TypedRef for clarity:

  - `DraftNode` → `TypedRef`
  - `DraftNodeParams` → `TypedRefParams`
  - `DraftDoc` → `DocRef`
  - `MapDraftNode` → `MapRef`
  - `ListDraftNode` → `ListRef`
  - `ListDraftNodeBase` → `ListRefBase`
  - `RecordDraftNode` → `RecordRef`
  - `TextDraftNode` → `TextRef`
  - `CounterDraftNode` → `CounterRef`
  - `MovableListDraftNode` → `MovableListRef`
  - `TreeDraftNode` → `TreeRef`

  Added `Mutable<T>` type alias (replaces `Draft<T>`).
  `Draft<T>` is now deprecated but still exported for backward compatibility.

  Added `InferMutableType<T>` type alias (replaces `InferDraftType<T>`).
  `InferDraftType<T>` is now deprecated but still exported for backward compatibility.

  The `draft-nodes/` directory is now `typed-refs/`.

  The `Shape` interface now uses `_mutable` instead of `_draft` for the mutable type parameter.

  Added consistent readonly enforcement to all TypedRef mutation methods:

  - `TextRef`: `insert`, `delete`, `update`, `mark`, `unmark`, `applyDelta`
  - `CounterRef`: `increment`, `decrement`
  - `TreeRef`: `createNode`, `move`, `delete`

- Updated dependencies [492af24]
- Updated dependencies [9ba361d]
- Updated dependencies [173be61]
- Updated dependencies [463c5b4]
- Updated dependencies [8de0ce7]
- Updated dependencies [e2dcf3f]
- Updated dependencies [d9ea24e]
- Updated dependencies [702af3c]
  - @loro-extended/change@0.9.0

## 0.8.1

### Patch Changes

- a6d3fc8: Need to publish hooks-core
- Updated dependencies [a6d3fc8]
  - @loro-extended/change@0.8.1

## 0.8.0

### Minor Changes

- 907cdce: Remove `emptyState` parameter from TypedPresence and usePresence. Instead, use `.placeholder()` annotations on your schema to define default values.

  ### Breaking Change

  The `emptyState` parameter has been removed from:

  - `TypedPresence` constructor
  - `DocHandle.presence()` method
  - `usePresence` hook

  ### Migration

  Before:

  ```typescript
  const PresenceSchema = Shape.plain.object({
    name: Shape.plain.string(),
    cursor: Shape.plain.object({
      x: Shape.plain.number(),
      y: Shape.plain.number(),
    }),
  });

  const EmptyPresence = {
    name: "Anonymous",
    cursor: { x: 0, y: 0 },
  };

  // Usage
  const presence = handle.presence(PresenceSchema, EmptyPresence);
  const { self } = usePresence(docId, PresenceSchema, EmptyPresence);
  ```

  After:

  ```typescript
  const PresenceSchema = Shape.plain.object({
    name: Shape.plain.string().placeholder("Anonymous"),
    cursor: Shape.plain.object({
      x: Shape.plain.number(), // default 0
      y: Shape.plain.number(), // default 0
    }),
  });

  // Usage - no emptyState needed!
  const presence = handle.presence(PresenceSchema);
  const { self } = usePresence(docId, PresenceSchema);
  ```

  Placeholder values are automatically derived from the schema. Use `.placeholder()` on individual shapes to customize default values. Shapes without explicit `.placeholder()` use sensible defaults:

  - `Shape.plain.string()` → `""`
  - `Shape.plain.number()` → `0`
  - `Shape.plain.boolean()` → `false`
  - `Shape.plain.object({...})` → recursively derived from nested shapes
  - `Shape.plain.record(...)` → `{}`
  - `Shape.plain.array(...)` → `[]`

### Patch Changes

- Updated dependencies [1a80326]
- Updated dependencies [3599dae]
- Updated dependencies [90f1c84]
  - @loro-extended/change@0.8.0

## 0.7.0

### Minor Changes

- 0879e51: When generating a UUID, prefer crypto.generateUUID, but gracefully fall back to other means in insecure contexts

### Patch Changes

- a26a6c2: Auto-reset repo if needed
- Updated dependencies [ab2d939]
  - @loro-extended/change@0.7.0

## 0.6.0

### Patch Changes

- c67e26c: Refactor directory-response into a new-doc message that is specifically for new, local doc announcements (pull-based). This frees us to use directory-response for its original intended purpose in future.
- 76a18ba: Updated Repo messages to be more efficient with regard to ephemeral state when peers request documents--just pass the ephemeral state along with the sync-request and sync-response, rather than initiating another message loop.
- Updated dependencies [26ca4cd]
- Updated dependencies [b9da0e9]
  - @loro-extended/change@0.6.0

## 0.5.0

### Minor Changes

- 9b291dc: Fixed an issue where StorageAdapter was not properly handling subscribes, making storage miss some documents.
- 204fda2: Fixed an issue with StorageAdapter where unnecessary data was sent, and potentially saved, in the storage medium.

### Patch Changes

- @loro-extended/change@0.5.0

## 0.4.0

### Minor Changes

- Accurate and fast presence updates

### Patch Changes

- Updated dependencies
  - @loro-extended/change@0.4.0

## 0.3.0

### Minor Changes

- 6d95249: Consistent ReadyState and additional tests

### Patch Changes

- Updated dependencies [6d95249]
  - @loro-extended/change@0.3.0

## 0.2.0

### Minor Changes

- Release 0.2.0

### Patch Changes

- Updated dependencies
  - @loro-extended/change@0.2.0
