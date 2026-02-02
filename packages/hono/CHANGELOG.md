# @loro-extended/hono

## 5.4.0

### Patch Changes

- Updated dependencies [b2614e6]
- Updated dependencies [cab74a3]
- Updated dependencies [a532f43]
  - @loro-extended/repo@5.4.0
  - @loro-extended/hooks-core@5.4.0

## 5.3.0

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

### Minor Changes

- dfcddc6: Fixed a race condition with indexeddb storage adapter

### Patch Changes

- Updated dependencies [9b291dc]
- Updated dependencies [204fda2]
  - @loro-extended/repo@0.5.0
