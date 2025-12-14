# @loro-extended/change

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
