# Plan: Deprecation Removal for v6 Major Release

## Background

The loro-extended monorepo has accumulated deprecated APIs during the React API simplification effort. The new `Doc<D, E>` + `sync()` API is fully implemented and tested, making it the right time to remove deprecated functionality in a major release.

### Deprecated APIs Summary

| Category | Deprecated | Replacement |
|----------|------------|-------------|
| **Repo** | `repo.getHandle()` | `repo.get()` |
| **Repo** | `Handle<D, E>` class | `Doc<D, E>` + `sync()` |
| **Hooks** | `useHandle()` | `useDocument()` |
| **Hooks** | `useDoc(handle)` | `useValue(doc)` |
| **Hooks** | `useRefValue(ref)` | `useValue(ref)` + `usePlaceholder(ref)` |
| **Shapes** | `Shape.map()` | `Shape.struct()` |
| **Shapes** | `Shape.plain.object()` | `Shape.plain.struct()` |
| **Types** | `MapContainerShape` | `StructContainerShape` |
| **Types** | `ObjectValueShape` | `StructValueShape` |

**Note:** `Draft<T>` and `InferDraftType<T>` type aliases will be retained with `@deprecated` markers. They're harmless one-line aliases that don't affect bundle size, and removing them adds breaking changes without meaningful benefit.

### Key Architectural Facts

From `packages/repo/TECHNICAL.md`:
- `Doc<D, E>` uses phantom types for ephemeral inference via `__ephemeralType`
- `sync()` extracts ephemeral type automatically using `ExtractEphemeral<T>`
- WeakMap is used for sync ref storage (avoids Proxy invariant violations)
- `repo.get()` caches documents by docId

## Problem Statement

Deprecated APIs create maintenance burden, confuse new users, and bloat bundle size. The codebase currently maintains two parallel APIs (Handle-based and Doc-based) with significant code duplication. A major release provides the opportunity to remove deprecated functionality cleanly.

## Success Criteria

1. All deprecated APIs removed from public exports (except harmless type aliases)
2. All tests migrated to new API and passing
3. All examples migrated to new API and functional
4. Bundle size reduced (~600 lines from Handle class removal)
5. Documentation updated to reflect only current APIs

## The Gap

### Current State
- `handle.ts` exports both `Handle` class and utilities (`TypedEphemeral`, error classes)
- Tests heavily use `getHandle()` pattern
- ALL 11 examples use deprecated `useHandle`/`useDoc` pattern

### Target State
- Utilities extracted to dedicated modules
- `handle.ts` deleted entirely
- All tests use `repo.get()` + `sync()` pattern
- All examples use `useDocument()` + `useValue()` pattern

## Phases and Tasks

### Phase 1: Extract Utilities from handle.ts ✅

Before removing `Handle`, extract utilities that `SyncRefImpl` depends on. This is the critical path—everything else is blocked until this completes.

- ✅ **Task 1.1**: Create `packages/repo/src/typed-ephemeral.ts`
  - Move `TypedEphemeral<T>` interface
  - Move `createTypedEphemeral()` function

- ✅ **Task 1.2**: Create `packages/repo/src/sync-errors.ts`
  - Move `SyncTimeoutError` class
  - Move `NoAdaptersError` class

- ✅ **Task 1.3**: Update imports in `sync.ts` to use new module locations

- ✅ **Task 1.4**: Verify repo package builds and tests pass

### Phase 2: Migrate Consumers 🟡

Batch-migrate all tests and examples. The migration pattern is mechanical:

```typescript
// Transformation pattern
repo.getHandle(id, schema, eph) → repo.get(id, schema, eph)
handle.doc.field → doc.field
handle.waitForSync() → sync(doc).waitForSync()
handle.presence → sync(doc).presence
useHandle(id, schema) → useDocument(id, schema)
useDoc(handle) → useValue(doc)
useRefValue(ref) → useValue(ref) // + usePlaceholder(ref) if needed
```

