# @loro-extended/react

## 6.0.0-beta.0

### Major Changes

- 50c0083: # PlainValueRef: Reactive subscriptions for plain values

  Plain value properties (from `Shape.plain.*`) now return `PlainValueRef<T>` instead of raw values. This enables reactive subscriptions via `useValue()` and `subscribe()`.

  ## New APIs

  - `value(ref)` - Get current value from PlainValueRef, TypedRef, or TypedDoc
  - `useValue(doc.meta.title)` - Now works with plain value properties
  - `subscribe(doc.meta.title, cb)` - Now works with plain value properties

  ## Breaking Changes

  Plain value property access now returns `PlainValueRef<T>` instead of `T`:

  ```typescript
  // Before
  const title: string = doc.meta.title;

  // After
  const title: PlainValueRef<string> = doc.meta.title;
  const titleValue: string = value(doc.meta.title);
  ```

  Strict equality comparisons become TypeScript errors (guiding correct usage):

  ```typescript
  // Before (worked)
  if (doc.meta.title === "foo") { ... }

  // After (type error - use value())
  if (value(doc.meta.title) === "foo") { ... }
  ```

  ## Coercion Still Works

  Template literals, string concatenation, and JSON serialization work transparently:

  ```typescript
  console.log(`Title: ${doc.meta.title}`); // Works via valueOf()
  JSON.stringify(doc.meta.title); // Works via toJSON()
  ```

  ## Assignment Still Works

  ```typescript
  doc.meta.title = "new value"; // Still works
  ```

