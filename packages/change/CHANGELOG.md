# @loro-extended/change

## 6.0.0-beta.0

### Major Changes

- 3a1cbed: ### API Consistency: Unify read/write using methods

  **Breaking Changes:**

  - `PlainValueRef`: Property assignment removed; use `.set(value)` instead
  - `CounterRef`: `.value` getter removed; use `.get()` instead
  - `ListRef`/`MovableListRef`: Bracket assignment removed; use `.set(index, value)` instead
  - `StructRef`: Property assignment removed; use `ref.prop.set(value)` instead
  - `RecordRef`: Bracket assignment removed; use `.set(key, value)` instead

  **New API:**

  - `PlainValueRef.get()` — read the current value
  - `PlainValueRef.set(value)` — write a new value
  - `ListRef.set(index, value)` — update item at index
  - Uniform API inside and outside `change()` blocks

  **Type System:**

  - `_draft` and `_mutable` type parameters unified (both return `PlainValueRef<T>`)
  - New `DeepPlainValueRef<T>` type for recursive nested property access

  **Migration:**

  ```typescript
  // Before
  draft.title = "New";
  draft.scores.alice = 100;
  list[0] = "updated";
  counter.value;

  // After
  draft.title.set("New");
  draft.scores.set("alice", 100);
  list.set(0, "updated");
  counter.get();
  ```

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

- 39fa800: feat(change): Add ChangeOptions support to change() function

  The `change()` function now accepts an optional `ChangeOptions` parameter for all target types:

  - `change(doc, fn, options?)` - TypedDoc with optional commit message
  - `change(ref, fn, options?)` - TypedRef with optional commit message
  - `change(lens, fn, options?)` - Lens with optional commit message (via EXT_SYMBOL detection)

  **BREAKING CHANGE in @loro-extended/lens**: The `lens.change()` method has been removed. Use the unified `change(lens, fn, options?)` API instead.

  Migration:

  ```typescript
  // Before
  lens.change((d) => d.counter.increment(1), { commitMessage: "inc" });

  // After - Option A: import from lens package
  import { createLens, change } from "@loro-extended/lens";
  change(lens, (d) => d.counter.increment(1), { commitMessage: "inc" });

  // After - Option B: import from change package
  import { createLens } from "@loro-extended/lens";
  import { change } from "@loro-extended/change";
  change(lens, (d) => d.counter.increment(1), { commitMessage: "inc" });
  ```

  This unifies the API so that `change()` works consistently with docs, refs, and lenses.

  Exports from @loro-extended/change:

  - `ChangeOptions` interface
  - `serializeCommitMessage()` helper function

  Re-exports from @loro-extended/lens (for convenience):

  - `change` function
  - `ChangeOptions` interface

- f90c7f7: Add schema-level mergeable configuration and document metadata

  - `Shape.doc()` now accepts an options parameter with `mergeable?: boolean`
  - Document metadata is stored in `_loro_extended_meta_` root container
  - Metadata includes `mergeable` flag for peer agreement
  - `toJSON()` excludes all `_loro_extended*` prefixed keys from output
  - Reserved prefix `_loro_extended` for future internal use
  - `loro(doc).mergeable` exposes the effective mergeable value
  - Handle now exposes `isMergeable` getter (delegates to TypedDoc)
  - New `skipInitialize` option to defer metadata writing
  - New `doc.initialize()` method for manual metadata initialization

  Usage:

  ```typescript
  const schema = Shape.doc(
    {
      players: Shape.record(Shape.struct({ score: Shape.plain.number() })),
    },
    { mergeable: true }
  );

  // Auto-initialize (default) - writes metadata immediately
  const doc = createTypedDoc(schema);

  // Skip initialization for advanced use cases
  const doc2 = createTypedDoc(schema, { skipInitialize: true });
  // Later, when ready:
  doc2.initialize();

  // Access effective mergeable value
  loro(doc).mergeable; // true
  ```

