# Technical Documentation

This document captures architectural decisions, technical insights, and implementation details for the loro-extended project.

## API Consistency Principle: Dot for Traversal, Methods for Read/Write

### The Principle

All data access in loro-extended follows two rules:

1. **Traversal** — Use dot notation for schema-defined paths, `.get()` for dynamic/indexed access
2. **Read/Write** — Use method notation (`.get()`, `.set()`, etc.) — never assignment or property getters

This applies **uniformly** both inside and outside `change()` blocks. There is no "draft mode" with different ergonomics.

### Canonical API

```typescript
// Traversal — dot for schema, method for dynamic
doc.meta                        // StructRef
doc.meta.title                  // PlainValueRef<string> (via Proxy)
doc.items.get(0)                // PlainValueRef or nested Ref
doc.settings.get("key")         // PlainValueRef or nested Ref

// Read — always .get() at leaves
doc.meta.title.get()            // string
doc.items.get(0)?.get()         // T | undefined
doc.score.get()                 // number (CounterRef)

// Write — always methods
doc.meta.title.set("New")       // PlainValueRef.set()
doc.items.push(item)            // ListRef.push()
doc.items.set(0, newItem)       // ListRef.set()
doc.settings.set("key", v)      // RecordRef.set()
doc.score.increment(1)          // CounterRef.increment()
doc.content.update("text")      // TextRef.update()

// Inside change() — SAME API, not assignment
change(doc, draft => {
  draft.meta.title.set("New")
  draft.items.get(0)?.name.set("Updated")
  draft.items.set(0, { name: "Replaced" })
  const score = draft.meta.score.get()
  draft.meta.score.set(score + 10)
})
```

### What Changed (and Why)

| Component | Before | After | Rationale |
|-----------|--------|-------|-----------|
| **PlainValueRef** | No `.get()`/`.set()` methods; relied on `value()` function and assignment | Added `.get()` and `.set()` methods | Canonical read/write at leaf nodes |
| **CounterRef** | `.value` property getter | `.get()` method | Consistent with PlainValueRef |
| **ListRef** | `list[0]` bracket access; no `.set()` method | `list.get(0)` for traversal; `list.set(0, value)` for replacement | Consistent method-based API |
| **StructRef Proxy** | SET trap allowed `draft.title = "x"` | SET trap removed | Writes go through PlainValueRef.set() |
| **RecordRef Proxy** | SET trap allowed `record.key = value` | SET trap removed | Use `record.set("key", value)` |
| **PlainValueRef Proxies** | SET traps on struct/record/generic/list-item proxies | All SET traps removed | Writes go through `.set()` |
| **`_draft` types** | Returned raw `T` (e.g., `string`) for ergonomic assignment inside `change()` | Returns `PlainValueRef<T>`, same as `_mutable` | Unified type — no dual mode |
| **`resolveValueForBatchedMutation`** | Returned raw primitives inside `change()`, PlainValueRef for objects | Always returns PlainValueRef | Consistent behavior in both contexts |

### Key Type System Details

#### DeepPlainValueRef

`PlainValueRef<T>` is a simple interface with `.get()`, `.set()`, `.valueOf()`, etc. It does **not** expose nested properties for object types.

`DeepPlainValueRef<T>` is a type alias that adds nested property access when `T` is a plain object:

```typescript
// For PlainValueRef<{ author: string; published: boolean }>:
// - .get() returns { author: string; published: boolean }
// - .set({ author: "Alice", published: true }) writes the whole value
// - .author is DeepPlainValueRef<string>  (via the intersection type)
// - .author.get() returns string
// - .author.set("Alice") writes just the author
```

This is defined in `packages/change/src/plain-value-ref/types.ts`.

**Why two types?** Using a conditional type directly in `PlainValueRef<T>` causes circular type references in the shape system. The expansion is applied at the access point via the `Deepen` helper in `SelectByMode`, not in the shape definitions.

#### SelectByMode and Deepen

```typescript
// In shape.ts:
type SelectByMode<S, Mode> = Deepen<Mode extends "mutable" ? S["_mutable"] : S["_draft"]>
type Deepen<T> = T extends PlainValueRef<infer U> ? DeepPlainValueRef<U> : T
```

This ensures that any `PlainValueRef<T>` returned by a shape is automatically expanded to `DeepPlainValueRef<T>` at the point of use, without requiring the shape definitions to use conditional types (which would cause circularity).

#### _draft Collapsed Into _mutable

Since both modes now return `PlainValueRef<T>`, the `_draft` type parameter on all ValueShapes is set to match `_mutable`. The `_draft` type parameter is kept for now (not yet removed from the `Shape` interface) but is always equal to `_mutable` for value shapes. A future cleanup could remove the `_draft` parameter entirely.

### Container Structs vs Value Structs

A common confusion: there are two ways to define struct-like data:

```typescript
// Container struct — each property is a separate CRDT handle (LoroMap)
metadata: Shape.struct({ author: Shape.plain.string() })
// → StructRef, dot access returns PlainValueRef<string> per property
// → Each property is independently mergeable

// Value struct — the entire object is ONE value in a parent LoroMap
metadata: Shape.plain.struct({ author: Shape.plain.string() })
// → PlainValueRef<{ author: string }>, dot access via DeepPlainValueRef
// → Writes replace the whole object (last-writer-wins)
```

Both support dot traversal at the type level now (via StructRef properties and DeepPlainValueRef respectively), but the CRDT semantics are very different.

### Implementation Status (as of this writing)

**Source code: Complete** — All core changes implemented, zero source-level type errors.

**Tests: ~60 type errors remaining** — All in test files that still use the old assignment patterns. The fixes are mechanical:

| Old Pattern | New Pattern |
|-------------|-------------|
| `draft.meta.title = "New"` | `draft.meta.title.set("New")` |
| `draft.items[0] = value` | `draft.items.set(0, value)` |
| `record.alice = { ... }` | `record.set("alice", { ... })` |
| `doc.counter.value` | `doc.counter.get()` |
| `item.completed = !item.completed` | `item.completed.set(!item.completed.get())` |

Files with remaining test errors (by count): `change.test.ts` (18), `types.test.ts` (10), `plainvalueref-unification.test.ts` (10), `world-state-schema.test.ts` (5), `readonly.test.ts` (4), `discriminated-union.test.ts` (4), plus a handful of 1-error files.

### Gotchas for Developers Continuing This Work

1. **The `value()` function still works** — It's kept for backwards compatibility but is no longer "the way". Prefer `.get()`. Don't add new `value()` usage.

2. **Predicate functions in `.find()`, `.filter()` etc. receive plain values** — The `getPredicateItem()` method returns raw values for predicates (so `t.id === "foo"` works naturally). Only the *return value* of `.find()` is a PlainValueRef/TypedRef.

3. **`writeValue`, `writeListValue`, and `writeListValueAtPath` are all used** — They're used by the PlainValueRef `.set()` implementation in `buildBasePlainValueRef`. The factory.ts proxies no longer call them directly (SET traps removed), but the base `.set()` method does. `writeListValueAtPath` handles read-modify-write for nested list item properties (e.g., `item.active.set(true)` reads the whole item, updates `active`, writes it back).

4. **`unwrapPlainValueRef` in `plain-value-access.ts` may be dead code** — It was used by the old `setPropertyValue` path. Verify before removing.

5. **RecordRef bracket GET still works** — The `recordProxyHandler` GET trap is retained so `doc.players.alice` returns the ref for key `"alice"`. Only the SET and deleteProperty traps were removed.

6. **ListRef bracket GET still works at runtime** — The `listProxyHandler` GET trap is retained so `list[0]` returns the same as `list.get(0)` at runtime. But the TypeScript index signature was removed, so `list[0]` is a type error. This is intentional — use `.get(0)`.

7. **The `_draft` shape parameter still exists** — It's set equal to `_mutable` for all value shapes (including `AnyValueShape`, which was fixed). A future PR could simplify the `Shape` interface to remove `_draft` entirely and collapse `RefMode` to a single mode.

8. **`AnyValueShape._draft` is now `PlainValueRef<Value>` (FIXED)** — Previously it was `Value`, inconsistent with all other value shapes. Now corrected. `AnyContainerShape._draft` remains `unknown` (container shapes are unaffected by this work).

9. **`tests/world-state-schema.test.ts`** — This is a large integration test file outside `src/`. It has been fully updated.

10. **Phantom type assignments in `shape.ts` use `as any`** — The `_draft` fields in shape factory functions (e.g., `Shape.plain.string()`) are assigned `{} as any` because they're phantom types never instantiated at runtime. This is intentional and correct.

11. **PlainValueRef is a LIVE reference, not a snapshot** — When you call `list.get(0)`, the returned PlainValueRef reads from the container at call time. If you delete from the list, indices shift, and `.get()` on the old PlainValueRef returns the WRONG value. Always capture raw values (via `.get()`) before mutating the container:
    ```
    // WRONG: ref reads stale index after delete
    const ref = draft.items.get(0)
    draft.items.delete(0, 1)
    draft.items.insert(2, ref.get())  // reads shifted value!

    // RIGHT: snapshot before mutating
    const rawValue = draft.items.get(0)?.get()
    draft.items.delete(0, 1)
    draft.items.insert(2, rawValue)
    ```

12. **`assignPlainValueToTypedRef` in `utils.ts` splits struct/record paths** — For structs, it iterates keys and calls `propRef.set(value[k])` on each PlainValueRef. For records, it calls `ref.set(k, value[k])` on the RecordRef. This function is called when setting a plain value on a container-valued record entry (e.g., `record.set("alice", { name: "Alice" })`).

13. **List item proxies no longer have `runtimePrimitiveCheck`** — `createListItemStructProxy`, `createListItemNestedStructProxy`, and the generic object proxies now always return PlainValueRef for nested properties. This matches `createStructProxy` (which never had the check) and ensures `.set()` is always available. The predicate pathway (`getPredicateItem`) still returns raw values for ergonomic comparisons.

14. **`createRecordProxy` creates PlainValueRef for ALL keys** — Even non-existent keys get a PlainValueRef. This enables `.set()` on new keys via read-modify-write. The trade-off: `if (record.someKey)` is always truthy (PlainValueRef is an object). Use `value(record.someKey)` to check for existence.


## Loro CRDT Behavior

### Commit Idempotency

Loro's `commit()` is **idempotent** - calling it multiple times without changes between calls has no effect:

- Empty commits do not advance the version vector or frontiers
- Multiple sequential commits without mutations are safe and have no overhead
- This enables nested `change()` calls without requiring nesting detection

**Implication**: When implementing batched mutation patterns, you don't need to track nesting depth. Simply call `commit()` at the end of each `change()` block - Loro handles the rest.

## @loro-extended/change Architecture

> **See also**: [packages/change/TECHNICAL.md](./packages/change/TECHNICAL.md) for implementation details, file organization, and package-specific gotchas.

### Symbol-Based Escape Hatches

The library uses well-known symbols to provide clean separation between different access patterns:

