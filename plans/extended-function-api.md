# Plan: Introduce `ext()` Function for loro-extended API

## Background

The `@loro-extended/change` package provides a type-safe wrapper around Loro CRDTs. Currently, the `loro()` function serves as an escape hatch to access CRDT internals, but it has become overloaded with both native Loro concepts and loro-extended-specific features.

### Current Symbol System

1. **`INTERNAL_SYMBOL`** - Private implementation details (absorbPlainValues, getTypedRefParams, etc.)
2. **`LORO_SYMBOL`** - Escape hatch for CRDT internals via `loro()` function

### Current `loro()` Return Types

For TypedDoc, `loro(doc)` returns `LoroTypedDocRef`:

```typescript
interface LoroTypedDocRef extends LoroRefBase {
  readonly doc: LoroDoc; // Native Loro
  readonly container: LoroDoc; // Native Loro
  subscribe(): Subscription; // Native Loro
  applyPatch(): void; // loro-extended specific
  readonly docShape: DocShape; // loro-extended specific
  readonly rawValue: unknown; // loro-extended specific
  readonly mergeable: boolean; // loro-extended specific
}
```

For TypedRef, `loro(ref)` returns `LoroRefBase`:

```typescript
interface LoroRefBase {
  readonly doc: LoroDoc;
  readonly container: unknown;
  subscribe(): Subscription;
}
```

---

## Problem Statement

1. **Conceptual confusion**: `loro(doc)` returns an object with `.doc` property, not the LoroDoc itself. Users must write `loro(doc).doc.frontiers()` instead of `loro(doc).frontiers()`.

2. **Mixed concerns**: `LoroTypedDocRef` mixes native Loro concepts with loro-extended-specific features, making `ReturnType<typeof loro>` unclear.

3. **API surface pollution**: TypedDoc proxy exposes `change()`, `forkAt()`, `initialize()` directly, which pollutes the schema property namespace.

4. **Redundant functional helpers**: `functional-helpers.ts` exports `fork`, `forkAt`, `shallowForkAt`, `getLoroDoc`, `getLoroContainer` which duplicate functionality and add confusion.

---

## Success Criteria

1. ✅ `loro(doc)` returns `LoroDoc` directly
2. ✅ `loro(ref)` returns the native Loro container directly (LoroText, LoroList, etc.)
3. ✅ `ext()` provides all loro-extended-specific features
4. ✅ `ext(ref).doc` provides access to LoroDoc from any ref
5. ✅ `ext(doc).subscribe()` provides convenient subscription with jsonpath support
6. ✅ TypedDoc proxy only exposes `toJSON()` (standard JS convention)
7. ✅ Keep `change()` functional helper (only exception - too common to break)
8. ✅ Remove other redundant functional helpers
9. ✅ Remove `Handle.change()` from repo (use `change(handle.doc, fn)` instead)
10. ✅ All existing tests updated to use new API
11. ✅ Transitive dependencies updated (packages/repo, packages/react, examples)
12. ✅ Documentation updated

---

## The Gap

### What Needs to Change

| Current                  | New                                                      |
| ------------------------ | -------------------------------------------------------- |
| `loro(doc).doc`          | `loro(doc)`                                              |
| `loro(doc).container`    | `loro(doc)`                                              |
| `loro(doc).subscribe()`  | `loro(doc).subscribe()` (same) or `ext(doc).subscribe()` |
| `loro(doc).applyPatch()` | `ext(doc).applyPatch()`                                  |
| `loro(doc).docShape`     | `ext(doc).docShape`                                      |
| `loro(doc).rawValue`     | `ext(doc).rawValue`                                      |
| `loro(doc).mergeable`    | `ext(doc).mergeable`                                     |
| `loro(ref).container`    | `loro(ref)`                                              |
| `loro(ref).doc`          | `ext(ref).doc`                                           |
| `doc.change()`           | `ext(doc).change()` or `change(doc, fn)`                 |
| `doc.forkAt()`           | `ext(doc).forkAt()`                                      |
| `doc.initialize()`       | `ext(doc).initialize()`                                  |
| `change(doc, fn)`        | `change(doc, fn)` (unchanged - kept for convenience)     |
| `fork(doc)`              | `ext(doc).fork()`                                        |
| `forkAt(doc, f)`         | `ext(doc).forkAt(f)`                                     |
| `shallowForkAt(doc, f)`  | `ext(doc).shallowForkAt(f)`                              |
| `getLoroDoc(doc)`        | `loro(doc)`                                              |
| `getLoroContainer(ref)`  | `loro(ref)`                                              |
| `handle.change(fn)`      | `change(handle.doc, fn)`                                 |