- 32b9abb: Add flattened root container storage for mergeable documents

  When `mergeable: true` is set on a TypedDoc, all containers are stored at the
  document root with path-based names (e.g., `data-nested-items`). This ensures
  container IDs are deterministic and survive `applyDiff`, enabling proper merging
  of concurrent container creation.

  **Usage:**

  ```typescript
  const doc = createTypedDoc(schema, { mergeable: true });
  ```

  **Path encoding:**

  - Path separator: `-` (hyphen)
  - Escape character: `\` (backslash)
  - Literal hyphen: `\-`
  - Literal backslash: `\\`

  **Limitations:**

  - Lists of containers (`Shape.list(Shape.struct({...}))`) are NOT supported with `mergeable: true`
  - Use `Shape.record(Shape.struct({...}))` with string keys instead

  This is a breaking change for existing mergeable documents. Non-mergeable
  documents are unaffected.

### Patch Changes

- 50c0083: ### PlainValueRef proxy consolidation

  **Refactored:**

  - Extracted shared proxy boilerplate (GET preamble, SET unwrap, runtime primitive check) into reusable helpers
  - Extracted shared PlainValueRef base builder to eliminate 3 duplicated construction blocks
  - Replaced `setNestedValueInObject` with existing `setAtPath`; added `transformAtPath` to `utils/path-ops.ts`

  **Removed:**

  - Dead `absorbValueAtIndex` method from `ListRefBaseInternals`, `ListRefInternals`, and `MovableListRefInternals`
  - Duplicated `setNestedValue` and `setNestedValueInObject` from `factory.ts`

  **Added:**

  - `transformAtPath` utility in `utils/path-ops.ts`
  - Edge case tests for array values in `Shape.plain.any()`
  - Runtime assertion in `getMutableItem` to guard `itemCache` type invariant

  **Documentation:**

  - Updated TECHNICAL.md with PlainValueRef test assertion guidance
  - Updated TECHNICAL.md with proxy boilerplate extraction details
  - Updated TECHNICAL.md with array-in-any behavior documentation

- d9570ea: fix(change): Add `[EXT_SYMBOL]` to TypedDoc type for robust change() support

  Fixed a TypeScript type inference issue where `change(doc, fn)` would fail to compile when `TypedDoc<T>` was "flattened" across module boundaries (e.g., in `.d.ts` files or re-exported type aliases).

  **Root cause**: TypeScript's generic inference for `change<Shape>(doc: TypedDoc<Shape>, ...)` requires the argument to match the `TypedDoc<T>` pattern. When types get expanded/flattened, the wrapper is lost and inference fails, causing TypeScript to fall through to the `[EXT_SYMBOL]` fallback overload—which previously failed because `TypedDoc` didn't include `[EXT_SYMBOL]` in its type.

  **The fix**: Added the `[EXT_SYMBOL]` property (with the `change` method signature) to the `TypedDoc` type. This:

  1. Matches runtime behavior (the proxy already exposes this symbol)
  2. Provides a fallback path when type flattening breaks the primary overload
  3. Aligns with how `Lens<D>` is already typed

  Before (required workaround):

  ```typescript
  function MyComponent({ doc }: { doc: any }) {  // had to use 'any'
    change(doc, draft => { ... })
  }
  ```

  After:

  ```typescript
  function MyComponent({ doc }: { doc: TypedDoc<MySchema> }) {
    change(doc, draft => { ... })  // ✅ Works correctly
  }
  ```

## 5.4.2

### Patch Changes

- Fixed stale container refs after MovableListRef.move() operations

  When items in a MovableListRef were reordered via move(), cached TextRefs and other container refs would become stale, causing the wrong data to be returned. This manifested as text content not moving with reordered list items.

  The fix disables container ref caching outside of change() transactions, ensuring fresh refs are created on each access. This mirrors the existing behavior for value shapes and eliminates the stale cache issue.

## 5.4.1

### Patch Changes

- e1588f2: fix: export all \*ValueShape types

  Newly exported:

  - BooleanValueShape
  - NullValueShape
  - UndefinedValueShape
  - Uint8ArrayValueShape

## 5.4.0

### Minor Changes

- e66f01c: Add `replayDiff()` utility for replaying diffs as local operations.

  This enables the fork-and-merge pattern to work with synchronization and undo:

  - Changes are replayed as LOCAL events (not import events)
  - `subscribeLocalUpdates()` fires for replayed changes
  - UndoManager records replayed changes

  The `createUpdate()` function in the quiz-challenge example has been updated to use `replayDiff()` instead of `export/import`, fixing the incompatibility between fork-and-merge and the synchronizer.

- 0266dfb: Add bulk update methods to `RecordRef`: `replace()`, `merge()`, and `clear()`.

  These methods provide type-safe bulk operations on records:

  ```typescript
  doc.change((draft) => {
    // Replace entire contents (removes keys not in new object)
    draft.game.players.replace({
      alice: { choice: null, locked: false },
      bob: { choice: null, locked: false },
    });

    // Merge values (keeps existing keys not in new object)
    draft.game.scores.merge({
      alice: 100,
      charlie: 50,
    });

    // Clear all entries
    draft.game.history.clear();
  });
  ```

  **Method semantics:**

  - `replace(values)` - Sets record to exactly these entries (removes absent keys)
  - `merge(values)` - Adds/updates entries without removing existing ones
  - `clear()` - Removes all entries

  This provides a type-safe alternative to direct object assignment, which TypeScript cannot support due to limitations in mapped type getter/setter typing.

  Also improved `RecordRef` type safety:

  - `values()` now returns `InferMutableType<NestedShape>[]` instead of `any[]`
  - Added `entries()` method returning `[string, InferMutableType<NestedShape>][]`
  - Both methods return properly typed refs for container-valued records

### Patch Changes

- cab74a3: Externalize `loro-crdt` from bundle output to fix Bun compatibility

  Added `external: ["loro-crdt"]` to tsup configs for all core packages. This prevents `loro-crdt` from being bundled into the dist output, allowing bundlers like Bun to resolve it separately and handle WASM initialization correctly.

  This fixes the `examples/todo-minimal` example which uses Bun's bundler and was failing due to top-level await issues when `loro-crdt` was bundled inline.

- cf2b22c: Fix nested container materialization bug where empty nested containers were not created, causing CRDT sync issues.

## 5.3.0

## 5.2.0

### Minor Changes

- 6b074ee: **BREAKING**: `nodes()` now excludes deleted nodes by default

  Previously, `tree.nodes()` returned all nodes including deleted tombstones, which caused "container is deleted" errors when users tried to access `.data` on deleted nodes.

  Now `nodes()` filters out deleted nodes by default. To include deleted nodes, use `nodes({ includeDeleted: true })`.

  ```typescript
  // Default: excludes deleted nodes (prevents "container is deleted" errors)
  const liveNodes = tree.nodes();

  // Opt-in: include deleted nodes for advanced CRDT operations
  const allNodes = tree.nodes({ includeDeleted: true });
  ```

  This aligns `nodes()` behavior with `roots()` and `children()`, which already exclude deleted nodes.

- 7414993: Add `forkAt` support for TypedDoc to create typed document forks at specific versions

  The `forkAt` method creates a new TypedDoc at a specified version (frontiers), preserving full type safety. Available as both a method on TypedDoc and a functional helper.

  ```typescript
  import { createTypedDoc, forkAt, loro } from "@loro-extended/change";

  const doc = createTypedDoc(schema);
  doc.title.update("Hello");
  const frontiers = loro(doc).doc.frontiers();
  doc.title.update("World");

  // Method on TypedDoc
  const forked = doc.forkAt(frontiers);

  // Or functional helper
  const forked2 = forkAt(doc, frontiers);

  console.log(forked.title.toString()); // "Hello"
  console.log(doc.title.toString()); // "World"
  ```

  Key features:

  - Returns `TypedDoc<Shape>` with full type safety
  - Forked doc is independent (changes don't affect original)
  - Forked doc has a different PeerID
  - Raw `LoroDoc.forkAt()` still accessible via `loro(doc).doc.forkAt()`
  - New `Frontiers` type exported for convenience

- 408c543: Add ref-level `change()` support for better encapsulation

  The `change()` function now accepts any typed ref (ListRef, TextRef, CounterRef, StructRef, RecordRef, TreeRef, MovableListRef) in addition to TypedDoc. This enables passing refs around without exposing the entire document structure.

  ```typescript
  // Before: Required access to the doc
  function addStates(doc: TypedDoc<...>) {
    doc.change(draft => {
      draft.states.createNode({ name: "idle" })
    })
  }

  // After: Works with just the ref
  function addStates(states: TreeRef<StateNodeShape>) {
    change(states, draft => {
      draft.createNode({ name: "idle" })
    })
  }
  ```

  Key features:

  - All ref types supported (List, Text, Counter, Struct, Record, Tree, MovableList)
  - Nested `change()` calls work correctly (Loro's commit is idempotent)
  - Returns the original ref for chaining
  - Find-and-mutate patterns work as expected

## 5.1.0

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