| Symbol | Function | Purpose |
|--------|----------|---------|
| `INTERNAL_SYMBOL` | (internal) | Private implementation details |
| `LORO_SYMBOL` | `loro()` | Access native Loro types directly |
| `EXT_SYMBOL` | `ext()` | Access loro-extended-specific features |

**Design Rationale**: TypedDoc and TypedRef are Proxy objects where property names map to schema fields. Symbols provide a clean namespace for library functionality without polluting the user's schema namespace.

### Distinguishing TypedDocs from Refs

Both TypedDocs and TypedRefs have `LORO_SYMBOL` (for `loro()` access), but they must be distinguished for different handling in hooks and utilities:

| Type | Has `LORO_SYMBOL` | Has `docShape` in `EXT_SYMBOL` |
|------|-------------------|-------------------------------|
| TypedDoc | ✅ | ✅ |
| TypedRef | ✅ | ❌ |

**Correct check for TypedDoc**:
```typescript
const extSymbol = Symbol.for("loro-extended:ext")
const extNs = (value as Record<symbol, unknown>)[extSymbol]
const isDoc = !!extNs && typeof extNs === "object" && "docShape" in extNs
```

**Incorrect check** (matches both docs and refs):
```typescript
const loroSymbol = Symbol.for("loro-extended:loro")
const isDoc = loroSymbol in value // WRONG: refs also have this
```

This distinction is critical in `@loro-extended/hooks-core` where `useValue()` needs to determine whether to use document-level versioning (`opCount()` + `frontiers()`) or container-level subscription.

**TypedDoc and Lens both expose `[EXT_SYMBOL]` in their types**: Both `TypedDoc<Shape>` and `Lens<D>` include `[EXT_SYMBOL]` with a `change` method signature in their type definitions. This serves as a fallback for the `change()` function when TypeScript's generic inference fails due to type flattening across module boundaries (e.g., in `.d.ts` files or re-exported type aliases). Users should always use `change(doc, fn)` or `ext(doc)` rather than accessing the symbol directly.

### The `loro()` and `ext()` Functions

```typescript
// loro() returns native Loro types directly
const loroDoc: LoroDoc = loro(typedDoc)
const loroText: LoroText = loro(textRef)
const loroList: LoroList = loro(listRef)

// ext() provides loro-extended-specific features
ext(doc).change(fn)        // Mutate with auto-commit
ext(doc).fork()            // Fork the document
ext(doc).forkAt(frontiers) // Fork at specific version
ext(doc).initialize()      // Write metadata
ext(doc).mergeable         // Check if using flattened storage
ext(doc).docShape          // Get the schema
ext(doc).applyPatch(patch) // Apply JSON patch
ext(doc).rawValue          // Get raw value without toJSON

// For refs, ext() provides doc access
ext(ref).doc               // Get LoroDoc from any ref
ext(ref).change(fn)        // Mutate via the ref's doc
ext(listRef).pushContainer(shape)    // Push nested container
ext(structRef).setContainer(key, shape) // Set nested container
```

**Migration from old API**:
- `loro(doc).doc` → `loro(doc)`
- `loro(ref).container` → `loro(ref)`
- `loro(ref).doc` → `ext(ref).doc`
- `doc.change(fn)` → `change(doc, fn)`
- `doc.forkAt(f)` → `ext(doc).forkAt(f)`

### Ref Internals Pattern

All typed refs follow a **Facade + Internals** pattern:

```
TypedRef (public facade)
    └── [INTERNAL_SYMBOL]: BaseRefInternals (implementation)
```

- **Public facade** (`TypedRef` subclasses): Thin API surface, delegates to internals
- **Internals** (`BaseRefInternals` subclasses): Contains all state, caching, and implementation logic
- **Symbol access**: Internals are accessed via `[INTERNAL_SYMBOL]` to prevent namespace collisions with user data

### Key Internal Methods

| Method | Purpose |
|--------|---------|
| `getTypedRefParams()` | Returns params to recreate the ref (used by `change()` for draft creation) |
| `getChildTypedRefParams(key/index, shape)` | Returns params for creating child refs (lists, structs, records) |
| `buildChildTypedRefParams(internals, key, shape, placeholder)` | Shared helper in `utils.ts` for map-backed child ref creation (struct + record) |
| `finalizeTransaction?()` | Optional cleanup after `change()` completes (e.g., clear list caches) |
| `commitIfAuto()` | Commits if `autoCommit` mode is enabled (respects suppression flag) |
| `withBatchedCommit(fn)` | Suppress auto-commit, run `fn`, restore, then `commitIfAuto()` — reentrant-safe |

### Draft Creation for `change()`

The `change()` function creates draft refs by:

1. Getting params via `internals.getTypedRefParams()`
2. Creating a new ref with `autoCommit: false`, `batchedMutation: true`
3. Executing the user function with the draft
4. Calling `finalizeTransaction?.()` for cleanup (e.g., clear list caches)
5. Calling `doc.commit()` to finalize

This works for all ref types because `createContainerTypedRef()` handles the polymorphic creation.

**Note:** Plain values are written eagerly via `writeValue()` and `writeListValue()` during the user function execution. The `finalizeTransaction()` method only handles post-change cleanup like clearing caches to prevent stale refs.

### Value Shape Handling

When `batchedMutation: true` (inside `change()` blocks):

- **Primitive values** (string, number, boolean, null) are returned as raw values
  for ergonomic boolean logic (`if (draft.active)`, `!draft.published`)
- **Object/array values** are wrapped in PlainValueRef with immediate write-back
  to support nested mutation patterns (`item.metadata.author = "Alice"`)
- **Container shapes** (refs) are cached as handles - mutations go directly to Loro

When `batchedMutation: false` (direct access outside `change()`):