- ✅ **Task 2.1**: Batch-migrate all test files
  - ✅ `packages/repo/src/ephemeral.test.ts`
  - ✅ `packages/repo/src/repo.test.ts`
  - ✅ `packages/repo/src/sync.test.ts` (removed Legacy Handle API section)
  - ✅ `packages/repo/src/tests/*.test.ts` (all 35 test files migrated)
    - ✅ `e2e.test.ts`
    - ✅ `handle.test.ts` (renamed concepts to use Doc + sync())
    - ✅ `handle-ownkeys.test.ts` (migrated to test SyncRef proxy)
    - ✅ `handle-sync.test.ts`
    - ✅ `handle-subscribe.test.ts`
    - ✅ `ephemeral-hub-spoke.test.ts`
    - ✅ `ephemeral-presence-before-connect.test.ts`
    - ✅ `ephemeral-source.test.ts`
    - ✅ `ephemeral-timing.test.ts`
    - ✅ `fork-and-merge-sync.test.ts`
    - ✅ `middleware-rate-limiter-integration.test.ts`
    - ✅ `middleware.test.ts`
    - ✅ `namespaced-store-sync.test.ts`
    - ✅ `peer-id-consistency.test.ts`
    - ✅ `permissions-comprehensive.test.ts`
    - ✅ `subscription-hang-investigation.test.ts`
    - ✅ `synchronizer-permissions-edge-cases.test.ts`
    - ✅ `synchronizer-permissions.test.ts`
    - ✅ `wait-for-sync.test.ts`
  - ✅ `packages/repo/src/adapter/*.test.ts`
    - ✅ `bridge-adapter.test.ts`
  - ✅ `packages/repo/src/storage/*.test.ts`
    - ✅ `flush-pending-saves.test.ts`
  - ✅ `adapters/websocket/src/__tests__/*.test.ts`
    - ✅ `e2e.test.ts`
    - ✅ `hub-spoke-sync.test.ts`
  - ✅ `adapters/websocket-compat/src/__tests__/*.test.ts`
    - ✅ `e2e.test.ts`
    - ✅ `hub-spoke-sync.test.ts`

- ✅ **Task 2.2**: Batch-migrate all examples
  - ✅ `examples/todo-minimal/` - useHandle/useDoc → useDocument/useValue (+ type cast for snapshot)
  - ✅ `examples/todo-websocket/` - useHandle/useDoc → useDocument/useValue (+ type cast for snapshot)
  - ✅ `examples/todo-sse/` - useHandle/useDoc → useDocument/useValue (+ type cast for snapshot)
  - ✅ `examples/hono-counter/` - useHandle/useDoc → useDocument/useValue (also updated @loro-extended/hono exports)
  - ✅ `examples/postgres/` - repo.getHandle → repo.get
  - ✅ `examples/chat/` - client: useHandle/useDoc → useDocument/useValue + sync(); server: getHandle → get + sync()
  - ✅ `examples/bumper-cars/` - client: useHandle/useDoc → useDocument/useValue + sync(); server: getHandle → get + sync()
  - ✅ `examples/video-conference/` - useHandle/useDoc → useDocument/useValue + sync() for ephemeral
  - ✅ `examples/collaborative-text/` - useHandle/useDoc/useRefValue → useDocument/useValue/usePlaceholder + useUndoManager(doc)
  - ✅ `examples/rps-demo/` - client: useHandle → useDocument; server: getHandle → get
  - ✅ `examples/prosemirror-collab/` - repo.getHandle → repo.get + sync() for addEphemeral

- ✅ **Task 2.3**: Verify examples build (`pnpm turbo run build --filter='./examples/*'`)
  - All 11 examples build successfully
  - Note: @loro-extended/hono updated to export useDocument, useValue, usePlaceholder, useLens

- ✅ **Task 2.4**: Verify full test suite passes (`pnpm turbo run verify`)
  - All 28 packages verify successfully (except @loro-extended/repo which has pre-existing unhandled rejection issue in timeout tests - all 726 tests pass)
  - All 11 examples verify successfully

### Phase 3: Remove Deprecated APIs ✅

With all consumers migrated, remove deprecated code in a single sweep.

**Status:** Phase 3 complete. All deprecated APIs removed and documentation updated.

**Known Issues (workarounds in place):**
- ✅ `useUndoManager` updated to accept `Doc` in addition to `Handle` (backward compatible)
- ⚠️ Type inference issues with `useValue()` returning `unknown` - workaround: explicit type casts
- ⚠️ Lens `change()` type inference - workaround: `lens[EXT_SYMBOL].change()` with explicit types

- ✅ **Task 3.1**: Delete `packages/repo/src/handle.ts`

