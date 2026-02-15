# Plan: Standalone `subscribe()` Function

## Background

The v6 API introduced `change()` as a standalone function for mutations, replacing method-based alternatives (`handle.change()`, `lens.change()`, `ext(ref).change()`). This consolidation simplified the API significantly.

However, subscriptions remain fragmented across three redundant methods:
- `loro(doc).subscribe()` - Native Loro escape hatch
- `ext(doc).subscribe()` - Identical to above, no added value
- `sync(doc).subscribe()` - Also identical, confusingly placed on sync

Additionally, the old `handle.subscribe(selector, callback)` path-selector pattern was lost in v6. This was a powerful feature for type-safe, fine-grained subscriptions.

### Key Files
- `packages/change/src/functional-helpers.ts` - Contains `change()` implementation
- `packages/change/src/path-builder.ts` - Creates path builder for selectors
- `packages/change/src/path-compiler.ts` - Compiles path segments to JSONPath
- `packages/change/src/path-evaluator.ts` - Evaluates paths against documents
- `packages/change/src/ext.ts` - Contains `ext()` and `EXT_SYMBOL`
- `packages/repo/src/sync.ts` - Contains `sync()` implementation

## Problem Statement

1. **Redundant subscription methods**: Three ways to subscribe (`loro()`, `ext()`, `sync()`) that all do the same thing creates confusion
2. **Lost functionality**: Path-selector subscriptions from v5 have no v6 equivalent
3. **Inconsistent API**: `change()` is a standalone function but subscriptions are methods

## Success Criteria

1. `subscribe(doc, callback)` subscribes to whole document changes
2. `subscribe(doc, selector, callback)` subscribes to path-selected changes with type inference
3. `subscribe(ref, callback)` subscribes to a specific container's changes
4. Path selectors return properly typed values (including `T[]` for wildcard paths)
5. `ext(doc).subscribe()` removed (redundant)
6. `sync(doc).subscribe()` removed (redundant)
7. `loro(doc).subscribe()` retained as native Loro escape hatch
8. All existing tests pass or are migrated
9. React hooks (`useValue`) continue to work (they use internal mechanisms)

## The Gap

### Current State
- `subscribe` functionality spread across `loro()`, `ext()`, and `sync()`
- Path-selector subscriptions not available in v6
- `ext(doc).subscribe()` and `sync(doc).subscribe()` are pure redundancy

### Target State
- Single `subscribe()` function in `@loro-extended/change`
- Path-selector support with type-safe callbacks
- `ext(doc).subscribe()` removed
- `sync(doc).subscribe()` removed
- Clean separation: `loro()` for native Loro, `subscribe()` for loro-extended

## Type Signatures

```typescript
import type { LoroEventBatch } from "loro-crdt"
import type { PathBuilder, PathSelector } from "./path-selector.js"
import type { DocShape } from "./shape.js"
import type { TypedDoc } from "./typed-doc.js"

// Overload 1: Whole document subscription (2 args, first is doc)
export function subscribe<D extends DocShape>(
  doc: TypedDoc<D>,
  callback: (event: LoroEventBatch) => void
): () => void

// Overload 2: Path-selector subscription (3 args)
export function subscribe<D extends DocShape, R>(
  doc: TypedDoc<D>,
  selector: (p: PathBuilder<D>) => PathSelector<R>,
  callback: (value: R) => void
): () => void

// Overload 3: Ref subscription (2 args, first is ref)
export function subscribe(
  ref: AnyTypedRef,
  callback: (event: LoroEventBatch) => void
): () => void
```

## Implementation Notes

### Overload Detection Strategy

Detection is based on **argument count and first argument type**:
- **3 arguments** → path-selector subscription (doc, selector, callback)
- **2 arguments + first is TypedDoc** → whole-doc subscription
- **2 arguments + first is TypedRef** → ref subscription

TypedDoc detection: `EXT_SYMBOL in target && "docShape" in target[EXT_SYMBOL]`
TypedRef detection: `LORO_SYMBOL in target && !(EXT_SYMBOL in target && "docShape" in target[EXT_SYMBOL])`

### Deep Equality Strategy

For path-selector subscriptions, use `JSON.stringify` comparison to detect value changes. This is appropriate because:
- `evaluatePath()` returns JSON-serializable values
- Simple and fast for typical document sizes
- No external dependency needed

### Path Subscription Logic

Path-selector subscriptions require handling two storage modes:

1. **Efficient path (subscribeJsonpath)**: When the path doesn't cross a flattening boundary
   - Non-mergeable documents (any path)
   - List-based paths in mergeable documents

2. **Global subscription fallback**: When path crosses struct/record flattening boundary
   - Subscribe to whole doc
   - Evaluate path on each change
   - Compare with previous value via `JSON.stringify`
   - Only invoke callback if value changed