- All value shapes return PlainValueRef for reactive subscriptions
- Use `value()` or `unwrap()` to get the raw value

**Note:** The primitive vs object decision is made at runtime based on the actual
value (`typeof`), not the schema type. This correctly handles `union` and `any`
shapes that can contain either primitives or objects.

**List items:** ListRef uses the same PlainValueRef mechanism as StructRef/RecordRef.
Mutations are written immediately via `writeListValue()`, not deferred. For LoroList
(which lacks `.set()`), this uses delete+insert. For LoroMovableList, it uses `.set()`.

**Proxy Boilerplate Extraction:** All PlainValueRef proxy handlers share three extracted helpers:
- `proxyGetPreamble` — handles symbol/existing-property checks (written once, used by all 8 proxies)
- `unwrapForSet` — unwraps PlainValueRef values before writing
- `runtimePrimitiveCheck` — returns raw values for primitives, enabling `!draft.completed` patterns

The proxy functions themselves are split into two families:
- **Schema-aware** (struct, record): recurse into the shape tree at construction time
- **Runtime-inspecting** (generic/union/any): inspect `typeof` on each access, no shape to recurse into

**Array values in any/union shapes:** When `Shape.plain.any()` or `Shape.plain.union()` contains
an array value, the runtime check wraps it in PlainValueRef (since `typeof [] === 'object'`).
The generic object proxy allows property access (e.g., `.length`, `["0"]`) but does NOT support
index-based mutation (`ref[0] = "new"`). Arrays stored as plain value shapes should be
replaced wholesale, not mutated element-by-element.

**PlainValueRef in test assertions:** Outside `change()`, value shape properties return PlainValueRef.
Use `unwrap()` or `value()` when comparing PlainValueRef values in test assertions:
- `expect(unwrap(ref)).toBe("expected")` — unwrap first, then use `toBe` for primitives
- `expect(unwrap(ref)).toEqual({ key: "value" })` — unwrap first, then use `toEqual` for objects
- `expect(ref.toJSON()).toEqual("expected")` — alternatively, call `toJSON()` explicitly

Comparing a PlainValueRef directly to a primitive will fail. Always unwrap first.

**Known type gap:** `BaseRefInternals<any>` propagates through the proxy system. A future improvement
could introduce branded phantom types (`BaseRefInternals<"map">`, `BaseRefInternals<"list">`) to
make container-type misuse a compile error.

### TypedDoc Diff Overlay (Before/After Without Checkout)

TypedDoc now supports a **read-only diff overlay** that lets you compute a
"before" view without copying or checking out the document. This is used when a
subscription provides a `LoroEventBatch` and you want to read `{ before, after }`
from the **same** `LoroDoc`.

**Key APIs:**

```ts
export type CreateTypedDocOptions = {
  doc?: LoroDoc
  overlay?: DiffOverlay
}

export function createTypedDoc<Shape extends DocShape>(
  shape: Shape,
  options: CreateTypedDocOptions = {},
): TypedDoc<Shape>
```

```ts
export type DiffOverlay = ReadonlyMap<ContainerID, Diff>

export function createDiffOverlay(
  doc: LoroDoc,
  batch: LoroEventBatch,
): DiffOverlay {
  return new Map(doc.diff(batch.to, batch.from, false))
}
```

**How it works:**

1. Build a `DiffOverlay` from the **reverse diff** (`doc.diff(to, from)`).
2. Pass `{ overlay }` into `createTypedDoc` for the "before" view.
3. All ref read paths check the overlay to synthesize the old value:
   - **Counters**: add reverse `increment`.
   - **Struct/Record**: use `updated[key]` from map diffs.
   - **List/Text**: apply reverse deltas to current values.

**Design constraints:**

- Overlay is **read-only** and does not mutate Loro containers.
- Unsupported types (e.g., tree) are currently ignored.
- The overlay is stored in ref params and propagated through `getChildTypedRefParams()`.
 - The overlay is stored in ref params and propagated through `getChildTypedRefParams()`.

### `getTransition()` Helper (Strict Checkout Guard)

The `getTransition(doc, event)` helper builds `{ before, after }` from a
`LoroEventBatch` using the diff overlay, and **throws** on checkout events to
avoid interpreting time-travel as a state transition. This is intentionally
strict so callers must handle checkout events explicitly if they want them.

### Batch Assignment and Subscription Timing

When assigning a plain object to a struct/record via `ref.set(key, value)` or property assignment, `assignPlainValueToTypedRef()` handles the assignment atomically via `withBatchedCommit()`:

1. **Suppresses auto-commit** before iterating over properties
2. **Assigns all properties** in a loop
3. **Restores auto-commit** state
4. **Commits once** at the end (if autoCommit is enabled)

This ensures subscribers see **complete data** on the first notification, not partial data from intermediate states.

**Why this matters**: Without batching, each property assignment would trigger a separate `commit()` and subscription notification. Subscribers would see incomplete objects (e.g., `{ a: "value", b: "", c: "" }` on first notification).

**`withBatchedCommit(fn)`**: This method on `BaseRefInternals` encapsulates the suppress/restore/commitIfAuto pattern. It is reentrant-safe — if auto-commit is already suppressed by an outer call, the inner call runs without double-restoring. Used by `assignPlainValueToTypedRef()`, `RecordRefInternals.replace()`, `.merge()`, and `.clear()`.

### Shared Child Ref Params for Map-Backed Refs

`StructRefInternals` and `RecordRefInternals` both create child typed refs via `getChildTypedRefParams()`. The shared logic (hasContainerConstructor guard, mergeable vs non-mergeable branching, null markers, root container lookup) is extracted into `buildChildTypedRefParams(internals, key, shape, placeholder)` in `typed-refs/utils.ts`. Each caller computes `placeholder` differently:

- **Structs**: `(this.getPlaceholder() as any)?.[key]` — direct lookup from parent placeholder
- **Records**: Same lookup, but falls back to `deriveShapePlaceholder(shape)` when undefined (records have `{}` as placeholder, so nested containers need derived defaults)

### Nested Container Materialization

**Problem**: CRDTs require deterministic container IDs across peers. When a struct is created with an empty nested container (e.g., `{ answers: {} }`), the nested `LoroMap` must be created immediately—not lazily on first access. Otherwise, each peer creates its own container with a different ID, causing sync failures.

**Solution**: Eager materialization for statically-known structures:

| Container Type | Materialization Strategy |
|----------------|-------------------------|
| `Struct` | **Eager** - all nested containers created on initialization |
| `Doc` | **Eager** - all root containers created on initialization |
| `Record` | **Lazy** until `set()`, then eager for item's nested struct |
| `List` | **Lazy** until `push()`/`insert()`, then eager for item's nested struct |
| `Tree` | **Lazy** until `createNode()`, then eager for node's data struct |

**Implementation**:

1. `StructRefInternals.materialize()` recursively creates all nested containers defined in the schema
2. `assignPlainValueToTypedRef()` calls `materialize()` before assigning values
3. `convertStructInput()` iterates over **schema keys** (not just value keys) to create containers for missing fields

**Key Insight**: The creator of a data structure is responsible for materializing all its nested containers. This ensures container IDs are deterministic and consistent across peers.

```typescript
// ❌ Bug: Empty nested container may not materialize
recordRef.set("item-1", { id: "item-1", metadata: {} })

// ✅ Fixed: materialize() is called automatically, creating the nested LoroMap
// Container ID is now deterministic across all peers
```

See `packages/change/NESTED_CONTAINER_MATERIALIZATION_BUG.md` for the full bug report and resolution.

### Mergeable Containers via Flattened Root Storage

**Problem**: When two peers concurrently create a nested container at the same schema path, they create containers with different peer-dependent IDs. After sync, Loro's LWW semantics cause one peer's container to "win" while the other's operations appear lost. This is especially problematic with `applyDiff()` which remaps container IDs.

**Solution**: When `mergeable: true` is set on a TypedDoc, all containers are stored at the document root with path-based names. This ensures deterministic IDs that survive `applyDiff`.

```typescript
const doc = createTypedDoc(schema, { mergeable: true });
```

**Path Encoding**:
- Separator: `-` (hyphen)
- Escape character: `\` (backslash)
- Literal hyphen in key: `\-`
- Literal backslash in key: `\\`

| Schema Path | Encoded Root Name | Container ID |
|-------------|-------------------|--------------|
| `data.items` | `data-items` | `cid:root-data-items:List` |
| `data["my-key"].value` | `data-my\-key-value` | `cid:root-data-my\-key-value:Map` |

**Storage Structure**:

For a schema with nested structs, flattened storage uses `null` markers to indicate child containers:

```typescript
// Schema: { data: { nested: { value: string } } }
// Flattened storage:
// - cid:root-data:Map → { nested: null }  // null marker
// - cid:root-data-nested:Map → { value: "hello" }
```

**toJSON Reconstruction**: The `toJSON()` method automatically reconstructs the hierarchical structure from flattened storage when `mergeable: true`.

**Limitations**:
- Lists of containers (`Shape.list(Shape.struct({...}))`) are NOT supported with `mergeable: true`
- MovableLists of containers have the same limitation
- Use `Shape.record(Shape.struct({...}))` with string keys instead

**Implementation Details**:
- `pathPrefix` is passed through `TypedRefParams` to track the current path
- `computeChildRootContainerName()` builds the root container name from path segments
- `reconstructFromFlattened()` and `reconstructDocFromFlattened()` handle toJSON reconstruction

### Document Metadata and Reserved Keys

Loro Extended reserves all root container keys starting with `_loro_extended` for internal use. These keys are:

- Automatically excluded from `toJSON()` and `rawValue` output
- Used for document metadata and future internal features
- Synced between peers like any other container

**Metadata Container**: `_loro_extended_meta_` stores document metadata:
- `mergeable`: Whether the document uses flattened root container storage
- `schemaVersion`: (Future) Schema version for migration support

**Schema-Level Configuration**:

```typescript
// Declare mergeable in the schema
const schema = Shape.doc({
  players: Shape.record(Shape.struct({ score: Shape.plain.number() })),
}, { mergeable: true })

// Metadata is automatically written on creation (default)
const doc = createTypedDoc(schema)
```

**Initialization Control**: By default, `createTypedDoc()` writes metadata immediately. Use `skipInitialize: true` to defer:

```typescript
// Skip auto-initialization for advanced use cases
const doc = createTypedDoc(schema, { skipInitialize: true })

