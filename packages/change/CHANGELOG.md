# @loro-extended/change

## 5.0.0

### Major Changes

- cb7e307: **BREAKING**: Remove `$` namespace, add `loro()` escape hatch function

  ## Breaking Changes

  ### `$` Namespace Removed

  The `$` namespace on TypedDoc and all refs has been removed. Use `loro()` instead:

  ```typescript
  // OLD (no longer works)
  doc.$.change(draft => { ... })
  doc.$.loroDoc
  doc.$.applyPatch(patch)
  ref.$.loroDoc
  ref.$.loroContainer
  ref.$.subscribe(cb)

  // NEW (required)
  doc.change(draft => { ... })
  loro(doc).doc
  loro(doc).applyPatch(patch)
  loro(ref).doc
  loro(ref).container
  loro(ref).subscribe(cb)
  ```

  ### StructRef `.set()` Method Removed

  The `.set(key, value)` method on StructRef is no longer available. Use property assignment instead:

  ```typescript
  // OLD (no longer works)
  doc.settings.set("darkMode", true);

  // NEW (required)
  doc.settings.darkMode = true;
  ```

  **Note:** RecordRef still has `.set()` since records have dynamic keys:

  ```typescript
  // Records still use .set() for dynamic keys
  doc.users.set("alice", { name: "Alice" });
  ```

  ### Internal Methods Hidden via `INTERNAL_SYMBOL`

  Internal methods like `absorbPlainValues()` are now hidden behind a Symbol and are not directly accessible on refs:

  ```typescript
  // OLD (no longer works)
  ref.absorbPlainValues();
  ```

  The `INTERNAL_SYMBOL` is intentionally **not exported** from the package. This is a private implementation detail used internally by the library. If you need to access it for advanced use cases, you can use `Symbol.for("loro-extended:internal")`, but this is not recommended and may change without notice.

  This change hides implementation details from users and prevents namespace collisions.

  ## New Features

  ### `loro()` Function

  A new `loro()` function is the recommended way to access underlying Loro primitives:

  ```typescript
  import { loro } from "@loro-extended/change";

  // Access underlying LoroDoc
  loro(ref).doc;

  // Access underlying Loro container (correctly typed)
  loro(ref).container; // LoroList, LoroMap, LoroText, etc.

  // Subscribe to changes
  loro(ref).subscribe(callback);

  // Container operations
  loro(list).pushContainer(loroMap);
  loro(list).insertContainer(0, loroMap);
  loro(struct).setContainer("key", loroMap);
  loro(record).setContainer("key", loroMap);

  // For TypedDoc
  loro(doc).doc;
  loro(doc).docShape;
  loro(doc).rawValue;
  loro(doc).applyPatch(patch);
  ```

  ### `doc.change()` Method

  The `change()` method is now available directly on TypedDoc:

  ```typescript
  doc.change((draft) => {
    draft.count.increment(10);
    draft.title.update("Hello");
  });

  // Supports chaining
  doc
    .change((draft) => draft.count.increment(1))
    .change((draft) => draft.count.increment(2));
  ```

  ### JavaScript-Native StructRef API

  StructRef now uses a Proxy-based implementation that provides JavaScript-native object behavior:

  ```typescript
  const schema = Shape.doc({
    settings: Shape.struct({
      darkMode: Shape.plain.boolean().placeholder(false),
      fontSize: Shape.plain.number().placeholder(14),
      theme: Shape.plain.string().placeholder("light"),
    }),
  });

  const doc = createTypedDoc(schema);

  // Property assignment (NEW - recommended)
  doc.settings.darkMode = true;
  doc.settings.fontSize = 16;
  doc.settings.theme = "dark";

  // Property access
  console.log(doc.settings.darkMode); // true

  // Object.keys()
  console.log(Object.keys(doc.settings)); // ['darkMode', 'fontSize', 'theme']

  // 'key' in obj
  console.log("darkMode" in doc.settings); // true

  // delete obj.key (for optional properties)
  delete doc.settings.theme;
  ```

  ## Migration

  1. **Replace `doc.$.change()` with `doc.change()`**
  2. **Replace `doc.$.applyPatch(patch)` with `loro(doc).applyPatch(patch)`**
  3. **Replace `ref.$.loroDoc` with `loro(ref).doc`**
  4. **Replace `ref.$.loroContainer` with `loro(ref).container`**
  5. **Replace `ref.$.subscribe(cb)` with `loro(ref).subscribe(cb)`**
  6. Replace `list.pushContainer(c)` with `loro(list).pushContainer(c)`
  7. Replace `struct.setContainer(k, c)` with `loro(struct).setContainer(k, c)`
  8. **Replace `struct.set("key", value)` with `struct.key = value`**