- ✅ **Task 3.2**: Remove from `Repo` class (`packages/repo/src/repo.ts`)
  - Remove `getHandle()` method
  - Remove `#handleCache` field
  - Remove `HandleCacheEntry` interface
  - Remove imports from `handle.js`

- ✅ **Task 3.3**: Remove deprecated hooks from `packages/hooks-core/src/create-hooks.ts`
  - Remove `useHandle` function and overloads
  - Remove `useDoc` function

- ✅ **Task 3.4**: Remove deprecated hooks from `packages/hooks-core/src/create-ref-hooks.ts`
  - Remove `useRefValue` function
  - Remove `RefValueResult` type

- ✅ **Task 3.5**: Remove deprecated shape APIs from `packages/change/src/shape.ts`
  - Remove `Shape.map()` factory
  - Remove `Shape.plain.object()` factory
  - Remove `MapContainerShape` type alias
  - Remove `ObjectValueShape` type alias
  - Remove `isMapShape` from type-guards.ts

- ✅ **Task 3.6**: Update exports in index files
  - `packages/repo/src/index.ts` - Remove `handle.js` export
  - `packages/hooks-core/src/index.ts` - Update hook exports
  - `packages/react/src/index.ts` - Update re-exports
  - `packages/hono/src/index.ts` - Remove deprecated exports

- ✅ **Task 3.7**: Update error message in `sync.ts`
  - Change "requires a document from repo.getHandle()" to "requires a document from repo.get()"

- ✅ **Task 3.8**: Update documentation
  - `packages/hooks-core/README.md` - Updated to Doc-first API
  - `packages/hono/README.md` - Updated to Doc-first API
  - `packages/hono/src/index.test.tsx` - Updated test to new API
  - `packages/react/README.md` - Replaced "Migration/Deprecated" sections with "Removed in v6"
  - `packages/repo/README.md` - Replaced "Migration from Handle API" section with "Removed in v6"
  - `docs/getting-started.md` - Updated to Doc-first API
  - `docs/README.md` - Updated hook references
  - `examples/todo-minimal/README.md` - Updated to Doc-first API
  - `examples/video-conference/src/client/video-conference-app.tsx` - Added type cast for `useValue()`

- ✅ **Task 3.9**: Final verification (`pnpm turbo run verify`)
  - All packages pass (726 tests in repo, with 2 pre-existing unhandled rejection warnings in timeout tests)
  - All 11 examples pass verification

## Transitive Effect Analysis

### Direct Dependencies

| Package | Changes | Impact |
|---------|---------|--------|
| `@loro-extended/repo` | Remove `Handle`, `getHandle` | High |
| `@loro-extended/hooks-core` | Remove `useHandle`, `useDoc`, `useRefValue` | High |
| `@loro-extended/react` | Re-exports from hooks-core | Low (auto-updates) |
| `@loro-extended/change` | Remove `Shape.map()` | Low |

### Transitive Consumers