---

## Phases and Tasks

### Phase 1: Create `ext()` Infrastructure 🔴

- 🔴 Create `packages/change/src/ext.ts` with:

  - `EXT_SYMBOL` symbol
  - `ExtDocRef<Shape>` interface (includes change, fork, forkAt, shallowForkAt, initialize, mergeable, docShape, applyPatch, rawValue, subscribe)
  - `ExtRefBase` interface (includes doc, change, subscribe)
  - `ExtListRef` interface (extends RefBase, adds pushContainer/insertContainer)
  - `ExtMapRef` interface (extends RefBase, adds setContainer)
  - `ext()` function with overloads for TypedDoc and all TypedRef types

- 🔴 Add `[EXT_SYMBOL]` to TypedDoc proxy in `typed-doc.ts`:

  - Create `extNamespace` object with all loro-extended features
  - Wire up in proxy's `get` handler

- 🔴 Add `[EXT_SYMBOL]` to `BaseRefInternals` in `typed-refs/base.ts`:

  - Create `createExtNamespace()` method
  - Include `doc` property to access LoroDoc from any ref
  - Add getter for `[EXT_SYMBOL]`

- 🔴 Update each ref internals class to implement `createExtNamespace()`:
  - `StructRefInternals` - add setContainer
  - `RecordRefInternals` - add setContainer
  - `ListRefInternals` - add pushContainer, insertContainer
  - `MovableListRefInternals` - add pushContainer, insertContainer
  - `TextRefInternals` - base only (doc, change, subscribe)
  - `CounterRefInternals` - base only (doc, change, subscribe)
  - `TreeRefInternals` - base only (doc, change, subscribe)

### Phase 2: Simplify `loro()` Function 🔴

- 🔴 Update `packages/change/src/loro.ts`:

  - Change `loro(doc)` to return `LoroDoc` directly
  - Change `loro(ref)` to return the container directly
  - Remove `LoroTypedDocRef`, `LoroRefBase`, `LoroListRef`, `LoroMapRef`, etc. interfaces
  - Keep `LORO_SYMBOL` for internal use

- 🔴 Update `createLoroNamespace()` in `BaseRefInternals`:

  - Return the container directly instead of an object

- 🔴 Update `loroNamespace` in `typed-doc.ts`:
  - Return the LoroDoc directly instead of an object

### Phase 3: Remove TypedDoc Proxy Methods 🔴

- 🔴 Update `packages/change/src/typed-doc.ts`:
  - Remove `change()` from proxy
  - Remove `forkAt()` from proxy
  - Remove `initialize()` from proxy
  - Update `TypedDoc<Shape>` type to only include `toJSON()`
  - Keep `[LORO_SYMBOL]` and `[EXT_SYMBOL]` in proxy

### Phase 4: Update Functional Helpers 🔴

- 🔴 Update `packages/change/src/functional-helpers.ts`:

  - Keep `change()` function (only exception - too common to break)
  - Remove `fork()` function
  - Remove `forkAt()` function
  - Remove `shallowForkAt()` function
  - Remove `getLoroDoc()` function
  - Remove `getLoroContainer()` function
  - Keep `getTransition()` (special case: takes doc + event)

- 🔴 Update `packages/change/src/index.ts`:
  - Keep `change` export
  - Remove exports for other deleted functional helpers
  - Remove exports for deleted interfaces (LoroTypedDocRef, LoroRefBase, etc.)
  - Add exports for `ext()`, `EXT_SYMBOL`, and new interfaces

### Phase 5: Update `@loro-extended/change` Tests 🔴

- 🔴 Update `loro.test.ts`:

  - Change `loro(doc).doc` to `loro(doc)`
  - Change `loro(ref).container` to `loro(ref)`
  - Move loro-extended feature tests to new `ext.test.ts`

- 🔴 Create `ext.test.ts`:

  - Test `ext(doc).change()`
  - Test `ext(doc).forkAt()`
  - Test `ext(doc).fork()`
  - Test `ext(doc).shallowForkAt()`
  - Test `ext(doc).initialize()`
  - Test `ext(doc).mergeable`
  - Test `ext(doc).docShape`
  - Test `ext(doc).applyPatch()`
  - Test `ext(doc).rawValue`
  - Test `ext(doc).subscribe()` with jsonpath
  - Test `ext(ref).doc` returns LoroDoc
  - Test `ext(ref).change()`
  - Test `ext(ref).subscribe()`
  - Test `ext(list).pushContainer()`
  - Test `ext(struct).setContainer()`