- 29853c3: # Breaking: Major API Simplification

  This release introduces significant breaking changes to simplify the loro-extended API. The changes consolidate mutation patterns, simplify native Loro access, and remove redundant APIs.

  ## Summary of Breaking Changes

  1. **`Handle.change()` removed** - Use `change(handle.doc, fn)` instead
  2. **`loro()` now returns native types directly** - No more `.doc` or `.container` indirection
  3. **`ext(ref).change()` removed** - Use `change(ref, fn)` instead
  4. **`getLoroDoc()` removed** - Use `loro(doc)` instead
  5. **`loro(ref).doc` removed** - Use `ext(ref).doc` instead
  6. **`loro(ref).container` removed** - Use `loro(ref)` directly

  ***

  ## Breaking Change Details

  ### 1. `Handle.change()` Removed

  The `Handle.change()` method has been removed from `@loro-extended/repo` to narrow its focus as a handle. Use the `change()` functional helper instead.

  **Before:**

  ```typescript
  handle.change((draft) => {
    draft.title.insert(0, "Hello");
    draft.count.increment(5);
  });
  ```

  **After:**

  ```typescript
  import { change } from "@loro-extended/change";

  change(handle.doc, (draft) => {
    draft.title.insert(0, "Hello");
    draft.count.increment(5);
  });
  ```

  ### 2. `loro()` Returns Native Types Directly

  The `loro()` function now returns native Loro types directly, without the `.doc` or `.container` indirection.

  **Before:**

  ```typescript
  // For TypedDoc
  const loroDoc = loro(doc).doc;
  const frontiers = loro(doc).doc.frontiers();
  loro(doc).doc.subscribe(callback);
  loro(doc).doc.import(bytes);

  // For TypedRef
  const loroText = loro(textRef).container;
  const loroList = loro(listRef).container;
  ```

  **After:**

  ```typescript
  // For TypedDoc - loro() returns LoroDoc directly
  const loroDoc = loro(doc);
  const frontiers = loro(doc).frontiers();
  loro(doc).subscribe(callback);
  loro(doc).import(bytes);

  // For TypedRef - loro() returns the container directly
  const loroText = loro(textRef); // Returns LoroText
  const loroList = loro(listRef); // Returns LoroList
  ```

  ### 3. `loro(ref).change()` Removed

  The `change()` method has been deprecated from the `loro()` namespace for refs. Use the `change()` functional helper instead.

  **Before:**

  ```typescript
  loro(ref).change((draft) => {
    // mutations
  });
  ```

  **After:**

  ```typescript
  import { change } from "@loro-extended/change";

  change(ref, (draft) => {
    // mutations
  });
  ```

  ### 4. `getLoroDoc()` Removed

  The `getLoroDoc()` function has been removed. Use `loro(doc)` directly.

  **Before:**

  ```typescript
  import { getLoroDoc } from "@loro-extended/change";

  const loroDoc = getLoroDoc(typedDoc);
  ```

  **After:**

  ```typescript
  import { loro } from "@loro-extended/change";

  const loroDoc = loro(typedDoc);
  ```

  ### 5. Accessing LoroDoc from Refs

  To get the underlying `LoroDoc` from a ref, use `ext(ref).doc` instead of `loro(ref).doc`. This belongs on `ext()` because loro's native containers don't point back to their LoroDoc.

  **Before:**

  ```typescript
  const loroDoc = loro(textRef).doc;
  ```

  **After:**

  ```typescript
  import { ext } from "@loro-extended/change";

  const loroDoc = ext(textRef).doc;
  ```

  ***

  ## Migration Guide

  ### Step-by-Step Migration

  1. **Update imports:**

     ```typescript
     // Add these imports where needed
     import { change, loro, ext } from "@loro-extended/change";
     ```

  2. **Replace `handle.change(fn)` with `change(handle.doc, fn)`:**

     ```bash
     # Find all usages
     grep -r "handle\.change(" --include="*.ts" --include="*.tsx"
     ```

  3. **Replace `loro(x).doc` with `loro(x)`:**

     ```bash
     # Find all usages
     grep -r "loro(.*).doc" --include="*.ts" --include="*.tsx"
     ```

  4. **Replace `loro(ref).container` with `loro(ref)`:**

     ```bash
     # Find all usages
     grep -r "loro(.*).container" --include="*.ts" --include="*.tsx"
     ```

  5. **Replace `getLoroDoc(x)` with `loro(x)`:**

     ```bash
     # Find all usages
     grep -r "getLoroDoc(" --include="*.ts" --include="*.tsx"
     ```

  6. **Replace `loro(ref).doc` with `ext(ref).doc`:**

     ```bash
     # For refs (not docs), use ext() to access the LoroDoc
     # Before: loro(textRef).doc
     # After: ext(textRef).doc
     ```

  ### Common Patterns

  | Old Pattern                   | New Pattern               |
  | ----------------------------- | ------------------------- |
  | `handle.change(fn)`           | `change(handle.doc, fn)`  |
  | `loro(doc).doc`               | `loro(doc)`               |
  | `loro(doc).doc.frontiers()`   | `loro(doc).frontiers()`   |
  | `loro(doc).doc.subscribe(cb)` | `loro(doc).subscribe(cb)` |
  | `loro(doc).doc.import(bytes)` | `loro(doc).import(bytes)` |
  | `loro(doc).doc.export(opts)`  | `loro(doc).export(opts)`  |
  | `loro(ref).container`         | `loro(ref)`               |
  | `loro(ref).doc`               | `ext(ref).doc`            |
  | `getLoroDoc(doc)`             | `loro(doc)`               |
  | `ext(ref).change(fn)`         | `change(ref, fn)`         |

  ***

  ## Recommended API

  ### Mutations

  The `change(doc, fn)` functional helper is the canonical way to mutate documents:

  ```typescript
  import { change } from "@loro-extended/change";

  // Mutate a TypedDoc
  change(doc, (draft) => {
    draft.title.insert(0, "Hello");
    draft.count.increment(5);
    draft.items.push("new item");
  });

  // Mutate via a Handle
  change(handle.doc, (draft) => {
    draft.title.insert(0, "Hello");
  });
  ```

  Note: `ext(doc).change(fn)` is also available for method-chaining scenarios, but `change(doc, fn)` is preferred.

  ### Native Loro Access

  Use `loro()` to access native Loro types:

  ```typescript
  import { loro } from "@loro-extended/change";

  // Get LoroDoc from TypedDoc
  const loroDoc = loro(doc);
  const frontiers = loro(doc).frontiers();
  const version = loro(doc).version();

  // Get native containers from refs
  const loroText: LoroText = loro(doc.title);
  const loroList: LoroList = loro(doc.items);
  const loroCounter: LoroCounter = loro(doc.count);
  ```

  ### Extended Features

  Use `ext()` for loro-extended-specific features:

  ```typescript
  import { ext } from "@loro-extended/change";

  // Document-level features
  ext(doc).fork(); // Fork the TypedDoc
  ext(doc).forkAt(frontiers); // Fork TypedDoc at specific version
  ext(doc).shallowForkAt(frontiers); // Shallow fork of TypedDoc
  ext(doc).initialize(); // Initialize metadata
  ext(doc).applyPatch(patch); // Apply JSON patch
  ext(doc).docShape; // Get the schema
  ext(doc).rawValue; // Get raw JSON value, no overlay or diff
  ext(doc).mergeable; // Check mergeable flag

  // Ref-level features
  ext(ref).doc; // Get LoroDoc from any ref
  ext(listRef).pushContainer(c); // Push container to list
  ext(listRef).insertContainer(i, c); // Insert container at index
  ext(mapRef).setContainer(key, c); // Set container on map

  // Subscriptions via subscribe() functional helper
  subscribe(doc, callback); // Subscribe to all document changes
  subscribe(doc, (p) => p.config.theme, callback); // Subscribe to specific path
  subscribe(ref, callback); // Subscribe to container changes

  // Or use loro() for native Loro subscription access
  loro(doc).subscribe(callback); // Native LoroDoc subscription
  ```

  ***

  ## Rationale

  These changes simplify the API by:

  1. **Consolidating mutation patterns** - One canonical way to mutate: `change(doc, fn)`
  2. **Removing indirection** - `loro()` returns native types directly, no `.doc` or `.container`
  3. **Clear separation** - `loro()` for native Loro access, `ext()` for loro-extended features
  4. **Reducing cognitive load** - Fewer ways to do the same thing

  The previous API had multiple ways to mutate documents (`handle.change()`, `ext(doc).change()`, `change(doc, fn)`) and required extra property access to get native types (`loro(doc).doc`). The new API is more consistent and easier to learn.