| Consumer | Impact |
|----------|--------|
| `@loro-extended/hono` | Must verify hooks still work |
| `@loro-extended/lens` | No impact (doesn't use deprecated APIs) |
| All adapters | Test files only |
| All examples | Migrated in Phase 2 |

## Resolved Issues

### `Doc<D, E>` Phantom Type and `change()` Function ✅

The phantom type intersection `TypedDoc<D> & { __ephemeralType?: E }` broke the dedicated `change<Shape>(doc: TypedDoc<Shape>, ...)` overload because TypeScript could not infer `Shape` from the intersection type.

**Root cause**: The dedicated `TypedDoc<Shape>` overload was matched first but failed to infer `Shape`. The existing `[EXT_SYMBOL]` overload — which extracts the draft type from the well-known symbol property — handles this correctly for all cases.

**Fix**: Removed the dedicated `TypedDoc<Shape>` overload from `change()` in `packages/change/src/functional-helpers.ts`. The `[EXT_SYMBOL]` overload now handles `TypedDoc<D>`, `Doc<D, E>`, Lens, and any other object with `[EXT_SYMBOL].change`. See Learnings section for full analysis.

## Resources for Implementation

### Key Files

**Phase 1:**
- `packages/repo/src/handle.ts` (source for extraction)
- `packages/repo/src/sync.ts` (update imports)

**Phase 2:**
- All `*.test.ts` files
- All `examples/*/src/*.tsx` files

**Phase 3:**
- `packages/repo/src/repo.ts`
- `packages/hooks-core/src/create-hooks.ts`
- `packages/hooks-core/src/create-ref-hooks.ts`
- `packages/change/src/shape.ts`

### Migration Pattern Reference

```typescript
// REPO API
// Before:
const handle = repo.getHandle(docId, schema, { presence: PresenceSchema })
handle.doc.title.insert(0, "Hello")
await handle.waitForSync()
handle.presence.setSelf({ status: "online" })

// After:
const doc = repo.get(docId, schema, { presence: PresenceSchema })
doc.title.insert(0, "Hello")
await sync(doc).waitForSync()
sync(doc).presence.setSelf({ status: "online" })

// REACT HOOKS
// Before:
const handle = useHandle(docId, schema)
const snapshot = useDoc(handle)
const { value, placeholder } = useRefValue(handle.doc.title)

// After:
const doc = useDocument(docId, schema)
const snapshot = useValue(doc)
const value = useValue(doc.title)
const placeholder = usePlaceholder(doc.title)
```

## Changeset

**Type:** Major (breaking changes)

**Summary:**
Remove deprecated APIs in preparation for v6 release. The Doc-first API (`repo.get()` + `sync()`) is now the only supported pattern.

### Breaking Changes

1. **`repo.getHandle()` removed** - Use `repo.get()` + `sync()` instead
2. **`Handle` class removed** - Use `Doc<D, E>` with `sync()` for sync capabilities
3. **`useHandle` hook removed** - Use `useDocument()` instead
4. **`useDoc` hook removed** - Use `useValue()` instead
5. **`useRefValue` hook removed** - Use `useValue()` + `usePlaceholder()` instead
6. **`Shape.map()` removed** - Use `Shape.struct()` instead
7. **`Shape.plain.object()` removed** - Use `Shape.plain.struct()` instead

### Not Removed (kept with @deprecated)

- `Draft<T>` type alias (use `Mutable<T>`)
- `InferDraftType<T>` type alias (use `InferMutableType<T>`)

These are harmless type aliases that don't affect bundle size.

## Learnings

### Key Facts Discovered

1. **`Doc<D, E>` uses phantom types for ephemeral inference** - The `E` type parameter is carried via an optional `__ephemeralType` property that exists only at the type level, never set at runtime. This allows `sync()` to extract the ephemeral type without runtime overhead.

2. **Module extraction is the critical path for deprecation** - When deprecating a large module like `handle.ts` (~600 lines), extract shared utilities first. Both old and new code can then import from the new locations, avoiding circular dependencies.

3. **Re-export conflicts require explicit exports** - When both deprecated and new modules export the same symbols, `export *` causes TS2308 duplicate export errors. Use explicit named exports to control what comes from where.

4. **Test count changes track migration progress** - We went from 740 → 735 tests after removing the "Legacy Handle API" section from `sync.test.ts`. This is expected when removing tests for deprecated functionality.

5. **`TypedDoc` already has `[EXT_SYMBOL].change` for draft type extraction** - The `TypedDoc<Shape>` type includes a `readonly [EXT_SYMBOL]: { change: (fn: (draft: Mutable<Shape>) => void, ...) => void }` property. This was designed specifically as a fallback when TypeScript can't infer `Shape` from `TypedDoc<Shape>` directly (e.g., when types are flattened across module boundaries in `.d.ts` files).

### New Findings and Insights

#### Intersection Types Break TypeScript Overload Resolution

`Doc<D, E>` (which is `TypedDoc<D> & { __ephemeralType?: E }`) does not match a function overload expecting `TypedDoc<Shape>`. When `change()` had a dedicated overload:

```typescript
// This overload FAILS for Doc<D, E>
export function change<Shape extends DocShape>(
  doc: TypedDoc<Shape>,
  fn: (draft: Mutable<Shape>) => void,
): TypedDoc<Shape>
```

TypeScript cannot infer `Shape` from the intersection type `TypedDoc<D> & { __ephemeralType?: E }`. The draft parameter becomes `unknown`.

An initial attempt to fix this with a two-type-parameter overload:

```typescript
// This overload ALSO FAILS - for the OPPOSITE reason
export function change<D extends DocShape, T extends TypedDoc<D>>(
  doc: T,
  fn: (draft: Mutable<D>) => void,
): T
```

...introduced 122 type errors in test files. The problem is that TypeScript also cannot infer `D` from `T extends TypedDoc<D>` when `T` is a plain `TypedDoc<SomeSchema>`. The two-type-parameter approach breaks the common case to fix the phantom type case.

#### The `[EXT_SYMBOL]` Overload Is the Correct Solution

The existing `[EXT_SYMBOL]` overload already handles this correctly for all cases:

```typescript
export function change<
  T extends {
    [EXT_SYMBOL]: {
      change: (fn: (draft: any) => void, options?: ChangeOptions) => void
    }
  },
>(target: T, fn: (draft: ExtractDraft<T>) => void, options?: ChangeOptions): T
```

Where `ExtractDraft<T>` extracts the draft type from `[EXT_SYMBOL].change`:

```typescript
type ExtractDraft<T> = T extends {
  [EXT_SYMBOL]: {
    change: (fn: (draft: infer D) => void, ...) => void
  }
} ? D : never
```

This works because:
- It doesn't try to match `TypedDoc<Shape>` as a structural constraint
- It extracts the draft type from the well-known `[EXT_SYMBOL]` property
- Both `TypedDoc<D>` and `Doc<D, E>` have `[EXT_SYMBOL]` with the correct `Mutable<D>` type
- The return type is `T`, preserving the full input type

**The fix**: Remove the dedicated `TypedDoc<Shape>` overload entirely. Let all TypedDoc-like objects (including `Doc<D, E>`, Lens, etc.) fall through to the `[EXT_SYMBOL]` overload. This is exactly why `[EXT_SYMBOL].change` was put on `TypedDoc` in the first place.

#### Module Extraction Pattern for Deprecation

When deprecating a large module, follow this pattern:

1. **Identify shared dependencies** - What does both old and new code need? (`TypedEphemeral`, `SyncTimeoutError`, `NoAdaptersError`)
2. **Create dedicated modules** - `sync-errors.ts`, `typed-ephemeral.ts`
3. **Update new code first** - `sync.ts` imports from new locations
4. **Add re-exports to old module** - `handle.ts` re-exports for backward compatibility
5. **Use explicit exports in index.ts** - Avoid `export *` conflicts
6. **Delete old module in major release** - After all consumers migrated

```typescript
// index.ts - explicit exports avoid conflicts
export * from "./sync-errors.js"
export * from "./typed-ephemeral.js"
export {
  createHandle,
  EphemeralDeclarations,
  Handle,
  HandleWithEphemerals,
  ReadinessCheck,
  // Don't re-export TypedEphemeral - it's in typed-ephemeral.js
} from "./handle.js"
```

#### Test Migration is Mechanical

The transformation pattern is straightforward:
```typescript
repo.getHandle(id, schema, eph) → repo.get(id, schema, eph)
handle.doc.field → doc.field
change(handle.doc, draft => ...) → change(doc, draft => ...)
handle.waitForSync() → sync(doc).waitForSync()
handle.presence → sync(doc).presence
```

After the `change()` overload fix, `change(doc, draft => ...)` works correctly with `Doc<D, E>`. No workarounds needed.

### Corrections to Previous Assumptions

#### ❌ "The TypedDoc overload in change() is needed"

**Correction**: The dedicated `change<Shape>(doc: TypedDoc<Shape>, ...)` overload is not only unnecessary—it actively prevents `Doc<D, E>` from working. The `[EXT_SYMBOL]` overload handles all `TypedDoc`-like objects correctly because it extracts the draft type from the symbol property rather than trying to structurally match `TypedDoc<Shape>`. Removing the TypedDoc overload fixes both `TypedDoc<D>` and `Doc<D, E>` while reducing overload complexity.

#### ❌ "Direct mutation is a workaround for change() not working"

**Correction**: Direct mutation was proposed as a workaround before we understood the root cause. The actual fix is removing the `TypedDoc<Shape>` overload from `change()`. With the fix, `change(doc, draft => ...)` works correctly with `Doc<D, E>`. Direct mutation is still valid for simple cases but `change()` is essential for batching mutations into a single commit with commit messages.

#### ❌ "A two-type-parameter overload can fix intersection type inference"

**Correction**: Replacing `change<Shape>(doc: TypedDoc<Shape>, ...)` with `change<D, T extends TypedDoc<D>>(doc: T, ...)` does not work. TypeScript cannot infer `D` from `T extends TypedDoc<D>` when `T = TypedDoc<SomeSchema>` directly. This "fix" broke 122 tests in the repo package while only solving the phantom type case. The correct approach is to remove the overload entirely and rely on the `[EXT_SYMBOL]` fallback.

#### ❌ "Harmless type aliases should be removed in major releases"

**Correction**: Type aliases like `Draft<T>` and `MapContainerShape` that are just one-line aliases add zero runtime overhead. Removing them in a major release adds breaking changes without meaningful benefit. Keep them with `@deprecated` markers indefinitely or until a future major version.

#### ❌ "export * is safe when modules don't overlap"

**Correction**: While `export *` doesn't cause runtime issues when modules don't overlap, it can cause type inference problems. The TypeScript compiler sometimes struggles to track generic type parameters through multiple layers of re-exports. This manifests as `unknown` types where specific types are expected.

### New Findings from Example Migration

#### Type Inference Issues with `useValue()`

During the example migrations, we discovered that `useValue()` frequently returns `unknown` instead of the expected `Infer<Schema>` type. This happens because:

1. `Doc<D, E>` is defined as `TypedDoc<D> & { readonly __ephemeralType?: E }`
2. When passed to `useValue()`, TypeScript doesn't always correctly infer `D` from the intersection type
3. This cascades through the codebase, requiring explicit type casts

**Workaround applied:** Cast `useValue(doc)` results to the expected snapshot type:
```typescript
const snapshot = useValue(doc) as { todos: readonly Todo[] }
```

#### `useUndoManager` Updated to Accept Doc ✅

The `useUndoManager` hook was updated to accept both `Handle` (deprecated) and `TypedDoc`/`Doc` (new API):

1. Added overloads for both `TypedDoc<DocShape>` and `Handle<DocShape, EphemeralDeclarations>`
2. Internal implementation uses `loro(doc)` to get `LoroDoc` from `TypedDoc`
3. Deprecation warning emitted when `Handle` is passed
4. React wrapper in `hooks-core.ts` updated with matching overloads

**Migration pattern:**
```typescript
// Before
const handle = useHandle(docId, schema)
const { undo, redo } = useUndoManager(handle)

// After
const doc = useDocument(docId, schema)
const { undo, redo } = useUndoManager(doc)
```

#### Lens `change()` Type Inference

The `change()` function's generic overload using `ExtractDraft<T>` doesn't work well with `Lens<D>` when `D` is a complex generic type. TypeScript fails to extract the correct draft type.

**Workaround applied:** Use `lens[EXT_SYMBOL].change()` directly with explicit type annotation:
```typescript
(lens as { [EXT_SYMBOL]: { change: (fn: (d: Mutable<GameDocShape>) => void, opts?: {...}) => void } })[EXT_SYMBOL].change(...)
```

#### `useLens()` Type Inference with `Doc<D>`

When `useLens()` receives a `Doc<D>` (which extends `TypedDoc<D>`), the return type's `doc` property (the JSON snapshot) is typed as `unknown` instead of `Infer<D>`.

**Workaround applied:** Cast the document to `TypedDoc<Schema>` explicitly:
```typescript
const { lens, doc: worldview } = useLens(doc as TypedDoc<GameDocShape>, {...})
```

**Correction**: Even when you think modules don't overlap, re-exports for backward compatibility can cause conflicts. When `handle.ts` re-exports `TypedEphemeral` from `typed-ephemeral.ts`, and `index.ts` does `export * from "./handle.js"` AND `export * from "./typed-ephemeral.js"`, you get TS2308 duplicate export errors. Always audit re-export chains.

### Recommendations for Future Work

1. **Extract utilities before deprecating** - Identify what's reusable and move it to dedicated modules first
2. **Use explicit exports** - Avoid `export *` when multiple modules might export the same symbols
3. **Lean on `[EXT_SYMBOL]` for type extraction** - It was designed for exactly this class of problem; don't add dedicated overloads that compete with it
4. **Test phantom types with all consumers** - Intersection types can break function overloads in unexpected ways; when they do, look for existing escape hatches before adding new overloads
5. **Keep harmless aliases** - One-line type aliases don't affect bundle size; removing them just creates churn
6. **Track test counts** - Changes in test count help verify migration is proceeding correctly