- 🔴 Update `functional-helpers.test.ts`:

  - Keep tests for `change()` function
  - Remove tests for deleted functions (fork, forkAt, shallowForkAt, getLoroDoc, getLoroContainer)
  - Keep tests for `getTransition()`

- 🔴 Update `fork-at.test.ts`:

  - Change `doc.forkAt()` to `ext(doc).forkAt()`
  - Change `loro(doc).doc.frontiers()` to `loro(doc).frontiers()`

- 🔴 Update `change.test.ts`:

  - Change `loro(doc).rawValue` to `ext(doc).rawValue`

- 🔴 Update `json-patch.test.ts`:

  - Change `loro(doc).applyPatch()` to `ext(doc).applyPatch()`

- 🔴 Update `mergeable-flattened.test.ts`:

  - Change `loro(doc).doc` to `loro(doc)`

- 🔴 Update `shallow-fork.test.ts`:

  - Change `loro(doc).doc` to `loro(doc)`

- 🔴 Update `nested-container-materialization.test.ts`:

  - Change `loro(doc).doc` to `loro(doc)`
  - Change `loro(ref).container` to `loro(ref)`

- 🔴 Update `typed-doc-metadata.test.ts`:

  - Change `doc.initialize()` to `ext(doc).initialize()`

- 🔴 Update `grand-unified-api.test.ts`:

  - Update all `loro()` usage

- 🔴 Update `diff-overlay.test.ts`:
  - Change `loro(doc).doc` to `loro(doc)`

### Phase 6: Update `@loro-extended/repo` 🔴

- 🔴 Update `packages/repo/src/handle.ts`:

  - Change `loro(this._doc).doc` to `loro(this._doc)`
  - Change `loro(this._doc).mergeable` to `ext(this._doc).mergeable`
  - Remove `change()` method from Handle class
  - Import `ext` from `@loro-extended/change`

- 🔴 Update all test files in `packages/repo/src/tests/`:
  - Change `handle.change(fn)` to `change(handle.doc, fn)`
  - Change `loro(doc).doc` to `loro(doc)`

### Phase 7: Update `@loro-extended/react` 🔴