// Later, when ready to write metadata:
doc.initialize()
```

Use `skipInitialize: true` when:
- Receiving a synced document (it already has metadata)
- You need to control when the metadata commit happens (e.g., for signing)
- Testing scenarios where you need an empty document

**Peer Agreement**: When a peer receives a document, it reads the metadata and uses it (metadata takes precedence over schema). This ensures all peers use consistent settings.

**Mergeable Resolution** (depends on whether the document already has metadata):

| Scenario | How `mergeable` is determined |
|----------|-------------------------------|
| **Existing document** (has `_loro_extended_meta_`) | `metadata.mergeable` takes precedence; `options.mergeable` and `schema.mergeable` are ignored |
| **New document** (no metadata) | `options.mergeable` > `schema.mergeable` > `true` (default). Metadata is auto-written immediately unless `skipInitialize: true`. |
| **Legacy document** (no metadata, pre-loro-extended) with `skipInitialize: true` | Uses `options.mergeable` > `schema.mergeable` > `true`, but does NOT write metadata. Call `ext(doc).initialize()` later when ready. |

**⚠️ Important: Wrapping an existing `LoroDoc`**

When passing `{ doc: existingLoroDoc }` to `createTypedDoc`, if the document lacks metadata it will be treated as a **new** document and auto-initialized with `mergeable: true` (the default). This can silently corrupt a legacy non-mergeable document by writing mergeable metadata to it.

**Always pass `skipInitialize: true` when wrapping an existing `LoroDoc`** unless you are certain the document was created by loro-extended and already has metadata:

```typescript
// ✅ Safe: skip initialization for existing documents
const doc = createTypedDoc(schema, { doc: existingLoroDoc, skipInitialize: true })

// ❌ Dangerous: may auto-initialize a legacy doc as mergeable: true
const doc = createTypedDoc(schema, { doc: existingLoroDoc })
```

**Backward Compatibility**: Documents without metadata that are wrapped with `skipInitialize: true` will use the computed `options.mergeable` > `schema.mergeable` > `true` default without writing metadata. For true legacy documents, pass `mergeable: false` explicitly:

```typescript
const doc = createTypedDoc(schema, { doc: legacyDoc, skipInitialize: true, mergeable: false })
```

**Reserved Prefix**: Do not use `_loro_extended` as a prefix for your own root container keys.

### Infer<> vs InferRaw<> and Type Boundaries

The `@loro-extended/change` package provides two type inference utilities:

| Type | Behavior | Use Case |
|------|----------|----------|
| `Infer<Shape>` | Uses `ExpandDeep` for IDE hover display | Public API types, documentation |
| `InferRaw<Shape>` | Direct extraction, preserves type identity | Internal types, generic constraints |

**The Problem**: `ExpandDeep` transforms `A["_plain"]` into a structurally equivalent but nominally different type. This breaks type identity when generic classes need to match types across boundaries.

**The Solution - Type Boundary Pattern**:

When building generic classes that use Loro shapes, define plain types using the generic parameters directly:

```typescript
// ❌ Breaks type identity - Infer<> uses ExpandDeep
type PlainEntry<A extends ValueShape> = Infer<EntryShape<A>>

// ✅ Preserves type identity - uses A["_plain"] directly
interface PlainEntry<A extends ValueShape> {
  data: A["_plain"]
  timestamp: number
}
```

Then create a **single documented type boundary** where Loro's types meet application types:

```typescript
private getEntry(id: string): PlainEntry<A> | undefined {
  const entry = this.recordRef.get(id)
  if (!entry) return undefined
  // TYPE BOUNDARY: Bridge from Infer<> (ExpandDeep) to our PlainEntry type
  return entry.toJSON() as unknown as PlainEntry<A>
}
```

All downstream code flows naturally from this boundary without casts.

## Naming Conventions

### Internal Method Naming

Methods that get params for **child** refs are named `getChildTypedRefParams()` to avoid shadowing the base class `getTypedRefParams()` which returns params for the ref itself.

This distinction is important:
- `getTypedRefParams()` - "How do I recreate myself?"
- `getChildTypedRefParams(key, shape)` - "How do I create a child at this key?"

## Adapter Architecture

### Async Message Delivery

All adapters deliver messages **asynchronously** to simulate real network behavior:

| Adapter | Delivery Mechanism |
|---------|-------------------|
| `BridgeAdapter` | `queueMicrotask()` |
| `WebSocket` | Network I/O |
| `SSE` | HTTP + EventSource |
| `Storage` | Async I/O |

This ensures tests using `BridgeAdapter` exercise the same async codepaths as production adapters, catching race conditions and async state management bugs early.

**Important**: Tests should use `waitForSync()` or `waitUntilReady()` to await synchronization:

```typescript
// Correct pattern
handleA.change(draft => { draft.text.insert(0, "hello") })
await handleB.waitForSync()
expect(handleB.doc.toJSON().text).toBe("hello")
```

### WorkQueue and Recursion Prevention

The Synchronizer uses a `WorkQueue` to prevent infinite recursion when adapters deliver messages. Messages are queued and processed iteratively, not recursively. However, this doesn't change timing - with `BridgeAdapter`, messages are still delivered in a different microtask.

## Wire Format Architecture

The `@loro-extended/wire-format` package provides unified binary encoding for all network adapters. This replaces the previous split between WebSocket (CBOR) and other adapters (JSON+base64).

### Encoding Pipeline

```
ChannelMsg → WireMessage (compact names) → CBOR → Frame (6-byte header)
```

**WireMessage** uses compact field names for bandwidth efficiency:
| Domain Field | Wire Field |
|--------------|------------|
| `type` | `t` (numeric enum) |
| `docId` | `doc` |
| `requesterDocVersion` | `v` |
| `bidirectional` | `bi` |
| `transmission` | `tx` |

**Frame Header (v2)**:
```
┌────────────────────────────────────────────────────────────────────┐
│ Header (6 bytes)                                                   │
├──────────┬──────────┬──────────────────────────────────────────────┤
│ Version  │  Flags   │           Payload Length                     │
│ (1 byte) │ (1 byte) │           (4 bytes, big-endian)              │
└──────────┴──────────┴──────────────────────────────────────────────┘
```

Version 2 fixes the v1 64KB payload limit bug (Uint16 → Uint32).

### Transport Fragmentation

For transports with size limits, payloads are fragmented using byte-prefix discriminators:

| Prefix | Type | Followed By |
|--------|------|-------------|
| `0x00` | Complete message | Framed CBOR payload |
| `0x01` | Fragment header | batchId[8], count[4], totalSize[4] |
| `0x02` | Fragment data | batchId[8], index[4], payload[...] |

**FragmentReassembler** is a stateful class (imperative shell) that:
- Tracks concurrent batches via `Map<string, BatchState>`
- Handles timeout cleanup (default 10s)
- Enforces memory limits (default 50MB total)
- Supports complete messages interleaved with fragments
- Delegates to pure `reassembleFragments()` function (functional core)

### Transport-Specific Encoding

| Transport | Direction | Encoding | Fragment Threshold | Rationale |
|-----------|-----------|----------|-------------------|-----------|
| WebSocket | Both | Binary CBOR | 100KB | AWS API Gateway 128KB limit |
| WebRTC | Both | Binary CBOR | 200KB | SCTP 256KB limit |
| SSE | POST (client→server) | Binary CBOR | 80KB | body-parser 100KB default |
| SSE | EventSource (server→client) | JSON | N/A | Text-only protocol |
| HTTP-Polling | POST | Binary CBOR | 80KB | body-parser 100KB default |
| HTTP-Polling | GET response | JSON | N/A | No size limits on response |

**Note:** WebSocket fragmentation is required for cloud deployments (AWS API Gateway, Cloudflare Workers) but can be disabled (`fragmentThreshold: 0`) for self-hosted deployments without proxy limits.

### SSE and HTTP-Polling Asymmetric Encoding

SSE and HTTP-Polling use different encodings per direction:
- **POST (client→server)**: Binary CBOR with fragmentation for large ephemeral payloads
- **EventSource/GET (server→client)**: JSON via `channel-json.ts` (text-only SSE protocol constraint, simpler polling responses)

### Deployment Considerations

Wire format v2 is **not backward compatible**. Clients and servers must upgrade together:
- v1 clients cannot decode v2 frames (different header size)
- v2 introduces transport-layer prefixes (0x00, 0x01, 0x02) that v1 doesn't understand

For mixed deployments during migration, use separate endpoints or feature flags.

## Testing Patterns

### Investigating Loro Behavior

When investigating Loro's behavior, use frontiers and oplog info rather than version vectors:

```typescript
// Frontiers show the latest operation IDs
const frontiers = doc.frontiers()