**Important**: Both modes require `evaluatePath()` to extract the typed value for the user callback. `subscribeJsonpath()` only handles *filtering* which events to respond to — its callback receives a raw `LoroEventBatch`, not the evaluated path value. The "efficient" path avoids subscribing to *every* doc change, but still needs `evaluatePath()` to produce the `R` value.

### Tech Debt: `ext(doc).change()` Redundancy

This plan removes `ext(doc).subscribe()` but leaves `ext(doc).change()` — which is the same pattern of redundancy (the standalone `change()` delegates to `extNs.change()` internally). A future cleanup should remove `ext(doc).change()` from `ExtDocRef` as well, keeping `ext()` focused on genuinely extended features (fork, applyPatch, docShape, etc.).

## Phases and Tasks

### Phase 1: Implement Core Utilities ✅

- ✅ **Task 1.1**: Create `packages/change/src/path-subscription.ts` with:
  - `subscribeToPath<D, R>(doc, selector, callback)` - core path subscription logic
  - `requiresGlobalSubscription(segments, docShape)` - detect flattening boundary
  
- ✅ **Task 1.2**: Implement `requiresGlobalSubscription()`:
  - Return `false` for non-mergeable docs
  - Walk path segments against schema
  - Return `true` if path enters a struct/record child in mergeable mode
  - Return `false` for list-only paths (items are hierarchical)

- ✅ **Task 1.3**: Implement `subscribeToPath()`:
  - Create path builder via `createPathBuilder(ext(doc).docShape)`
  - Apply selector to get `PathSelector<R>`
  - If `!requiresGlobalSubscription()`: use `loro(doc).subscribeJsonpath(compiledPath, ...)`
  - Else: use global subscription + `evaluatePath()` + `JSON.stringify` equality check

### Phase 2: Implement `subscribe()` Function ✅

- ✅ **Task 2.1**: Add `subscribe()` to `functional-helpers.ts` with three overloads
- ✅ **Task 2.2**: Implement overload detection based on argument count and type
- ✅ **Task 2.3**: Implement whole-doc subscription (delegates to `loro(doc).subscribe()`)
- ✅ **Task 2.4**: Implement ref subscription (delegates to `loro(ref).subscribe()`)
- ✅ **Task 2.5**: Implement path-selector subscription (delegates to `subscribeToPath()`)
- ✅ **Task 2.6**: Export `subscribe` from `@loro-extended/change` index

### Phase 3: Remove Redundant Methods ✅

- ✅ **Task 3.1**: Remove `subscribe()` from `ExtDocRef` interface in `ext.ts`
- ✅ **Task 3.2**: Remove `subscribe()` implementation from `extNamespace` in `typed-doc.ts`
- ✅ **Task 3.3**: Remove `subscribe()` from `SyncRef` interface in `sync.ts`
- ✅ **Task 3.4**: Remove `subscribe()` implementation from `SyncRefImpl` class
- ✅ **Task 3.5**: Remove `ext(ref).subscribe()` (use `subscribe(ref, callback)` instead)

### Phase 4: Tests ✅

- ✅ **Task 4.1**: Add unit tests for `subscribeToPath()` in `path-subscription.test.ts`:
  - Path with property access
  - Path with wildcard (`$each`) returns array
  - Path with array index (`$at`, `$first`, `$last`)
  - Mergeable doc with list path (efficient)
  - Mergeable doc with record path (fallback)
  - Deep equality prevents false positives

- ✅ **Task 4.2**: Add unit tests for `subscribe()` in `functional-helpers.test.ts`:
  - Whole document subscription
  - Ref subscription
  - Path-selector subscription (delegates to subscribeToPath)
  - Unsubscribe functionality
  
- ✅ **Task 4.3**: Migrate all `ext(doc).subscribe()` and `ext(ref).subscribe()` call sites:
  - `packages/repo/src/tests/handle-subscribe.test.ts` (6 calls) → `subscribe()`
  - `packages/change/src/ext.test.ts` (1 call) → `subscribe(ref, callback)`
  - `packages/change/src/loro.test.ts` (1 call) → `subscribe(ref, callback)`
  - `packages/change/src/functional-helpers.test.ts` (5 calls) → `subscribe(ref, callback)`

- ✅ **Task 4.4**: Migrate all `sync(doc).subscribe()` call sites:
  - `adapters/websocket/src/__tests__/e2e.test.ts` (1 call) → `loro(doc).subscribe()`
  - `adapters/websocket/src/__tests__/hub-spoke-sync.test.ts` (2 calls) → `loro(doc).subscribe()`
  - `adapters/websocket-compat/src/__tests__/e2e.test.ts` (1 call) → `loro(doc).subscribe()`
  - `adapters/websocket-compat/src/__tests__/hub-spoke-sync.test.ts` (2 calls) → `loro(doc).subscribe()`