### Minor Changes

- a3f151f: feat: Simplified React API with doc-first design

  This release simplifies the React API by making the document the primary interface:

  **New API:**

  ```typescript
  // Get doc directly (no Handle intermediary)
  const doc = useDocument(docId, schema);

  // Subscribe to values (returns value directly)
  const title = useValue(doc.title); // string
  const snapshot = useValue(doc); // Infer<D>

  // Placeholder access (rare)
  const placeholder = usePlaceholder(doc.title);

  // Mutate directly
  doc.title.insert(0, "Hello");

  // Sync/network access (rare)
  import { sync } from "@loro-extended/repo";
  sync(doc).peerId;
  await sync(doc).waitForSync();
  sync(doc).presence.setSelf({ status: "online" });
  ```

  **Key Changes:**

  - `repo.get()` now returns `Doc<D>` directly (TypedDoc with sync capabilities)
  - `repo.get()` now caches documents and throws on schema mismatch
  - `useDocument(docId, schema)` is the primary React hook
  - `useValue(ref)` returns value directly (not wrapped in object)
  - `usePlaceholder(ref)` for placeholder access
  - `sync(doc)` provides access to peerId, readyStates, waitForSync, ephemeral stores
  - `sync` and `hasSync` are now re-exported from `@loro-extended/react`

  **Deprecations:**

  - `useHandle` — use `useDocument` instead
  - `useDoc(handle)` — use `useValue(doc)` for snapshots
  - `useRefValue` — use `useValue` instead (returns value directly)
  - `Handle` type — still exported but deprecated
  - `repo.getHandle()` — use `repo.get()` instead

  **Migration:**

  ```typescript
  // Before
  const handle = useHandle(docId, schema);
  const snapshot = useDoc(handle);
  const { value, placeholder } = useRefValue(handle.doc.title);
  handle.doc.title.insert(0, "Hello");

  // After
  const doc = useDocument(docId, schema);
  const snapshot = useValue(doc);
  const title = useValue(doc.title);
  const placeholder = usePlaceholder(doc.title);
  doc.title.insert(0, "Hello");
  ```