// getAllChanges() shows operation counts
const changes = doc.getAllChanges()
```

Version vectors from `doc.version().toJSON()` may return empty objects in some cases.

### Testing with BridgeAdapter

`BridgeAdapter` is the recommended adapter for unit and integration tests. It delivers messages asynchronously via `queueMicrotask()` to match production adapter behavior.

```typescript
const bridge = new Bridge()
const repoA = new Repo({
  adapters: [new BridgeAdapter({ adapterType: "peer-a", bridge })],
})
const repoB = new Repo({
  adapters: [new BridgeAdapter({ adapterType: "peer-b", bridge })],
})

// Make changes on A
const handleA = repoA.get("doc", DocSchema)
handleA.change(draft => { draft.text.insert(0, "hello") })

// Wait for sync on B
const handleB = repoB.get("doc", DocSchema)
await handleB.waitForSync()
expect(handleB.doc.toJSON().text).toBe("hello")
```

For low-level synchronizer tests that need fine-grained control, use `flushMicrotasks()`:

```typescript
import { flushMicrotasks } from "@loro-extended/repo/test-utils"

channel.onReceive(syncRequest)
await flushMicrotasks()
expect(mockAdapter.sentMessages.length).toBeGreaterThan(0)
```

## Permissions and Document Architecture

### Server-Authoritative Data with Client-Writable RPC

When building RPC-style patterns (like Asks), you often need:
- **Client-writable data**: RPC queue for questions/requests
- **Server-authoritative data**: Results, state, or records that only the server should modify

**Problem**: Permissions operate at the document level, not field level. You can't make one field writable and another read-only within the same document.

**Solution**: Split into separate documents with different permissions:

```typescript
// Server configuration
const repo = new Repo({
  permissions: {
    mutability: (doc, peer) => {
      if (doc.id === "authoritative-data") {
        return peer.channelKind === "storage"; // Server-only
      }
      return true; // RPC doc is client-writable
    },
  },
});

