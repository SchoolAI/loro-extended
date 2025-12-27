# @loro-extended/repo

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