- 5039c52: Add `useDocIdFromHash` hook for syncing document ID with URL hash

  This hook enables shareable URLs where the hash contains the document ID (e.g., `https://app.example.com/#doc-abc123`).

  Features:

  - Uses `useSyncExternalStore` for concurrent mode safety
  - SSR-safe with server snapshot support
  - Automatically writes hash on mount if empty
  - Caches generated default ID across renders

  Also exports pure utility functions `parseHash()` and `getDocIdFromHash()` for testing and custom implementations.

  ```typescript
  import { useDocIdFromHash, useDocument } from "@loro-extended/react";
  import { generateUUID } from "@loro-extended/repo";

  function App() {
    const docId = useDocIdFromHash(() => generateUUID());
    const doc = useDocument(docId, MySchema);
    // ...
  }
  ```

### Patch Changes

- Updated dependencies [f90c7f7]
- Updated dependencies [50c0083]
- Updated dependencies [a3f151f]
- Updated dependencies [29853c3]
- Updated dependencies [5039c52]
  - @loro-extended/repo@6.0.0-beta.0
  - @loro-extended/hooks-core@6.0.0-beta.0

## 5.4.2

### Patch Changes

- @loro-extended/hooks-core@5.4.2
- @loro-extended/repo@5.4.2

## 5.4.1

### Patch Changes

- @loro-extended/hooks-core@5.4.1
- @loro-extended/repo@5.4.1

## 5.4.0

### Patch Changes

- cab74a3: Externalize `loro-crdt` from bundle output to fix Bun compatibility

  Added `external: ["loro-crdt"]` to tsup configs for all core packages. This prevents `loro-crdt` from being bundled into the dist output, allowing bundlers like Bun to resolve it separately and handle WASM initialization correctly.

  This fixes the `examples/todo-minimal` example which uses Bun's bundler and was failing due to top-level await issues when `loro-crdt` was bundled inline.

- Updated dependencies [b2614e6]
- Updated dependencies [cab74a3]
- Updated dependencies [a532f43]
  - @loro-extended/repo@5.4.0
  - @loro-extended/hooks-core@5.4.0

## 5.3.0

### Minor Changes

- de27b84: Add automatic cursor restoration and namespace-based undo

  - Cursor restoration now works automatically when using `useCollaborativeText` with `useUndoManager`
  - Cursor position is stored with container ID in `onPush`, restored to correct element in `onPop`
  - Add namespace support to scope undo/redo to specific groups of fields
  - Namespaces use `LoroDoc.setNextCommitOrigin()` and `UndoManager.excludeOriginPrefixes`
  - Add `cursorRestoration` config option to `RepoProvider` (default: true)

  ### New API

  ```tsx
  // Namespace-based undo
  const { undo: undoHeader } = useUndoManager(handle, "header")
  const { undo: undoBody } = useUndoManager(handle, "body")

  // Assign fields to namespaces
  <CollaborativeInput textRef={titleRef} undoNamespace="header" />
  <CollaborativeTextarea textRef={descriptionRef} undoNamespace="body" />
  ```

  ### How It Works

  1. When `undoNamespace="header"` is set, changes call `doc.setNextCommitOrigin("loro-extended:ns:header")` before commit
  2. The "header" UndoManager has `excludeOriginPrefixes: ["loro-extended:ns:body", ...]` to ignore other namespaces
  3. Cursor position is stored with the container ID of the focused element
  4. On undo, the cursor is restored to the element matching the stored container ID

  ### Migration

  Apps using manual cursor tracking via `getCursors`/`setCursors` can remove that code - it's now automatic. To opt-out:

  ```tsx
  <RepoProvider config={{ cursorRestoration: false }}>
  ```

### Patch Changes