- 🔴 Update `packages/react/src/index.ts`:
  - Keep `change` re-export (it's still available)
  - Remove `getLoroDoc` re-export
  - Add `ext, loro` re-exports

### Phase 8: Update Examples 🔴

- 🔴 Update `examples/rps-demo/src/client/use-rps-game.ts`:

  - Change `loro(lens.worldview).subscribe()` to `loro(lens.worldview).subscribe()` (same - LoroDoc has subscribe)
  - Change `lens.change(fn)` to `change(lens, fn)` (using functional helper)

- 🔴 Update `examples/rps-demo/src/server/server.ts`:

  - Change `loro(lens.worldview).doc.subscribe()` to `loro(lens.worldview).subscribe()`
  - Change `loro(lens.world).doc` to `loro(lens.world)`
  - Change `lens.change(fn)` to `change(lens, fn)`

- 🔴 Update `examples/rps-demo/src/shared/filters.integration.test.ts`:

  - Change `loro(world).doc` to `loro(world)`
  - Keep `change(world, fn)` (unchanged - functional helper kept)

- 🔴 Update `examples/postgres/src/index.ts`:

  - Change `handle.change(fn)` to `change(handle.doc, fn)`

- 🔴 Update `examples/chat/src/server/server.ts`:

  - Change `handle.change(fn)` to `change(handle.doc, fn)`

- 🔴 Update `examples/bumper-cars/src/server/game-loop.ts`:
  - Change `handle.change(fn)` to `change(handle.doc, fn)`

### Phase 9: Documentation 🔴

- 🔴 Update `packages/change/README.md`:

  - Document new `loro()` behavior (returns native types directly)
  - Document new `ext()` function
  - Add migration guide from old API

- 🔴 Update any TECHNICAL.md files if they exist

- 🔴 Create changeset for major version bump

---

## Unit and Integration Tests

### New Tests to Create

1. **`ext.test.ts`** - Comprehensive tests for the new `ext()` function:

   - TypedDoc: change, fork, forkAt, shallowForkAt, initialize, mergeable, docShape, applyPatch, rawValue, subscribe
   - TypedRef: doc, change, subscribe
   - ListRef: pushContainer, insertContainer
   - StructRef/RecordRef: setContainer

2. **Update existing tests** - All tests using old API patterns must be updated

### Test Strategy

- Reuse existing test helpers from `test-setup.ts`
- Focus on high-risk areas: the new `ext()` function and simplified `loro()` return types
- Ensure backward compatibility is NOT maintained (this is a breaking change)

---

## Transitive Effect Analysis

### Direct Dependencies

```
@loro-extended/change
├── @loro-extended/repo (imports loro, change, getLoroDoc, etc.)
├── @loro-extended/react (re-exports change, getLoroDoc)
└── examples/* (use loro, change, handle.change)
```

### Transitive Effects

1. **`@loro-extended/repo`**:

   - `handle.ts` uses `loro(this._doc).doc`, `loro(this._doc).mergeable`, `this._doc.change()`
   - All test files use `handle.change()` and `loro(doc).doc`
   - **Impact**: Must update handle.ts and ~50+ test file usages

2. **`@loro-extended/react`**:

   - Re-exports `change, getLoroDoc` from `@loro-extended/change`
   - **Impact**: Must update re-exports

3. **Examples**:
   - `rps-demo`: Uses `loro().doc`, `lens.change()`, `change()`
   - `postgres`: Uses `handle.change()`
   - `chat`: Uses `handle.change()`
   - `bumper-cars`: Uses `handle.change()`
   - **Impact**: Must update all examples

### Dependency Chain

```
User code
  └── @loro-extended/react
        └── @loro-extended/repo
              └── @loro-extended/change (this package)
                    └── loro-crdt (native)
```

All packages in the chain must be updated together in this major release.

---

## Changeset

````markdown
---
"@loro-extended/change": major
"@loro-extended/repo": major
"@loro-extended/react": major
---

# Breaking: Introduce `ext()` function, simplify `loro()`

## Breaking Changes

### `loro()` now returns native Loro types directly

Before:

```typescript
const loroDoc = loro(doc).doc;
const frontiers = loro(doc).doc.frontiers();
const loroText = loro(doc.title).container;
```
````

After:

```typescript
const loroDoc = loro(doc);
const frontiers = loro(doc).frontiers();
const loroText = loro(doc.title);
```

### `ext()` provides loro-extended-specific features

Before:

```typescript
doc.change(draft => { ... })
doc.forkAt(frontiers)
doc.initialize()
loro(doc).applyPatch(patch)
loro(doc).mergeable
loro(doc).docShape
loro(doc).rawValue
loro(ref).doc  // to get LoroDoc from a ref
```

After:

```typescript
ext(doc).change(draft => { ... })  // or change(doc, fn)
ext(doc).forkAt(frontiers)
ext(doc).initialize()
ext(doc).applyPatch(patch)
ext(doc).mergeable
ext(doc).docShape
ext(doc).rawValue
ext(ref).doc  // to get LoroDoc from a ref
```

### Removed functional helpers

The following functions have been removed:

- `fork()` - use `ext(doc).fork()`
- `forkAt()` - use `ext(doc).forkAt()`
- `shallowForkAt()` - use `ext(doc).shallowForkAt()`
- `getLoroDoc()` - use `loro(doc)` directly, or `ext(ref).doc` for refs
- `getLoroContainer()` - use `loro(ref)` directly

**Kept for convenience:**

- `change(doc, fn)` - still available as a functional helper

### TypedDoc no longer has `change()`, `forkAt()`, `initialize()` methods

These methods have moved to `ext(doc)`.

### `Handle.change()` removed from @loro-extended/repo

Use `change(handle.doc, fn)` instead.

## Migration Guide

1. Replace `loro(doc).doc` with `loro(doc)`
2. Replace `loro(ref).container` with `loro(ref)`
3. Replace `loro(ref).doc` with `ext(ref).doc`
4. Replace `doc.change(fn)` with `ext(doc).change(fn)` or `change(doc, fn)`
5. Replace `doc.forkAt(f)` with `ext(doc).forkAt(f)`
6. Replace `doc.initialize()` with `ext(doc).initialize()`
7. Replace `loro(doc).applyPatch()` with `ext(doc).applyPatch()`
8. Replace `fork(doc)` with `ext(doc).fork()`
9. Replace `forkAt(doc, f)` with `ext(doc).forkAt(f)`
10. Replace `getLoroDoc(doc)` with `loro(doc)`
11. Replace `getLoroContainer(ref)` with `loro(ref)`
12. Replace `handle.change(fn)` with `change(handle.doc, fn)`

---

## Summary

This plan introduces a clean separation between native Loro access (`loro()`) and loro-extended-specific features (`ext()`). The major version bump allows us to break backward compatibility for the sake of long-term API clarity and developer experience.

Key design decisions:

1. **`loro()` returns native types directly** - No more `.doc` or `.container` indirection
2. **`ext()` for loro-extended features** - Clear namespace for library-specific functionality
3. **`change()` functional helper kept** - Too common to break; provides convenient `change(doc, fn)` syntax
4. **`ext(ref).doc` for LoroDoc access** - Since `loro(ref)` now returns the container, refs need another way to access the doc
5. **`Handle.change()` removed** - Use `change(handle.doc, fn)` for consistency

---

# Post-implementation Learnings

## Technical Learnings: Implementing the `ext()` Function API for loro-extended

### Key Architectural Insights

1. **Symbol-based Escape Hatches Work Well for Proxy Objects**

   - The loro-extended library uses Proxy objects extensively for TypedDoc and TypedRef types
   - Using well-known symbols (`LORO_SYMBOL`, `EXT_SYMBOL`) allows clean separation between:
     - Schema property access (normal property names)
     - Native Loro access (`loro()` function)
     - Library-specific features (`ext()` function)
   - Proxies must explicitly handle symbol access in their `get` handler - symbols don't automatically pass through to the target

2. **Proxy Handler Completeness Matters**

   - When adding a new symbol to a proxy, you must update both:
     - The `get` handler (to return the value)
     - The `has` handler (to report the property exists)
   - Missing the `has` handler can cause subtle bugs with `in` operator checks

3. **Inheritance and Symbol Access**
   - If a base class has a symbol getter (e.g., `get [EXT_SYMBOL](): ExtRefBase`), subclasses inherit it
   - But if the subclass is wrapped in a Proxy, the proxy must explicitly forward the symbol access
   - The pattern `target[INTERNAL_SYMBOL].getExtNamespace()` works better than trying to access the symbol directly on the internals class

### Monorepo Build Order Dependencies

4. **Build Before Test When Changing Exports**

   - When changing a package's public API, dependent packages use the **built** output, not source
   - Running `pnpm verify` on a dependent package will use stale built artifacts
   - Always rebuild changed packages before testing dependents:
     ```bash
     cd packages/change && pnpm build
     cd packages/repo && pnpm verify
     ```

5. **Transitive Dependencies Require Full Rebuild Chain**
   - In this monorepo: `change` → `repo` → `react` → examples
   - Changing `change` requires rebuilding before testing `repo`, `lens`, `hooks-core`, etc.
   - The root `pnpm verify` handles this correctly, but individual package verification may not

### API Design Patterns

6. **Keeping Convenience Functions Despite API Changes**

   - The `change(doc, fn)` functional helper was kept even though `ext(doc).change(fn)` exists
   - Rationale: It's the most commonly used function and breaking it would cause too much churn
   - This is a pragmatic exception to the "everything through `ext()`" rule

7. **Type Narrowing with Function Overloads**
   - The `ext()` function uses overloads to return different types based on input:
     ```typescript
     export function ext<D extends DocShape>(doc: TypedDoc<D>): ExtDocRef<D>;
     export function ext(ref: TextRef): ExtRefBase;
     export function ext(ref: ListRef<any>): ExtListRef;
     // ... etc
     ```
   - This provides excellent TypeScript inference while keeping a single function name

### Common Migration Pitfalls

8. **`.doc` Property Removal Cascade**

   - Changing `loro(doc).doc` → `loro(doc)` affects many patterns:
     - `loro(doc).doc.frontiers()` → `loro(doc).frontiers()`
     - `loro(doc).doc.subscribe()` → `loro(doc).subscribe()`
     - `loro(doc).doc.import()` → `loro(doc).import()`
   - Use sed carefully: `sed -i '' 's/loro(\([^)]*\))\.doc/loro(\1)/g'` works but may need manual review

9. **Ref vs Doc Access Patterns Diverge**

   - Old: Both `loro(doc).doc` and `loro(ref).doc` gave you the LoroDoc
   - New: `loro(doc)` returns LoroDoc, but `loro(ref)` returns the container
   - To get LoroDoc from a ref: `ext(ref).doc`

10. **Test Files Often Use Internal APIs**
    - Test files frequently use patterns like `source.change()` that are now `ext(source).change()`
    - Don't forget to update test file imports when removing exports
    - Test files may also need `change` imported when using the functional helper

### Debugging Tips

11. **"Property does not exist on type 'LoroDoc'" Usually Means Old API**

    - This error typically means code is using `loro(x).doc.method()` instead of `loro(x).method()`
    - The type system correctly identifies that `LoroDoc` doesn't have a `.doc` property

12. **"X is not a function" at Runtime Means Stale Build**
    - If types pass but runtime fails with "X is not a function", the built JS is stale
    - Rebuild the package and its dependencies