### Phase 5: Documentation ✅

- ✅ **Task 5.1**: Update `packages/change/README.md`:
  - Add `subscribe()` to API documentation
  - Show examples of all three overloads
  - Document path-selector DSL

- ✅ **Task 5.2**: Update `.changeset/remove-ext-change-and-handle-change.md`:
  - Document removal of `ext(doc).subscribe()` and `sync(doc).subscribe()`
  - Clarify `loro(doc).subscribe()` remains as escape hatch

- ✅ **Task 5.3**: Update `docs/lea.md`:
  - Updated `ext(doc).subscribe()` reference to `subscribe(doc, ...)`

## Tests

### Test 1: Whole document subscription
```typescript
it("should subscribe to all document changes", () => {
  const doc = createTypedDoc(DocSchema)
  const listener = vi.fn()
  
  const unsubscribe = subscribe(doc, listener)
  change(doc, d => d.title.insert(0, "Hello"))
  
  expect(listener).toHaveBeenCalled()
  expect(listener.mock.calls[0][0]).toHaveProperty("by", "local")
  
  unsubscribe()
  listener.mockClear()
  
  change(doc, d => d.title.insert(5, " World"))
  expect(listener).not.toHaveBeenCalled()
})
```

### Test 2: Path-selector subscription with type inference
```typescript
it("should subscribe to path with correct type", () => {
  const DocSchema = Shape.doc({
    config: Shape.struct({ theme: Shape.plain.string() })
  }, { mergeable: false })
  const doc = createTypedDoc(DocSchema)
  let receivedValue: string | undefined
  
  subscribe(doc, p => p.config.theme, (value) => {
    // value is typed as string
    receivedValue = value
  })
  
  change(doc, d => d.config.theme = "dark")
  expect(receivedValue).toBe("dark")
})
```

### Test 3: Wildcard path returns array
```typescript
it("should return array for wildcard paths", () => {
  const DocSchema = Shape.doc({
    books: Shape.list(Shape.struct({ title: Shape.text() }))
  })
  const doc = createTypedDoc(DocSchema)
  let titles: string[] = []
  
  subscribe(doc, p => p.books.$each.title, (value) => {
    // value is typed as string[]
    titles = value
  })
  
  change(doc, d => {
    d.books.push({ title: "Book 1" })
    d.books.push({ title: "Book 2" })
  })
  
  expect(titles).toEqual(["Book 1", "Book 2"])
})
```

### Test 4: Ref subscription
```typescript
it("should subscribe to ref container changes only", () => {
  const doc = createTypedDoc(DocSchema)
  const configListener = vi.fn()
  const titleListener = vi.fn()
  
  subscribe(doc.config, configListener)
  subscribe(doc.title, titleListener)
  
  change(doc, d => d.config.theme = "dark")
  
  expect(configListener).toHaveBeenCalled()
  expect(titleListener).not.toHaveBeenCalled()
})
```

### Test 5: Deep equality prevents false positives (both modes)
```typescript
// Test with non-mergeable (subscribeJsonpath path)
it("should not fire callback when value unchanged (non-mergeable)", () => {
  const DocSchema = Shape.doc({
    config: Shape.struct({ theme: Shape.plain.string() }),
    title: Shape.text()
  }, { mergeable: false })
  const doc = createTypedDoc(DocSchema)
  const listener = vi.fn()
  
  change(doc, d => d.config.theme = "light")
  
  subscribe(doc, p => p.config.theme, listener)
  
  // Change something else
  change(doc, d => d.title.insert(0, "Hello"))
  
  // Should not fire because config.theme didn't change
  expect(listener).not.toHaveBeenCalled()
})

// Test with mergeable (global subscription fallback path)
it("should not fire callback when value unchanged (mergeable)", () => {
  const DocSchema = Shape.doc({
    users: Shape.record(Shape.struct({ name: Shape.plain.string() })),
    title: Shape.text()
  }) // mergeable: true by default
  const doc = createTypedDoc(DocSchema)
  const listener = vi.fn()
  
  change(doc, d => d.users.set("alice", { name: "Alice" }))
  
  subscribe(doc, p => p.users.$key("alice").name, listener)
  
  // Change something else
  change(doc, d => d.title.insert(0, "Hello"))
  
  // Should not fire because alice's name didn't change
  expect(listener).not.toHaveBeenCalled()
})
```

### Test 6: Mergeable doc with record path uses fallback
```typescript
it("should use global subscription for record paths in mergeable docs", () => {
  const DocSchema = Shape.doc({
    users: Shape.record(Shape.struct({ name: Shape.plain.string() }))
  }) // mergeable: true by default
  const doc = createTypedDoc(DocSchema)
  let aliceName: string | undefined
  
  subscribe(doc, p => p.users.$key("alice").name, (value) => {
    aliceName = value
  })
  
  change(doc, d => {
    d.users.set("alice", { name: "Alice Smith" })
  })
  
  expect(aliceName).toBe("Alice Smith")
})
```