- 8fffae6: Add `useRefValue` hook for fine-grained subscriptions to typed refs

  The new `useRefValue` hook subscribes to a single typed ref (TextRef, ListRef, CounterRef, etc.) and returns its current value. This provides:

  - **No prop drilling** - Components only need the ref, not value + placeholder
  - **Automatic placeholder** - Extracts placeholder from `Shape.text().placeholder()`
  - **Fine-grained subscriptions** - Only re-renders when this specific container changes
  - **Type-safe** - Return type is inferred from the ref type

  Example usage:

  ```tsx
  import { useRefValue, type TextRef } from "@loro-extended/react";

  function ControlledInput({ textRef }: { textRef: TextRef }) {
    // No need to pass value or placeholder as props!
    const { value, placeholder } = useRefValue(textRef);

    return (
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => textRef.update(e.target.value)}
      />
    );
  }
  ```

  This is particularly useful for building controlled inputs without the prop drilling required when using `useDoc` at the parent level.

- Updated dependencies [c97a468]
- Updated dependencies [5a87c2b]
- Updated dependencies [de27b84]
- Updated dependencies [790e1eb]
- Updated dependencies [de27b84]
- Updated dependencies [8fffae6]
- Updated dependencies [8fffae6]
  - @loro-extended/repo@5.3.0
  - @loro-extended/hooks-core@5.3.0

## 5.2.0

### Patch Changes

- Updated dependencies [6048f48]
  - @loro-extended/repo@5.2.0
  - @loro-extended/hooks-core@5.2.0

## 5.1.0

### Patch Changes

- @loro-extended/hooks-core@5.1.0
- @loro-extended/repo@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [f254aa2]
  - @loro-extended/repo@5.0.0
  - @loro-extended/hooks-core@5.0.0

## 4.0.0

### Patch Changes

- Updated dependencies [14b9193]
- Updated dependencies [37cdd5e]
- Updated dependencies [c3e5d1f]
  - @loro-extended/repo@4.0.0
  - @loro-extended/hooks-core@4.0.0

## 3.0.0

### Patch Changes

- Updated dependencies [d893fe9]
- Updated dependencies [786b8b1]
- Updated dependencies [8061a20]
- Updated dependencies [cf064fa]
- Updated dependencies [1b2a3a4]
- Updated dependencies [702871b]
- Updated dependencies [27cdfb7]
  - @loro-extended/repo@3.0.0
  - @loro-extended/hooks-core@3.0.0

## 2.0.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [686006d]
- Updated dependencies [ccdca91]
- Updated dependencies [ae0ed28]
- Updated dependencies [a901004]
- Updated dependencies [977922e]
  - @loro-extended/repo@2.0.0
  - @loro-extended/hooks-core@2.0.0

## 1.1.0

### Patch Changes

- Updated dependencies [4896d83]
  - @loro-extended/repo@1.1.0
  - @loro-extended/hooks-core@1.1.0

## 1.0.1

### Patch Changes

- Updated dependencies [f982d45]
  - @loro-extended/repo@1.0.1
  - @loro-extended/hooks-core@1.0.1

## 1.0.0

### Major Changes

