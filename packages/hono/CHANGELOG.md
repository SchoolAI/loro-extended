# @loro-extended/hono

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