## Transitive Effect Analysis

### Direct Dependencies
| Module | Impact |
|--------|--------|
| `functional-helpers.ts` | Add `subscribe()` function |
| `path-subscription.ts` | New file with `subscribeToPath()` |
| `ext.ts` | Remove `subscribe` from `ExtDocRef` |
| `typed-doc.ts` | Remove `subscribe` from extNamespace |
| `sync.ts` | Remove `subscribe` from `SyncRef` and `SyncRefImpl` |
| `index.ts` (change) | Export `subscribe` |

### Transitive Consumers

#### `ext(doc).subscribe()` call sites (6 files)
| File | Count | Action |
|------|-------|--------|
| `packages/repo/src/tests/handle-subscribe.test.ts` | 6 | Migrate to `subscribe()` |
| `packages/change/src/ext.test.ts` | 1 | Migrate to `subscribe()` |
| `packages/change/src/loro.test.ts` | 1 | Migrate to `subscribe()` |

#### `sync(doc).subscribe()` call sites (4 files)
| File | Count | Action |
|------|-------|--------|
| `adapters/websocket/src/__tests__/e2e.test.ts` | 1 | Migrate to `subscribe()` or `loro()` |
| `adapters/websocket/src/__tests__/hub-spoke-sync.test.ts` | 2 | Migrate to `subscribe()` or `loro()` |
| `adapters/websocket-compat/src/__tests__/e2e.test.ts` | 1 | Migrate to `subscribe()` or `loro()` |
| `adapters/websocket-compat/src/__tests__/hub-spoke-sync.test.ts` | 2 | Migrate to `subscribe()` or `loro()` |

#### No change needed
| Consumer | Reason |
|----------|--------|
| `useValue` hook | Uses internal `loroDoc.subscribe()` directly |
| Lens | Uses `world.subscribe` internally |
| `examples/chat/src/server/server.ts` | Uses `loro(doc).subscribe()` (retained) |
| `examples/rps-demo/src/server/server.ts` | Uses `loro(doc).subscribe()` (retained) |

### No Impact
- `loro(doc).subscribe()` - Retained as escape hatch (used by examples, tests, `getTransition`)
- `useDocument`, `useValue`, `usePlaceholder` hooks - Use different internal mechanisms
- `loro(doc).subscribeJsonpath()` - Native Loro method, retained
- `loro(ref).subscribe()` - Native container subscription, retained

## Changeset

```markdown
---
"@loro-extended/change": minor
"@loro-extended/repo": minor
---

feat(change): Add standalone `subscribe()` function

The new `subscribe()` function provides a unified API for document and ref subscriptions:

```typescript
import { subscribe } from "@loro-extended/change"

// Whole document subscription
subscribe(doc, (event) => console.log("Changed:", event))

// Path-selector subscription (type-safe!)
subscribe(doc, p => p.users.$key("alice").name, (name) => {
  console.log("Alice's name:", name)  // name is typed as string
})

// Ref subscription
subscribe(doc.title, (event) => console.log("Title changed"))
```

**BREAKING**: `ext(doc).subscribe()` and `sync(doc).subscribe()` have been removed.
Use `subscribe(doc, callback)` instead, or `loro(doc).subscribe()` for direct Loro access.

**Migration:**
```typescript
// Before
ext(doc).subscribe(callback)
sync(doc).subscribe(callback)

// After
subscribe(doc, callback)
// Or for native Loro access:
loro(doc).subscribe(callback)
```
```

## Resources for Implementation

### Key Files to Read
1. `packages/change/src/functional-helpers.ts` - Pattern for `change()` implementation
2. `packages/change/src/path-builder.ts` - Path builder creation
3. `packages/change/src/path-compiler.ts` - JSONPath compilation
4. `packages/change/src/path-evaluator.ts` - Path evaluation logic
5. `packages/repo/src/tests/handle-subscribe.test.ts` - Existing subscription tests

### Key Types
- `PathBuilder<D>` - Type-safe path builder entry point
- `PathSelector<R>` - Carries result type and segments
- `PathSegment` - Individual path segment (property, each, index, key)
- `LoroEventBatch` - Loro's event type for subscriptions

### Detection Patterns (from change())
```typescript
// Detect TypedDoc
const extNs = (target as any)[EXT_SYMBOL]
const isDoc = extNs && "docShape" in extNs

// Detect TypedRef (has LORO_SYMBOL but is not a doc)
const isRef = LORO_SYMBOL in target && !isDoc
```