- db55b58: ## Breaking Change: New Handle-First Hooks API

  This release introduces a completely new hooks API that provides better separation of concerns, improved type safety, and more predictable behavior.

  ### New API

  ```typescript
  // Get a stable handle (never re-renders)
  const handle = useHandle(docId, docSchema);
  // or with presence
  const handle = useHandle(docId, docSchema, presenceSchema);

  // Subscribe to document changes (reactive)
  const doc = useDoc(handle);
  // or with selector for fine-grained updates
  const title = useDoc(handle, (d) => d.title);

  // Subscribe to presence changes (reactive)
  const { self, peers } = usePresence(handle);

  // Mutate via handle
  handle.change((d) => {
    d.title = "new";
  });
  handle.presence.set({ cursor: { x: 10, y: 20 } });
  ```

  ### Migration Guide

  **Before:**

  ```typescript
  const [doc, changeDoc, handle] = useDocument(docId, schema);
  changeDoc((d) => {
    d.title = "new";
  });

  const { peers, self, setSelf } = usePresence(docId, PresenceSchema);
  setSelf({ cursor: { x: 10, y: 20 } });
  ```

  **After:**

  ```typescript
  const handle = useHandle(docId, schema, PresenceSchema);
  const doc = useDoc(handle);
  const { self, peers } = usePresence(handle);

  handle.change((d) => {
    d.title = "new";
  });
  handle.presence.set({ cursor: { x: 10, y: 20 } });
  ```

  ### Removed APIs

  The following hooks have been removed:

  - `useDocument` - Use `useHandle` + `useDoc` instead
  - `useUntypedDocument` - Use `repo.get(docId)` for untyped access
  - `useUntypedPresence` - Use `useHandle` with a presence schema
  - `useDocHandleState`, `useDocChanger`, `useTypedDocState`, `useTypedDocChanger`, `useRawLoroDoc`, `useUntypedDocChanger`

  ### Benefits

  1. **Stable handle reference** - `useHandle` returns a stable reference that never changes, preventing unnecessary re-renders
  2. **Separation of concerns** - Document access and mutations are clearly separated
  3. **Fine-grained reactivity** - Use selectors with `useDoc` to only re-render when specific data changes
  4. **Unified presence** - Presence is now tied to the handle, making it easier to manage
  5. **Better TypeScript support** - Improved type inference throughout

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

- Updated dependencies [5d8cfdb]
- Updated dependencies [db55b58]
- Updated dependencies [dafd365]
  - @loro-extended/hooks-core@1.0.0
  - @loro-extended/repo@1.0.0

## 0.9.1

### Patch Changes

- @loro-extended/hooks-core@0.9.1
- @loro-extended/repo@0.9.1

## 0.9.0

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

- Updated dependencies [9ba361d]
- Updated dependencies [10b8a07]
- Updated dependencies [d9ea24e]
- Updated dependencies [702af3c]
  - @loro-extended/repo@0.9.0
  - @loro-extended/hooks-core@0.9.0

## 0.8.1

### Patch Changes

- a6d3fc8: Need to publish hooks-core
- Updated dependencies [a6d3fc8]
  - @loro-extended/hooks-core@0.8.1
  - @loro-extended/repo@0.8.1

## 0.8.0

### Minor Changes

- 1a80326: Remove use of emptyState and required emptyState params for TypedDoc and useDocument. Instead, you can optionally annotate your Shape schema with `.placeholder()` values if you need a placeholder when the underlying LoroDoc has no value. A placeholder is like a default value, but stops existing as soon as the property is mutated.
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

- Updated dependencies [907cdce]
  - @loro-extended/repo@0.8.0
  - @loro-extended/hooks-core@0.2.0

## 0.7.0

### Patch Changes

- Updated dependencies [a26a6c2]
- Updated dependencies [0879e51]
  - @loro-extended/repo@0.7.0

## 0.6.0

### Minor Changes

- b9da0e9: Prevent empty state in useDocument or TypedDoc where empty state includes invalid state--for example, in `Record` or `List` Shape types. The type system previously implied you could pre-populate a list or record with empty state. This is not the case--empty state is not merged in for shape types that do not have pre-defined keys.

### Patch Changes

- Updated dependencies [c67e26c]
- Updated dependencies [76a18ba]
  - @loro-extended/repo@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [9b291dc]
- Updated dependencies [204fda2]
  - @loro-extended/repo@0.5.0

## 0.4.0

### Minor Changes

- Accurate and fast presence updates

### Patch Changes

- Updated dependencies
  - @loro-extended/repo@0.4.0

## 0.3.0

### Minor Changes

- 6d95249: Consistent ReadyState and additional tests

### Patch Changes

- Updated dependencies [6d95249]
  - @loro-extended/repo@0.3.0

## 0.2.0

### Minor Changes

- Release 0.2.0

### Patch Changes

- Updated dependencies
  - @loro-extended/repo@0.2.0