const rpcHandle = repo.get("rpc-queue", RpcDocSchema);
const dataHandle = repo.get("authoritative-data", DataDocSchema);
```

**Benefits**:
- Server restart = clean authoritative state (clients can't sync stale data)
- Clear separation of concerns
- Clients can still use RPC for requests

**Caveat**: CRDT sync is bidirectional by default. Without permissions, a client with old data will sync it to a freshly restarted server. Always use `mutability` permissions for server-authoritative documents.

See `examples/username-claimer` for a complete implementation and `docs/permissions.md` for the full permissions API.

## LEA (Loro Extended Architecture)

### Fork-and-Merge Update Pattern

When building state machine transitions with LEA, use the **fork-and-merge** pattern to avoid confusion between read state and write draft:

```typescript
const update = createUpdate<Schema, Msg>((doc, msg, timestamp) => {
  // Single object for both reading and writing
  if (doc.status !== "idle") return     // Guard: read from doc
  change(doc, d => d.status = "running") // Mutate: via change()
})
```

**Critical**: Forks get new peer IDs by default. You must copy the main doc's peer ID to the fork:

```typescript
const workingDoc = ext(doc).forkAt(frontier)
loro(workingDoc).setPeerId(loro(doc).peerId)  // Required!
```

Without this, each update creates operations from a different peer, causing the frontier to not advance correctly (each peer starts at counter 0).

See `examples/task-card/TECHNICAL.md` for the full implementation and `docs/lea.md` for the LEA architecture specification.

### UndoManager for Navigation History

Browser back/forward navigation is conceptually equivalent to undo/redo of navigation operations. Instead of maintaining manual history stacks (`past`/`future` arrays), use Loro's UndoManager:

```typescript
const undoManager = new UndoManager(loro(viewDoc), {
  maxUndoSteps: 100,
  mergeInterval: 0, // Each navigation is a separate step
})
```

**Key patterns:**

1. **Two-step NAVIGATE for proper undo**: To restore both scroll position AND route on undo, the NAVIGATE handler must use two separate `change()` calls:

```typescript
case "NAVIGATE": {
  // Step 1: Save scroll to current route
  change(doc, draft => {
    draft.navigation.route.scrollY = msg.currentScrollY
  })
  // Step 2: Replace with new route
  change(doc, draft => {
    draft.navigation.route = { ...msg.route, scrollY: 0 }
  })
  break
}
```

2. **Browser history position tracking**: Store position in `pushState` to determine undo/redo count on popstate:

```typescript
window.history.pushState({ position: historyPosition }, "", url)
// On popstate: delta = newPosition - currentPosition
// delta < 0 → call undo() |delta| times
// delta > 0 → call redo() delta times
```

3. **Scroll position on route, not in separate map**: Store `scrollY` directly on each route variant for automatic restoration on undo.

4. **NAVIGATE_BACK/FORWARD messages are unnecessary**: The browser history reactor calls `undoManager.undo()/redo()` directly on popstate events.

### Lens + Transition Shell (Runtime Alternative)

Use [`useLens()`](packages/hooks-core/src/create-hooks.ts:162) in React/Hono integrations to manage lens lifecycle and snapshot caching when you need a lens-based worldview. The hook mirrors [`useDoc()`](packages/hooks-core/src/create-hooks.ts:99) behavior by caching snapshots based on opCount + frontiers, preventing infinite update loops when using `useSyncExternalStore`.

For lightweight runtimes, the World/Worldview pattern can be implemented directly with:

- `createLens(world, { filter })` for commit-level filtering into a worldview
- `subscribe()` + `getTransition()` for reactors (before/after snapshots without checkout)

This yields a minimal imperative shell:

1. Subscribe to `lens.worldview` changes
2. Build `{ before, after }` via `getTransition()`
3. Invoke reactors with `change(lens, fn, options?)` as the write path

Role-specific filters should be isolated (e.g., server vs client) with shared helpers to prevent policy drift. Tests should assert that client filters enforce player sovereignty and server filters enforce authoritative fields.

### Lens Peer ID Separation

The worldview document uses its own unique peer ID (from `fork()`) rather than sharing the world's peer ID. This is safe because:

- **Outbound (worldview → world)**: `applyDiff()` + `commit()` creates new ops with the world's peer ID
- **Inbound (world → worldview)**: `import()` preserves original authors' peer IDs

**Why separate peer IDs**:
1. Avoids potential `(peerId, counter)` collisions between world and worldview ops
2. Aligns with Loro's expectations about peer ID uniqueness
3. Improves debugging clarity (worldview ops are clearly distinct from world ops)

**Frontier tracking**: Because world and worldview have different peer IDs, the lens tracks frontiers for both documents separately:
- `lastKnownWorldFrontiers` - for detecting inbound changes to filter
- `lastKnownWorldviewFrontiers` - for computing diffs when propagating chained lens changes

**Nested containers with lenses**: When using lenses with nested containers, use `mergeable: true` on the schema. Without it, container IDs encode the worldview's peer ID, and subsequent modifications via `applyDiff` fail because the world doesn't have containers with those IDs.

```typescript
// Recommended for lens usage with nested containers
const schema = Shape.doc({
  items: Shape.record(Shape.struct({
    name: Shape.text(),
    tags: Shape.list(Shape.plain.string()),
  })),
}, { mergeable: true });
```

**Known limitation - chained lens propagation**: When making changes through a PARENT lens (lens1), those changes reach the world but do NOT automatically propagate DOWN to a CHILD lens's worldview (lens2). This is because:
1. `lens1.change()` modifies `lens1.worldview` directly
2. `lens1` propagates to world via `applyDiff`
3. `lens2.world === lens1.worldview`, but `lens2` only filters INBOUND changes
4. The direct mutation of `lens1.worldview` is a "local" event, not a filtered import

**Workaround**: Always make changes through the deepest lens in a chain, or accept that parent changes won't reach child worldviews.

### Unified `change()` API

The `change()` function from `@loro-extended/change` is the unified mutation API for all changeable types:

```typescript
import { change } from "@loro-extended/change"

// TypedDoc
change(doc, draft => draft.counter.increment(1))

// TypedRef
change(ref, draft => draft.push({ name: "item" }))

// Lens (with commit message for identity-based filtering)
change(lens, draft => draft.counter.increment(1), { commitMessage: { userId: "alice" } })
```

**ChangeOptions**: The optional third parameter supports:
- `commitMessage?: string | object` - Attached to the commit for identity-based filtering

**Detection mechanism**: The `change()` function detects Lens (and any future changeable types) via `[EXT_SYMBOL].change()`. This allows packages to implement the changeable protocol without circular dependencies.

**Re-exports**: For convenience, `@loro-extended/lens` re-exports `change` and `ChangeOptions` from `@loro-extended/change`, enabling single-import usage:

```typescript
import { createLens, change } from "@loro-extended/lens"
```