### Minor Changes

- 9a8048b: Make `getDoc` required in TypedRefParams and unify TreeRef with TypedRef

  **Internal changes:**

  - `TypedRefParams.getDoc` is now required instead of optional
  - `TreeRef` now extends `TypedRef` instead of being a standalone class

  **Improvements:**

  - `$.loroDoc` now returns `LoroDoc` instead of `LoroDoc | undefined` on all refs
  - `getLoroDoc()` helper now returns `LoroDoc` instead of `LoroDoc | undefined` for refs
  - Removed ~40 lines of duplicated code from TreeRef (container caching, $, autoCommit, etc.)
  - Removed `TreeRefMetaNamespace` interface (now uses inherited `RefMetaNamespace`)

  **Non-breaking for external consumers:**

  - Existing code with `?.` on `$.loroDoc` will still work
  - New code can omit `?.` for cleaner access

- 6e49a81: Add `$` namespace to typed refs for accessing underlying Loro primitives

  This release adds a `$` namespace to all typed refs (TextRef, CounterRef, ListRef, MovableListRef, RecordRef, StructRef, TreeRef) that provides:

  - `ref.$.loroDoc` - Access the underlying LoroDoc from any ref
  - `ref.$.loroContainer` - Access the correctly-typed Loro container (LoroText, LoroCounter, LoroList, etc.)
  - `ref.$.subscribe(callback)` - Subscribe to container-level changes

  Also adds functional helpers:

  - `getLoroDoc(ref)` - Functional API to get LoroDoc from any ref (extends existing `getLoroDoc(doc)`)
  - `getLoroContainer(ref)` - New functional API to get the typed Loro container from any ref

  This enables the "pass around a ref" pattern where components can receive a ref and subscribe to its changes without needing the full document:

  ```typescript
  function TextEditor({ textRef }: { textRef: TextRef }) {
    useEffect(() => {
      return textRef.$.subscribe((event) => {
        // Handle text changes
      });
    }, [textRef]);

    // Access the container for advanced operations
    const loroText = textRef.$.loroContainer;

    return <div>...</div>;
  }
  ```

## 4.0.0

### Minor Changes

- 64e81c1: Add typed TreeRef and TreeNodeRef for type-safe tree operations

  - Add `TreeNodeRef` class wrapping `LoroTreeNode` with typed `data` property
  - Rewrite `TreeRef` class with full typed API including `createNode()`, `roots()`, `nodes()`, `getNodeByID()`, `move()`, `delete()`, `toJSON()`, `toArray()`
  - Add `TreeNodeJSON` type for serialized tree nodes with `data` and `fractionalIndex` properties
  - Transform Loro's native tree format (`meta`/`fractional_index`) to typed format (`data`/`fractionalIndex`) in serialization
  - Fix `isValueShape` to include "any" valueType

### Patch Changes

- 587efb3: Fix: Value shapes in RecordRef, StructRef, and ListRefBase now always read fresh from the container

  Previously, value shapes were cached, causing stale values to be returned when the underlying container was modified by a different ref instance (e.g., drafts created by `change()`).

  The fix ensures that:

  - When `autoCommit` is true (direct access outside of `change()`), value shapes are always read fresh from the CRDT container
  - When `autoCommit` is false (inside `change()`), value shapes are cached to support find-and-mutate patterns where mutations to found items persist back to the CRDT

  This resolves issues where:

  - `record.set("key", newValue)` appeared to have no effect after the first write
  - `struct.property = newValue` returned the old value on subsequent reads
  - `list.get(index)` returned stale values after delete/insert operations
  - `delete()` operations appeared to not work

