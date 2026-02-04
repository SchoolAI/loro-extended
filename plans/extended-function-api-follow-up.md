# Plan: Extended Function API Follow-up

## Background

The `ext()` function API was implemented in the previous phase, introducing a clean separation between native Loro access (`loro()`) and loro-extended-specific features (`ext()`). However, several follow-up items were identified:

1. Tests for `docShape`, `rawValue`, and `applyPatch` were removed from `loro.test.ts` but equivalent tests exist scattered across other test files
2. `Handle.change()` was kept despite the plan stating it should be removed
3. `ext(doc).change()` creates cognitive load alongside `change(doc, fn)` functional helper
4. No dedicated `ext.test.ts` file exists for explicit API surface testing

## Problem Statement

The current implementation has three ways to mutate documents:
1. `change(doc, fn)` — functional helper
2. `ext(doc).change(fn)` — via ext namespace  
3. `handle.change(fn)` — on Handle objects

This creates cognitive load for users. The plan specified removing `Handle.change()` and using `change(handle.doc, fn)` instead, but this wasn't done. Additionally, the `ext()` API surface lacks dedicated test coverage.

## Success Criteria

1. ✅ `change(doc, fn)` is the canonical, primary way to mutate documents
2. ✅ `Handle.change()` is removed from `@loro-extended/repo`
3. ✅ `ext(doc).change()` is removed (use `change(doc, fn)` instead)
4. ✅ `ext(ref).change()` is removed (use `change(ref, fn)` instead)
5. ✅ All tests updated to use `change(doc, fn)` pattern
6. ✅ Dedicated `ext.test.ts` created with explicit API surface tests
7. ✅ Documentation updated to reflect canonical mutation pattern

---

## The Gap

### What Needs to Change

| Current | New |
|---------|-----|
| `handle.change(fn)` | `change(handle.doc, fn)` |
| `ext(doc).change(fn)` | `change(doc, fn)` |
| `ext(ref).change(fn)` | `change(ref, fn)` |

### What Stays the Same

| API | Purpose |
|-----|---------|
| `ext(doc).fork()` | Fork document |
| `ext(doc).forkAt(f)` | Fork at frontiers |
| `ext(doc).shallowForkAt(f)` | Shallow fork |
| `ext(doc).initialize()` | Initialize metadata |
| `ext(doc).applyPatch(p)` | Apply JSON patch |
| `ext(doc).docShape` | Access schema |
| `ext(doc).rawValue` | Raw CRDT value |
| `ext(doc).mergeable` | Mergeable flag |
| `ext(doc).subscribe(cb)` | Subscribe to changes |
| `ext(ref).doc` | Get LoroDoc from ref |
| `ext(ref).subscribe(cb)` | Subscribe to ref changes |
| `ext(list).pushContainer(c)` | Push container to list |
| `ext(list).insertContainer(i, c)` | Insert container |
| `ext(map).setContainer(k, c)` | Set container on map |

---

## Phases and Tasks

### Phase 1: Remove `ext(doc).change()` and `ext(ref).change()` 🔴

- 🔴 Update `packages/change/src/ext.ts`:
  - Remove `change` method from `ExtDocRef` interface
  - Remove `change` method from `ExtRefBase` interface
  - Update implementation to not include `change` in returned objects

- 🔴 Update `packages/change/src/typed-doc.ts`:
  - Remove `change` from the ext namespace object

- 🔴 Update `packages/change/src/typed-refs/base.ts`:
  - Remove `change` from `getExtNamespace()` return

### Phase 2: Remove `Handle.change()` 🔴

- 🔴 Update `packages/repo/src/handle.ts`:
  - Remove the `change()` method from Handle class
  - Add deprecation comment pointing to `change(handle.doc, fn)`

- 🔴 Update all test files in `packages/repo/src/tests/`:
  - Replace `handle.change(fn)` with `change(handle.doc, fn)`
  - Add `change` import from `@loro-extended/change`

### Phase 3: Update Tests to Use `change(doc, fn)` 🔴

- 🔴 Update `packages/change/src/loro.test.ts`:
  - Replace `ext(doc).change(fn)` with `change(doc, fn)`
  - Keep tests for other `ext()` methods