- 73f7b32: Refactor: Add `batchedMutation` flag and remove dead `readonly` code from typed refs

## 3.0.0

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

## 1.1.0

### Minor Changes

- 0c6aef6: Add `.nullable()` builder method to value shape types for convenient nullable type definitions.

  Supported types:

  - `Shape.plain.string().nullable()` - `string | null`
  - `Shape.plain.number().nullable()` - `number | null`
  - `Shape.plain.boolean().nullable()` - `boolean | null`
  - `Shape.plain.array(...).nullable()` - `T[] | null`
  - `Shape.plain.record(...).nullable()` - `Record<string, T> | null`
  - `Shape.plain.struct(...).nullable()` - `{ ... } | null`

  **Before (verbose):**

  ```typescript
  email: Shape.plain
    .union([Shape.plain.null(), Shape.plain.string()])
    .placeholder(null);
  ```

  **After (concise):**

  ```typescript
  email: Shape.plain.string().nullable();
  ```

  The `.nullable()` method creates a union of `null` and the original type with `null` as the default placeholder. You can chain `.placeholder()` after `.nullable()` to customize the default value:

  ```typescript
  name: Shape.plain.string().nullable().placeholder("Anonymous");
  ```

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

- 73997a6: # Shape API: Adopt "struct" terminology for fixed-key objects

  This release improves the consistency and Developer Experience (DX) of the `Shape` schema builder by adopting the term "struct" for objects with fixed keys.

  ## New API

  ### Container Shapes

  - **`Shape.struct({ ... })`** - Creates a struct container shape for objects with fixed keys (uses LoroMap internally)
  - **`Shape.map({ ... })`** - **Deprecated**, use `Shape.struct()` instead

  ### Value Shapes

  - **`Shape.plain.struct({ ... })`** - Creates a struct value shape for plain objects with fixed keys
  - **`Shape.plain.object({ ... })`** - **Deprecated**, use `Shape.plain.struct()` instead

  ## Why "struct"?

  The term "map" was confusing because it implies dynamic keys (like JavaScript's `Map` or a dictionary). The term "object" is too generic. "Struct" clearly communicates that this is for objects with a fixed, known set of keys - similar to structs in C, Go, Rust, etc.

  The term "record" is retained for objects with dynamic keys (like `Record<string, T>` in TypeScript).

  ## Migration Guide

  ### Before

  ```typescript
  const schema = Shape.doc({
    user: Shape.map({
      name: Shape.text(),
      age: Shape.counter(),
      metadata: Shape.plain.object({
        createdAt: Shape.plain.string(),
        updatedAt: Shape.plain.string(),
      }),
    }),
  });
  ```

  ### After

  ```typescript
  const schema = Shape.doc({
    user: Shape.struct({
      name: Shape.text(),
      age: Shape.counter(),
      metadata: Shape.plain.struct({
        createdAt: Shape.plain.string(),
        updatedAt: Shape.plain.string(),
      }),
    }),
  });
  ```

  ## Backward Compatibility

  - **No breaking changes** - Existing code using `Shape.map` and `Shape.plain.object` continues to work
  - IDE will show deprecation warnings for old methods
  - `MapContainerShape` is now a type alias for `StructContainerShape`
  - `ObjectValueShape` is now a type alias for `StructValueShape`

  ## Type Exports

  New types are exported:

  - `StructContainerShape` - The container shape type for structs
  - `StructValueShape` - The value shape type for plain structs

  Deprecated types (still exported for backward compatibility):

  - `MapContainerShape` - Use `StructContainerShape` instead
  - `ObjectValueShape` - Use `StructValueShape` instead

### Patch Changes

- 0f4ce81: Fix: Allow `record.set()` and indexed assignment to work with `Shape.text()` and `Shape.counter()` fields

  Previously, calling `record.set(key, value)` or using indexed assignment (`record[key] = value`) would throw "Cannot set container directly, modify the typed ref instead" when the record contained `Shape.text()` or `Shape.counter()` fields. This affected both direct records of text/counter (`Shape.record(Shape.text())`) and records of maps containing text/counter fields.

## 0.9.1

### Patch Changes

- 05343c9: ### Refactoring: Reduce code duplication in typed-refs

  Implemented Phase 1 refactoring to improve maintainability:

  1. **Extracted `containerConstructor`** to `utils.ts` - removed duplicate Loro container mappings from `map.ts` and `record.ts`

  2. **Added `assertMutable()` helper** to `base.ts` - consolidated 20+ inline readonly checks into a single reusable method across all typed ref classes

  3. **Extracted `unwrapReadonlyPrimitive()`** to `utils.ts` - consolidated counter/text value unwrapping logic from `map.ts`, `record.ts`, `doc.ts`, and `list-base.ts`

  These changes reduce cognitive load and ensure consistent behavior across the codebase.

- 2d554c6: Optimized `toJSON()` performance for nested TypedRefs by leveraging Loro's native `toJSON()` in readonly mode. Also fixed a bug where placeholders were not correctly applied to nested items in lists and records.
- 54ac30d: refactor: extract shared logic for typed refs (phase 2)

  - Extracted `absorbCachedPlainValues` utility to consolidate logic for persisting cached values to Loro containers
  - Extracted `serializeRefToJSON` utility to consolidate mutable-mode JSON serialization logic
  - Updated `MapRef`, `RecordRef`, and `DocRef` to use these shared utilities

## 0.9.0

### Minor Changes

- 492af24: Add `.slice()` method to `ListRefBase` for getting slices of arrays

  The new `slice(start?, end?)` method follows JavaScript's `Array.prototype.slice()` semantics:

  - Returns a portion of the list from `start` to `end` (exclusive)
  - Supports negative indices (counting from the end)
  - Returns `MutableItem[]` so mutations to sliced items persist back to the original list

  Example usage:

  ```typescript
  typedDoc.change((draft) => {
    // Get items at indices 1 and 2
    const sliced = draft.items.slice(1, 3);

    // Get last 2 items
    const lastTwo = draft.items.slice(-2);

    // Mutations persist back to the original list
    sliced[0].value = "updated";
  });
  ```

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

- e2dcf3f: # Enhanced JSON Compatibility for TypedRef

  This release significantly improves the developer experience when working with `TypedRef` objects (the values returned by `.value` or inside `.change()`).

  ## Features

  - **`JSON.stringify()` Support**: You can now directly call `JSON.stringify()` on any `TypedRef` (Doc, Map, List, Record, etc.) to get its plain JSON representation. This works recursively for nested structures.
  - **Enumerable Properties**: Properties on `DocRef` and `MapRef` are now enumerable, meaning they show up in `Object.keys()`, `Object.entries()`, and `for...in` loops.
  - **`toJSON()` Methods**: Added `toJSON()` methods to all `TypedRef` classes, ensuring consistent serialization behavior.
  - **List Iteration**: `ListRef` now implements `Symbol.iterator`, allowing you to use `for...of` loops directly on lists.
  - **`toArray()` Improvement**: `ListRef.toArray()` now returns an array of plain values (or nested plain objects) instead of raw Loro containers.
  - **Consistent Placeholder Behavior**: `useDocument` now returns proxied placeholders during loading state that support `.toJSON()`, ensuring consistent API usage regardless of loading state.
  - **Type Support**: `DeepReadonly` type now includes `toJSON()` method definition, improving TypeScript support for snapshotting.

  ## Example

  ```typescript
  const doc = createTypedDoc(MySchema);
  // ... make changes ...

  // Now works as expected!
  console.log(JSON.stringify(doc.value));

  // Iteration works too
  for (const item of doc.value.myList) {
    console.log(item);
  }

  // Object keys work
  console.log(Object.keys(doc.value));
  ```

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

### Patch Changes

- 173be61: Fix confusing type signature when using `Object.values()` on Records/Maps

  Previously, calling `Object.values(doc.value.record)` on a Record would return a confusing union type like:

  ```typescript
  (({ id: string; name: string } & { toJSON(): ... }) | (() => Record<...>))[]
  ```

  This happened because the `DeepReadonly` type added `toJSON()` via intersection, which TypeScript's `Object.values()` type definition included in the values.

  The fix restructures `DeepReadonly` to use separate type helpers:

  - `DeepReadonlyObject<T>` for plain objects (includes `toJSON()`)
  - `DeepReadonlyRecord<T>` for Record types with string index signatures

  This ensures:

  1. `Object.values()` returns clean types: `DeepReadonly<Participant>[]`
  2. `toJSON()` is still callable on Records and Maps
  3. Runtime behavior is unchanged (class methods like `toJSON` are not enumerable)

- 463c5b4: Fix "placeholder required" error when accessing non-existent keys in `Shape.record()` with nested `Shape.map()` values

  **Before (broken):**

  ```typescript
  const schema = Shape.doc({
    users: Shape.record(
      Shape.map({
        name: Shape.plain.string(),
      })
    ),
  });

  const doc = new TypedDoc(schema);

  // This would throw "placeholder required" instead of returning undefined
  const name = doc.value.users["nonexistent-id"]?.name;
  ```

  **After (fixed):**

  ```typescript
  // Now correctly returns undefined, allowing optional chaining to work
  const name = doc.value.users["nonexistent-id"]?.name; // undefined
  ```

  The fix ensures that accessing a key that doesn't exist in a Record returns `undefined` in readonly mode, allowing optional chaining (`?.`) to work as expected.

- 8de0ce7: Fix "placeholder required" error when calling toJSON() on documents with Records containing Maps

  When a Record contains Map entries that exist in the CRDT but not in the placeholder (which is always `{}` for Records), the nested MapRef was created with `placeholder: undefined`. When `MapRef.toJSON()` tried to access value properties that don't exist in the CRDT, it threw "placeholder required".

  The fix: `RecordRef.getTypedRefParams()` now derives a placeholder from the schema's shape when the Record's placeholder doesn't have an entry for that key. This ensures nested containers always have valid placeholders to fall back to for missing values.

## 0.8.1

### Patch Changes

- a6d3fc8: Need to publish hooks-core

## 0.8.0

### Minor Changes

- 1a80326: Remove use of emptyState and required emptyState params for TypedDoc and useDocument. Instead, you can optionally annotate your Shape schema with `.placeholder()` values if you need a placeholder when the underlying LoroDoc has no value. A placeholder is like a default value, but stops existing as soon as the property is mutated.
- 90f1c84: The `.value` getter on TypedDoc is now optimized for reading--rather than creating a JSON doc, it allows you lightning-fast access to the underlying properties without serializing the entire document. To access JSON like before, use `.toJSON()` instead. Also fixed a bug in the LoroText and LoroCounter types where the empty-state (fallback if not defined in the document) was being ignored due to Loro's behavior where a '.getCounter' or '.getText' initializes values.

### Patch Changes

- 3599dae: Allow Record, MovableList, and List to assign values in draft via square brackets, e.g. list[0] = 1, record["key"] = "value"

## 0.7.0

### Minor Changes

- ab2d939: Deprecate InferPlainType<> type helper in favor of Infer<>; fix a type invariance bug with discriminatedUnion

## 0.6.0

### Minor Changes

- 26ca4cd: Fix an issue with null-unioned Shapes, where null could be misinterpreted as undefined
- b9da0e9: Prevent empty state in useDocument or TypedDoc where empty state includes invalid state--for example, in `Record` or `List` Shape types. The type system previously implied you could pre-populate a list or record with empty state. This is not the case--empty state is not merged in for shape types that do not have pre-defined keys.

## 0.5.0

## 0.4.0

### Minor Changes

- Accurate and fast presence updates

## 0.3.0

### Minor Changes

- 6d95249: Consistent ReadyState and additional tests

## 0.2.0

### Minor Changes

- Release 0.2.0