- 🔴 Update `packages/change/src/grand-unified-api.test.ts`:
  - Replace `ext(doc).change(fn)` with `change(doc, fn)`

- 🔴 Update `packages/change/src/functional-helpers.test.ts`:
  - Remove the "regression: ext(doc).change() still works" test
  - Keep tests for `change(doc, fn)` functional helper

- 🔴 Update other test files using `ext(doc).change()`:
  - `typed-doc-metadata.test.ts`
  - `fork-at.test.ts`
  - `shallow-fork.test.ts`
  - `diff-overlay.test.ts`
  - `path-selector.test.ts`
  - `typed-refs/tree-loro.test.ts`

- 🔴 Update `packages/lens/src/lens.ts`:
  - Replace `ext(worldviewDoc).change(fn)` with `change(worldviewDoc, fn)`

### Phase 4: Create Dedicated `ext.test.ts` 🔴

- 🔴 Create `packages/change/src/ext.test.ts` with explicit tests for:

  **ExtDocRef methods:**
  - `ext(doc).fork()` - creates fork with different peer ID
  - `ext(doc).fork({ preservePeerId: true })` - preserves peer ID
  - `ext(doc).forkAt(frontiers)` - forks at specific version
  - `ext(doc).shallowForkAt(frontiers)` - shallow fork
  - `ext(doc).initialize()` - initializes metadata
  - `ext(doc).applyPatch(patch)` - applies JSON patch
  - `ext(doc).docShape` - returns schema
  - `ext(doc).rawValue` - returns raw CRDT value
  - `ext(doc).mergeable` - returns mergeable flag
  - `ext(doc).subscribe(cb)` - subscribes to changes

  **ExtRefBase methods:**
  - `ext(textRef).doc` - returns LoroDoc
  - `ext(listRef).doc` - returns LoroDoc
  - `ext(counterRef).doc` - returns LoroDoc
  - `ext(structRef).doc` - returns LoroDoc
  - `ext(recordRef).doc` - returns LoroDoc
  - `ext(treeRef).doc` - returns LoroDoc
  - `ext(ref).subscribe(cb)` - subscribes to ref changes

  **ExtListRef methods:**
  - `ext(list).pushContainer(container)` - pushes container
  - `ext(list).insertContainer(index, container)` - inserts container

  **ExtMapRef methods:**
  - `ext(struct).setContainer(key, container)` - sets container
  - `ext(record).setContainer(key, container)` - sets container

### Phase 5: Update Transitive Dependencies 🔴

- 🔴 Update `adapters/websocket/src/__tests__/*.test.ts`:
  - Replace `handle.change(fn)` with `change(handle.doc, fn)`

- 🔴 Update `adapters/http-polling/src/__tests__/*.test.ts`:
  - Replace `handle.change(fn)` with `change(handle.doc, fn)`

- 🔴 Update `adapters/sse/src/__tests__/*.test.ts`:
  - Replace `handle.change(fn)` with `change(handle.doc, fn)`

- 🔴 Update `examples/*/src/**/*.ts`:
  - Replace `handle.change(fn)` with `change(handle.doc, fn)`
  - Replace `ext(doc).change(fn)` with `change(doc, fn)`

### Phase 6: Documentation 🔴

- 🔴 Update `packages/change/README.md`:
  - Document `change(doc, fn)` as the canonical mutation pattern
  - Remove references to `ext(doc).change()`
  - Update migration guide

- 🔴 Update `packages/repo/README.md`:
  - Remove `handle.change()` from API documentation
  - Add note about using `change(handle.doc, fn)`

---

## Unit and Integration Tests

### New Tests in `ext.test.ts`

The new test file should cover the complete `ext()` API surface with minimal boilerplate:

```typescript
// packages/change/src/ext.test.ts
describe("ext() function", () => {
  describe("ExtDocRef", () => {
    it("fork() creates fork with different peer ID")
    it("fork({ preservePeerId: true }) preserves peer ID")
    it("forkAt() forks at specific version")
    it("shallowForkAt() creates shallow fork")
    it("initialize() writes metadata")
    it("applyPatch() applies JSON patch operations")
    it("docShape returns the schema")
    it("rawValue returns raw CRDT value without placeholders")
    it("mergeable returns effective mergeable flag")
    it("subscribe() subscribes to document changes")
  })

  describe("ExtRefBase", () => {
    it("doc returns LoroDoc from TextRef")
    it("doc returns LoroDoc from ListRef")
    it("doc returns LoroDoc from CounterRef")
    it("doc returns LoroDoc from StructRef")
    it("doc returns LoroDoc from RecordRef")
    it("doc returns LoroDoc from TreeRef")
    it("subscribe() subscribes to ref changes")
  })

  describe("ExtListRef", () => {
    it("pushContainer() pushes a Loro container")
    it("insertContainer() inserts a Loro container at index")
  })

  describe("ExtMapRef", () => {
    it("setContainer() sets a Loro container on StructRef")
    it("setContainer() sets a Loro container on RecordRef")
  })
})
```

### Existing Test Updates

Tests that currently use `ext(doc).change()` will be updated to use `change(doc, fn)`. This is a straightforward find-and-replace operation.

---

## Transitive Effect Analysis

### Direct Dependencies

```
@loro-extended/change (this package)
├── @loro-extended/repo (uses Handle.change, ext)
├── @loro-extended/lens (uses ext(doc).change)
├── @loro-extended/react (re-exports change)
├── @loro-extended/hono (re-exports change)
└── @loro-extended/hooks-core (uses change)
```

### Transitive Effects

1. **`@loro-extended/repo`**:
   - `handle.ts` has `change()` method that must be removed
   - ~50+ test files use `handle.change()` pattern
   - **Impact**: All tests must be updated

2. **`@loro-extended/lens`**:
   - `lens.ts` uses `ext(worldviewDoc).change(fn)`
   - **Impact**: Must update to `change(worldviewDoc, fn)`

3. **Adapters** (`websocket`, `http-polling`, `sse`, `webrtc`, `websocket-compat`):
   - Test files use `handle.change()` pattern
   - **Impact**: All adapter tests must be updated

4. **Examples** (`chat`, `postgres`, `bumper-cars`, `rps-demo`, etc.):
   - Use `handle.change()` and `ext(doc).change()` patterns
   - **Impact**: All examples must be updated

### Dependency Chain

```
User code
  └── @loro-extended/react
        └── @loro-extended/repo
              └── @loro-extended/change (this package)
                    └── loro-crdt (native)
```

All packages in the chain must be updated together.

---

## Changeset

```markdown
---
"@loro-extended/change": major
"@loro-extended/repo": major
---

# Breaking: Remove `ext(doc).change()` and `Handle.change()`

## Breaking Changes

### `ext(doc).change()` removed

Use the `change()` functional helper instead:

Before:
```typescript
ext(doc).change(draft => {
  draft.title.insert(0, "Hello")
})
```

After:
```typescript
change(doc, draft => {
  draft.title.insert(0, "Hello")
})
```

### `Handle.change()` removed

Use `change(handle.doc, fn)` instead:

Before:
```typescript
handle.change(draft => {
  draft.title.insert(0, "Hello")
})
```

After:
```typescript
import { change } from "@loro-extended/change"

change(handle.doc, draft => {
  draft.title.insert(0, "Hello")
})
```

## Rationale

Having three ways to mutate documents (`change(doc, fn)`, `ext(doc).change(fn)`, `handle.change(fn)`) created cognitive load. The `change(doc, fn)` functional helper is now the canonical, primary way to mutate documents.

## Migration Guide

1. Replace `ext(doc).change(fn)` with `change(doc, fn)`
2. Replace `handle.change(fn)` with `change(handle.doc, fn)`
3. Ensure `change` is imported from `@loro-extended/change`
```

---

## Summary

This follow-up plan consolidates the mutation API to a single canonical pattern: `change(doc, fn)`. This reduces cognitive load and makes the API more predictable. The `ext()` function remains for accessing loro-extended-specific features like `fork()`, `forkAt()`, `applyPatch()`, etc., but mutation is handled exclusively by the `change()` functional helper.
