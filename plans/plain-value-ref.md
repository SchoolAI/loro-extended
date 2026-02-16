# PlainValueRef and `value()` Function

## Background

The `@loro-extended/change` library distinguishes between two categories of shapes:

1. **Container shapes** (`Shape.text()`, `Shape.counter()`, `Shape.list()`, `Shape.struct()`, etc.) — Create CRDT containers with typed refs (TextRef, CounterRef, ListRef, StructRef, etc.) that can be subscribed to for reactive updates.

2. **Value shapes** (`Shape.plain.string()`, `Shape.plain.number()`, `Shape.plain.boolean()`, etc.) — Stored as raw Loro `Value` primitives inside parent containers. These are NOT containers and cannot be subscribed to individually.

When accessing a property on a StructRef:

- Container shape properties return a TypedRef (subscribable)
- Value shape properties return the **raw value** (string, number, etc.)

This creates a confusing API where `useValue(doc.meta.identifier)` fails with a type error when `identifier` is defined as `Shape.plain.string()`, even though the schema traversal syntax looks identical to container access.

### Why Not Reuse PathSelector?

The codebase has path-based subscription infrastructure (`PathBuilder`, `PathSelector`, `subscribeToPath`), but this is designed for a different purpose:

| Aspect          | PathSelector                          | PlainValueRef                 |
| --------------- | ------------------------------------- | ----------------------------- |
| Purpose         | User-facing DSL with wildcards        | Internal parent/path tracking |
| Path complexity | Wildcards (`$each`), indices, records | Simple property chain only    |
| Subscription    | Doc-level `subscribeJsonpath()`       | Parent container subscription |
| Type inference  | Complex array/object unwrapping       | Direct value type             |

PlainValueRef uses simple `string[]` paths (e.g., `["nested", "value"]`) and subscribes directly to the parent container's LoroMap, which is simpler and more direct than the PathSelector approach.

## Problem Statement

Users expect to use `useValue()` with any schema path, but plain values cannot be passed to `useValue()` because they are raw primitives, not refs. This violates the principle of least surprise and creates a "gotcha" that requires understanding Loro's internal container vs. value distinction.

**Current behavior:**

```typescript
const doc = createTypedDoc(schema);
doc.meta.title; // returns string (raw value)
useValue(doc.meta.title); // TYPE ERROR: string is not a ref
```

**Desired behavior:**

```typescript
const doc = createTypedDoc(schema);
doc.meta.title; // returns PlainValueRef<string>
useValue(doc.meta.title); // returns string (reactive!)
value(doc.meta.title); // returns string (non-reactive snapshot)
```

## Success Criteria

1. `useValue(doc.meta.identifier)` works for plain value properties and returns the reactive value
2. `subscribe(doc.meta.identifier, cb)` works for plain value properties
3. `value(doc.meta.identifier)` returns the current snapshot (non-React API)
4. Coercion works transparently: `` `Title: ${doc.meta.title}` `` produces expected output
5. Assignment still works: `doc.meta.title = "new value"`
6. Nested plain structs work: `doc.meta.nested.deep.value` returns `PlainValueRef<string>`
7. Nested mutation works: `draft.meta.nested.value = "new"` inside `change()` persists correctly
8. RecordRef values work: `doc.scores.get("alice")` returns `PlainValueRef<number>`
9. ListRef values work: `doc.tags.get(0)` returns `PlainValueRef<string>`
10. TypeScript catches incorrect strict equality comparisons (`===`) as type errors
11. DiffOverlay support: `getTransition()` works correctly with PlainValueRef
12. Nullable values work: `PlainValueRef<string | null>` returns `null` correctly
13. `loro()`, `ext()`, `change()` do NOT accept PlainValueRef (type errors guide users to `value()`)
14. All existing tests continue to pass (with updates for new return types)

## The Gap

| Aspect                           | Current State                    | Target State                    |
| -------------------------------- | -------------------------------- | ------------------------------- |
| StructRef plain value access     | Returns raw value                | Returns PlainValueRef           |
| RecordRef.get() for plain values | Returns raw value                | Returns PlainValueRef           |
| ListRef.get() for plain values   | Returns raw value                | Returns PlainValueRef           |
| useValue()                       | Only accepts refs/docs           | Also accepts PlainValueRef      |
| subscribe()                      | Only accepts refs/docs           | Also accepts PlainValueRef      |
| value() function                 | Does not exist                   | Unwraps PlainValueRef/refs/docs |
| Shape.\_mutable for value shapes | Same as \_plain (e.g., `string`) | PlainValueRef<\_plain>          |
| Nested value mutation            | Lazy cache + absorbPlainValues   | Eager read-modify-write         |

## Architecture: Unified Read-Write Accessor

### The Key Insight

Currently, plain value mutation has **two separate mechanisms**:

1. **Direct assignment** (`draft.meta.title = "new"`): Intercepted by StructRef's proxy SET trap → immediate write to Loro
2. **Nested mutation** (`draft.meta.nested.value = "new"`): Returns mutable deep copy → cached → `absorbPlainValues()` writes back lazily

These solve the same problem with different mechanisms. By making PlainValueRef a **read-write accessor with eager writes**, we can unify them.

### PlainValueRef as Unified Interface

PlainValueRef becomes a first-class read-write accessor:

| Operation                 | Behavior                                                              |
| ------------------------- | --------------------------------------------------------------------- |
| `ref.valueOf()`           | Fresh read from parent container (with overlay/placeholder fallback)  |
| `ref.toJSON()`            | Same as valueOf()                                                     |
| `ref[prop]` (GET)         | Returns nested PlainValueRef                                          |
| `ref[prop] = value` (SET) | Eager read-modify-write + autoCommit                                  |
| `useValue(ref)`           | Subscribe to parent, return valueOf()                                 |
| `subscribe(ref, cb)`      | Subscribe to parent, call cb when changed                             |

### Storing Parent Internals (Not Just Proxy)

PlainValueRef needs access to parent's internal methods for:
- **Overlay support**: `getOverlay()` for diff overlay reads (getTransition "before" views)
- **Placeholder fallback**: `getPlaceholder()` for uninitialized values
- **AutoCommit**: `commitIfAuto()` after writes outside `change()` blocks
- **Container access**: `getContainer()` for reading/writing

Therefore, PlainValueRef stores the **parent's internals reference**, not just the proxy:

```typescript
interface PlainValueRef<T> {
  readonly [PLAIN_VALUE_REF_SYMBOL]: true
  readonly [PARENT_INTERNALS_SYMBOL]: BaseRefInternals<any>  // Access to internals
  readonly [PATH_SYMBOL]: string[]
  readonly [SHAPE_SYMBOL]: ValueShape
  // ...
}
```

### Parent + Path Model

PlainValueRef stores a reference to its **parent container's internals** plus the **path** within that container:

```
doc.meta.nested.value
    │      │     │
    │      │     └── PlainValueRef { parentInternals: meta[INTERNAL], path: ["nested", "value"] }
    │      └── PlainValueRef { parentInternals: meta[INTERNAL], path: ["nested"] }
    └── StructRef (container, subscribable)
```

The parent stays the same (the StructRef's internals), the path extends with each property access.

### Functional Core / Imperative Shell (FC/IS) Separation

The implementation separates **pure functions** (Functional Core) from **CRDT operations** (Imperative Shell):

```
┌─────────────────────────────────────────────────────────────────┐
│                     Functional Core (Pure)                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  path-ops.ts                                             │    │
│  │  • getAtPath(obj, path) → value                         │    │
│  │  • setAtPath(obj, path, value) → newObj                 │    │
│  │  • deepClone(obj) → clone                               │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  value-resolution.ts                                     │    │
│  │  • resolveValue(overlay, container, placeholder) → val  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   Imperative Shell (Side Effects)                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  value-reader.ts                                         │    │
│  │  • getOverlayValue(internals, path) → value | undefined │    │
│  │  • getContainerValue(internals, path) → value | undef   │    │
│  │  • getPlaceholderValue(internals, path) → value | undef │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  value-writer.ts                                         │    │
│  │  • writeValue(internals, path, value) → void            │    │
│  │    (includes commitIfAuto)                              │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      Assembly / Composition                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  plain-value-ref.ts                                      │    │
│  │  • createPlainValueRef() - assembles the interface      │    │
│  │  • createStructProxy() - handles nested GET/SET         │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits of this separation:**
1. **Testability** - Pure functions can be tested without CRDT setup
2. **Reusability** - `path-ops` utilities can be used elsewhere
3. **Clarity** - Each module has a single responsibility
4. **Maintainability** - Changes to overlay logic don't affect write logic

### Eager Read-Modify-Write for Nested Mutation

When a nested PlainValueRef's SET trap is triggered:

```typescript
draft.meta.nested.value = "new";
```

1. `draft.meta.nested` → PlainValueRef with path `["nested"]`
2. `.value = "new"` → hits PlainValueRef's proxy SET trap
3. SET trap calls `writeValue(internals, ["nested", "value"], "new")`:
   ```typescript
   // Pure: compute what to write
   const current = getContainerValue(internals, ["nested"])
   const updated = setAtPath(current, ["value"], "new")
   
   // Impure: perform write + side effects
   container.set("nested", updated)
   internals.commitIfAuto()
   ```

This is **eager write-back**—the value is written to Loro immediately, just like direct assignment.

### What This Eliminates

| Current Pattern                                     | Eliminated?                               |
| --------------------------------------------------- | ----------------------------------------- |
| `batchedMutation` mode branching for value shapes   | ✅ Yes                                    |
| Deep copy caching for value shapes in propertyCache | ✅ Yes                                    |
| `absorbPlainValues()` logic for value shapes        | ✅ Yes (only container recursion remains) |
| Mode-aware helper functions                         | ✅ Yes                                    |

The `absorbPlainValues()` method simplifies to **only recursing into container children**.

### Verified Non-Issues

These aspects were analyzed and confirmed to work correctly without changes:

- **`serializeRefToJSON` chain**: `StructRef.toJSON()` → `serializeRefToJSON(proxy, keys)` → `proxy[key]` → `PlainValueRef.toJSON()` → raw value. Since PlainValueRef has `toJSON()`, the existing serialization chain works unmodified.
- **`Infer<>` type**: Extracts `_plain` (not `_mutable`), so `Infer<StringValueShape>` still returns `string`. All toJSON return types are unaffected.
- **`overlayPlaceholder` / `mergeValue`**: Operate on `toJSON()` output, not on refs. Unaffected.
- **Ephemeral/presence**: Uses `Shape.plain.struct()` but accessed via `useEphemeral()` which returns plain values directly, not through StructRef. Unaffected.
- **`createPlaceholderProxy`**: Used in `useDocument()` before doc loads. Wraps placeholder objects directly, not through StructRef. Unaffected.
- **`usePlaceholder` hook**: Not needed for PlainValueRef because `resolveValue()` already falls back to placeholder. No overload required.

### Caveats

#### List Item Index Stability

When you obtain a PlainValueRef from a list (`doc.items.get(0)`), it captures the index at that moment. If the list is subsequently mutated (items inserted, deleted, or moved), the PlainValueRef's index may point to a different item or be out of bounds.

```typescript
const itemRef = doc.items.get(0)  // PlainValueRef at index 0
doc.items.delete(0, 1)            // Index shifts!
value(itemRef)                     // May return wrong item or undefined
```

This is the same behavior as current list refs—indices are not stable across mutations. This is a fundamental limitation of index-based access and is documented here for clarity.

## Phases and Tasks

> **Sequencing principle:** Each phase ends with a green test suite. Tests are interleaved with implementation, not deferred. Run `pnpm turbo run verify --filter=@loro-extended/change` (or the appropriate package filter) at each checkpoint.

### Phase 1: Pure Path Utilities + Tests ✅

*Adds new code only. Nothing existing is touched. Independently verifiable.*

- ✅ Create `packages/change/src/utils/path-ops.ts` with:
  - `getAtPath(obj, path)` — pure function to traverse nested object
  - `setAtPath(obj, path, value)` — pure function returning new object with value set
  - `deepClone(obj)` — pure deep clone function
- ✅ Create `packages/change/src/utils/path-ops.test.ts` with unit tests (no CRDT needed)
- ✅ **Checkpoint:** `pnpm turbo run verify --filter=@loro-extended/change` passes

### Phase 2: PlainValueRef Core + Unit Tests ✅

*Adds new code only. Nothing existing is touched. Tests verify the new modules in isolation by constructing real TypedDocs and accessing internals directly.*

- ✅ Create `packages/change/src/plain-value-ref/symbols.ts` with:
  - `PLAIN_VALUE_REF_SYMBOL`, `PARENT_INTERNALS_SYMBOL`, `PATH_SYMBOL`, `SHAPE_SYMBOL`
- ✅ Create `packages/change/src/plain-value-ref/value-reader.ts` with:
  - `getOverlayValue(internals, path)` — reads from diff overlay (LoroMap-based)
  - `getContainerValue(internals, path)` — reads from LoroMap
  - `getPlaceholderValue(internals, path)` — reads from placeholder
  - `resolveValue(internals, path)` — composes the fallback chain
  - `getListOverlayValue(internals, index)` — **(added, not in original plan)** reads from list overlay
  - `getListContainerValue(internals, index)` — **(added)** reads from LoroList/LoroMovableList
  - `resolveListValue(internals, index)` — **(added)** fallback chain for list items
- ✅ Create `packages/change/src/plain-value-ref/value-writer.ts` with:
  - `writeValue(internals, path, value)` — writes to container + commitIfAuto
  - `writeListValue(internals, index, value)` — **(added, not in original plan)** writes to list container + commitIfAuto
- ✅ Create `packages/change/src/plain-value-ref/factory.ts` with:
  - `createPlainValueRef()` — assembles PlainValueRef object
  - `createStructProxy()` — wraps with Proxy for nested struct access
  - `createListItemPlainValueRef()` — **(added, not in original plan)** assembles PlainValueRef for list items (reads/writes via index rather than string path)
  - `createListItemStructProxy()` — **(added)** wraps list item struct values with Proxy
- ✅ Create `packages/change/src/plain-value-ref/types.ts` — **(deviation: the plan placed the interface in `index.ts`, but it was separated to `types.ts` to break a circular dependency between `factory.ts` → `PlainValueRef` type → `factory.ts`)**
- ✅ Create `packages/change/src/plain-value-ref/index.ts` to re-export public API:
  - `PlainValueRef<T>` interface (re-exported from `types.ts`)
  - `isPlainValueRef()` type guard
  - `createPlainValueRef()`, `createListItemPlainValueRef()` factories
  - `getPlainValueRefParentInternals()`, `getPlainValueRefPath()` accessors
  - Value reader/writer functions re-exported for testing
- ✅ Create `packages/change/src/value.ts` with:
  - `value()` function with overloads for PlainValueRef, TypedRef, and TypedDoc
- ✅ Export new types and functions from `packages/change/src/index.ts`
- ✅ Create `packages/change/src/plain-value-ref/plain-value-ref.test.ts`:
  - Test PlainValueRef creation by manually constructing one with real internals via `INTERNAL_SYMBOL`
  - Test `resolveValue()` reads from container
  - Test `resolveValue()` falls back to placeholder
  - **(skipped)** Test `resolveValue()` respects overlay — not yet covered
  - Test `writeValue()` writes to container (shallow and deep paths)
  - **(skipped)** Test `writeValue()` calls commitIfAuto — not explicitly asserted
  - Test `isPlainValueRef()` type guard (true for PlainValueRef, false for primitives/refs/docs)
  - Test `value()` unwrapping for PlainValueRef
  - **(deviation)** Test `value()` unwrapping for TypedRef — uses `doc.meta.toJSON()` instead of `value(doc.meta)` due to overload matching; `value()` for TypedRef works but the overload doesn't match StructRef (Proxy-based, not extending TypedRef directly)
  - Test `value()` unwrapping for TypedDoc
  - Test coercion (`valueOf`, `toString`, `toJSON`, template literals, string concatenation, number coercion)
  - Test nested struct proxy GET returns PlainValueRef (with correct path)
  - Test nested struct proxy SET triggers `writeValue()`
  - Test nullable value shape returns `null` correctly
  - Test number values, boolean values, JSON serialization
- ✅ **Checkpoint:** `pnpm turbo run verify --filter=@loro-extended/change -- logic -- -t 'PlainValueRef'` passes (all PlainValueRef-specific tests green)

> **Implementation note:** The original plan did not account for list items needing a separate read/write path. LoroList/LoroMovableList containers use numeric indices, not string keys like LoroMap. The list-specific functions (`resolveListValue`, `writeListValue`, `createListItemPlainValueRef`) were added to handle this distinction. The list overlay reader is a stub that always returns `undefined`; full list diff overlay support would require parsing `ListDiff` operations (insert/delete/retain) which is deferred.

### Phase 3: Wire Into Internals + Update Types + Fix Existing Tests 🟡 IN PROGRESS

*This is the "big bang" phase. Shape types, ref internals, and existing test updates must happen atomically because:*
- *Changing types without changing internals → type errors everywhere*
- *Changing internals without changing types → runtime/type mismatch*
- *Not fixing existing tests → can't verify anything*

**Current status:** Types pass (0 errors). Format passes. 26 tests still failing (see 3d below for categorization).

**3a. Create shared helper:**

- ✅ Create `packages/change/src/typed-refs/plain-value-access.ts` with:
  - `createPlainValueRefForProperty()` — creates PlainValueRef for a property, takes internals
  - `createPlainValueRefForListItem()` — **(added, not in original plan)** creates PlainValueRef for a list item at a numeric index, delegates to `createListItemPlainValueRef` from factory
  - `unwrapPlainValueRef()` — helper to unwrap PlainValueRef for assignment

**3b. Update shape type definitions:**

- ✅ Update `packages/change/src/shape.ts` to change `_mutable` type for all value shapes

> **Deviation from plan:** The plan specified pure `PlainValueRef<T>` for `_mutable` (e.g., `Shape<T, PlainValueRef<T>, T>`). This was changed to `PlainValueRef<T> | T` unions to allow direct assignment of raw values (`doc.meta.title = "new"`) without type errors. Without the union, every assignment site would require a type assertion or wrapper function. This sacrifices success criterion #10 (TypeScript catching `===` comparisons as type errors) in favor of ergonomic assignment.

  Actual `_mutable` types applied:
  - `StringValueShape`: `Shape<T, PlainValueRef<T> | T, T>`
  - `NumberValueShape`: `Shape<number, PlainValueRef<number> | number, number>`
  - `BooleanValueShape`: `Shape<boolean, PlainValueRef<boolean> | boolean, boolean>`
  - `NullValueShape`: `Shape<null, PlainValueRef<null> | null, null>`
  - `UndefinedValueShape`: `Shape<undefined, PlainValueRef<undefined> | undefined, undefined>`
  - `Uint8ArrayValueShape`: `Shape<Uint8Array, PlainValueRef<Uint8Array> | Uint8Array, Uint8Array>`
  - `StructValueShape`: `{ [K in keyof T]: T[K]["_mutable"] }` — **(deviation: kept as recursive mapped type, not wrapped in PlainValueRef)** The plan wanted `PlainValueRef<...> & { [K in keyof T]: T[K]["_mutable"] }` but this caused index signature incompatibilities when `StructValueShape<Record<string, ValueShape>>` (the generic default) tried to accept concrete struct types like `StructValueShape<{ id: StringValueShape; title: StringValueShape }>`. The intersection type doesn't have a `[x: string]` index signature, so TypeScript rejects assignments. Keeping the recursive mapped type avoids this issue while still having nested value shapes return `PlainValueRef<T> | T`.
  - `RecordValueShape`: `PlainValueRef<Record<string, T["_plain"]>> | Record<string, T["_plain"]>`
  - `ArrayValueShape`: `PlainValueRef<T["_plain"][]> | T["_plain"][]`
  - `UnionValueShape`: `PlainValueRef<T[number]["_plain"]> | T[number]["_plain"]`
  - `DiscriminatedUnionValueShape`: `PlainValueRef<Plain> | Plain`
  - `AnyValueShape`: `PlainValueRef<Value> | Value`

**3c. Update ref internals (no mode branching):**

- ✅ Modify `packages/change/src/typed-refs/struct-ref-internals.ts`:
  - ✅ Update `getOrCreateRef()` to always return PlainValueRef for value shapes via `createPlainValueRefForProperty(this, key, shape)` — removed all overlay/batchedMutation/cache branching for value shapes
  - ✅ Update `setPropertyValue()` to use `unwrapPlainValueRef(value)` before writing
  - ✅ Add comment to `absorbPlainValues()` noting value shapes are now eager
  - ✅ Change `propertyCache` type from `Map<string, TypedRef<ContainerShape> | Value>` to `Map<string, TypedRef<ContainerShape>>` (value shapes no longer cached)
- ✅ Modify `packages/change/src/typed-refs/record-ref-internals.ts`:
  - ✅ Update `getOrCreateRef()` to always return PlainValueRef via `createPlainValueRefForProperty(this, key, shape)` — removed all overlay/batchedMutation/cache branching for value shapes
  - ✅ `getRef()` unchanged (still calls `getOrCreateRef()` which now returns PlainValueRef)
  - ✅ Update `set()` to use `unwrapPlainValueRef(value)` before writing
  - ✅ Add comment to `absorbPlainValues()` noting value shapes are now eager
  - ✅ Change `refCache` type from `Map<string, TypedRef<ContainerShape> | Value>` to `Map<string, TypedRef<ContainerShape>>`
- ✅ Modify `packages/change/src/typed-refs/list-ref-base-internals.ts`:
  - ✅ Update `getMutableItem()` to return `createPlainValueRefForListItem(this, index, shape.shape)` for value shapes — removed all batchedMutation/cache branching for value shapes
  - ✅ Simplify `absorbPlainValues()` to only recurse into container children (skip value shapes entirely since they use eager write-back)
- 🔴 Modify `packages/change/src/typed-refs/utils.ts`:
  - **(not done)** `absorbCachedPlainValues()` was not modified. This turned out to be unnecessary: since the caches in struct/record internals now only store container refs (the `Map` types were narrowed to `TypedRef<ContainerShape>` only), the existing `absorbCachedPlainValues()` logic only encounters container entries and works correctly as-is. The "plain value" branch of the `for` loop is now dead code but harmless.

**3d. Fix existing tests that assert raw value returns:**

- 🟡 Update existing tests throughout `packages/change/src/` — **partially done, 26 tests still failing**

  Tests that were updated to use `unwrap()` (an `isPlainValueRef(v) ? value(v) : v` helper) or `value()`:
  - ✅ `src/change.test.ts` — fixed list move operation (line ~248), arithmetic operations in find-and-mutate patterns (lines ~1907-1977)
  - ✅ `src/diff-overlay.test.ts` — fixed before/after transition value reads
  - ✅ `src/functional-helpers.test.ts` — fixed getTransition boolean comparison
  - ✅ `src/readonly.test.ts` — fixed live view count comparison
  - ✅ `src/mergeable-flattened.test.ts` — fixed ~15 value comparisons across basic, concurrent, and backward compatibility tests
  - ✅ `src/nested-container-materialization.test.ts` — fixed 4 value comparisons
  - ✅ `src/shallow-fork.test.ts` — fixed 8 value comparisons in fork-and-merge tests
  - ✅ `src/ext.test.ts` — fixed applyPatch assertions
  - ✅ `src/fork-at.test.ts` — fixed boolean and settings comparisons
  - ✅ `src/loro.test.ts` — fixed setContainer assertion
  - ✅ `src/typed-refs/record-ref.test.ts` — fixed plain record dynamic property access (cast to `as any`) and showTip comparison
  - ✅ `src/typed-refs/record-ref-value-updates.test.ts` — fixed ~15 value comparisons
  - ✅ `src/typed-refs/list-ref-value-updates.test.ts` — fixed ~15 value comparisons
  - ✅ `src/typed-refs/struct-ref.test.ts` — fixed ~10 value comparisons

  **Remaining 26 failing tests**, categorized by root cause:

  *Category A: Tests that still need simple `unwrap()` treatment (~10 tests):*
  - `src/typed-refs/struct-ref.test.ts` — "reading before any change should not cause stale cache"
  - `src/typed-refs/tree-node-ref.test.ts` — 3 tests (TreeNodeRef.data returns PlainValueRef for value shapes; needs `unwrap()` on `.data.count`, `.data.active` etc.)
  - `src/typed-refs/record-ref-value-updates.test.ts` — "handles null values", "handles reading before first change"
  - `src/change.test.ts` — "should handle null values in placeholder correctly"
  - `src/types.test.ts` — "Object.values returns values from the record"

  *Category B: `Shape.plain.record()` nested in `Shape.struct()` — writes via PlainValueRef don't persist (~3 tests):*
  - `src/typed-refs/record-ref.test.ts` — "should handle record of plain strings", "should handle record of plain numbers", "should handle nested records"
  - **Root cause:** When `Shape.plain.record()` is a value shape inside a `Shape.struct()`, `getOrCreateRef()` returns a PlainValueRef for the entire record value. But PlainValueRef only wraps `StructValueShape` in a Proxy for dynamic property access. `RecordValueShape` and `ArrayValueShape` get a bare PlainValueRef with no SET interception, so dynamic property assignment like `(draft.wrapper.config as any).theme = "dark"` sets a property on the PlainValueRef object itself (a no-op on a frozen-like object) rather than writing to Loro. **Fix needed:** either add Proxy wrapping for record/array value shapes, or route these writes through a different path (e.g., replace the whole record value).

  *Category C: `Object.keys()`/`Object.values()`/`Object.entries()` on refs containing PlainValueRef (~7 tests):*
  - `src/typed-refs/encapsulation.test.ts` — 3 tests (RecordRef, StructRef, TreeRef enumerable state) — PlainValueRef objects may introduce unexpected enumerable properties
  - `src/typed-refs/json-compatibility.test.ts` — 3 tests (Object.keys, Array methods, Object.values) — these iterate over ref properties and expect raw values
  - `src/change.test.ts` — "should provide JavaScript-native object methods"
  - **Root cause:** `Object.keys(structRef)` or `Object.values(recordRef)` now encounters PlainValueRef objects. The `values()` and `entries()` methods on RecordRef iterate via the internal cache/container and now return PlainValueRef objects instead of raw values. Tests that type-assert `number[]` or `[string, number][]` fail because the actual type is `(PlainValueRef<number> | number)[]`.

  *Category D: RecordRef `values()`/`entries()` return PlainValueRef instead of raw values (~4 tests):*
  - `src/typed-refs/record-ref.test.ts` — 4 tests for values()/entries() on both value-shaped and container-shaped records
  - **Root cause:** The `values()` and `entries()` methods on RecordRef call `getOrCreateRef()` for each key, which now returns PlainValueRef for value shapes. The runtime values are PlainValueRef objects, not raw values, so `expect(values).toEqual([100, 50])` fails because `[PlainValueRef, PlainValueRef] !== [100, 50]`.

  *Category E: Other (~2 tests):*
  - `src/change.test.ts` — "should work with lists of maps (nested containers)" — list item access returns PlainValueRef
  - `src/loro.test.ts` — "should setContainer via ext()" for RecordRef — **bug introduced in test fix:** the `unwrap()` call was added correctly, but the expected string was changed from `"Alice via ext"` to `"alice-via-ext"` by mistake. The LoroMap sets `newMap.set("name", "Alice via ext")` so the assertion should be `.toBe("Alice via ext")`. Simple one-line fix.

- 🔴 Add new integration tests to `packages/change/src/plain-value-ref/plain-value-ref.test.ts`:
  - **(not done)** End-to-end tests for wired-up PlainValueRef (the test file tests PlainValueRef in isolation by manually constructing refs via `INTERNAL_SYMBOL`, but does not yet test the end-to-end flow of `doc.meta.title` returning PlainValueRef)
  - **(not done)** Nested mutation tests inside/outside `change()`
  - **(not done)** `getTransition()` overlay tests
  - **(not done)** RecordRef/ListRef PlainValueRef integration tests

- 🔴 **Checkpoint:** `pnpm turbo run verify --filter=@loro-extended/change` — **NOT passing** (format ✅, types ✅, logic ❌ 26 failures)

### Phase 4: `subscribe()` Overload + Tests 🔴

*Adds new overload. Does not break existing code. Blocked on Phase 3 completion.*

- 🔴 Modify `packages/change/src/functional-helpers.ts`:
  - Add `subscribe()` overload for `PlainValueRef<T>`
  - Implementation: subscribe to parent container, compare value by JSON equality, only fire callback if changed
- 🔴 Add subscription tests to `packages/change/src/plain-value-ref/plain-value-ref.test.ts`:
  - Test fires callback when value changes
  - Test does not fire for unrelated changes in parent container
  - Test works with nested plain struct paths
  - Test fires on nested mutation via PlainValueRef SET
- ✅ **Checkpoint:** `pnpm turbo run verify --filter=@loro-extended/change` passes

### Phase 5: React/Hono Hooks + Tests 🔴

*Adds new overloads. Must use `createSyncStore` for consistency with existing hooks. Blocked on Phase 3+4 completion.*

> **Important: Do NOT add PlainValueRef to `AnyTypedRef`.** `AnyTypedRef` is derived from `ContainerShape["_mutable"]` and uses `ReturnType<R["toJSON"]>` for inference. Adding `PlainValueRef<any>` would collapse inference to `any`. Instead, add PlainValueRef as a **separate, higher-priority overload** that comes first in overload order:
> ```typescript
> function useValue<T>(ref: PlainValueRef<T>): T                           // NEW - must be first
> function useValue<R extends AnyTypedRef>(ref: R): ReturnType<R["toJSON"]>
> function useValue<D extends DocShape>(doc: TypedDoc<D>): Infer<D>
> ```

- 🔴 Modify `packages/hooks-core/src/create-ref-hooks.ts`:
  - Add `useValue()` overload for `PlainValueRef<T>` (**as first overload**, before AnyTypedRef)
  - Do NOT modify `AnyTypedRef` type
  - Implementation using `createSyncStore`:
    ```typescript
    if (isPlainValueRef(refOrDoc)) {
      const store = useMemo(
        () =>
          createSyncStore(
            () => refOrDoc.valueOf(),
            (onChange) => {
              const internals = getPlainValueRefParentInternals(refOrDoc);
              const container = internals.getContainer();
              let prev = JSON.stringify(refOrDoc.valueOf());
              return container.subscribe(() => {
                const next = JSON.stringify(refOrDoc.valueOf());
                if (next !== prev) {
                  prev = next;
                  onChange();
                }
              });
            },
            cacheRef
          ),
        [refOrDoc]
      );
      return useSyncExternalStore(store.subscribe, store.getSnapshot);
    }
    ```
- 🔴 Modify `packages/react/src/hooks-core.ts`:
  - Add PlainValueRef overload to re-exported `useValue()`
- 🔴 Modify `packages/hono/src/hooks-core.ts`:
  - Add PlainValueRef overload to re-exported `useValue()`
- 🔴 Add hooks-core tests for `useValue(plainValueRef)`:
  - Test returns current value
  - Test re-renders when value changes
  - Test does not re-render for unrelated changes
  - Test works with nested plain struct paths
  - Test re-renders on nested mutation
- ✅ **Checkpoint:** `pnpm turbo run verify` (full monorepo) passes

### Phase 6: Update Example Apps 🔴

*Example apps use `Shape.plain.*` and will have type errors. Must update to use `value()` for comparisons. Blocked on Phase 3 completion.*

- 🔴 Update `examples/bumper-cars/` — uses plain values in PlayerScoreSchema, presence schemas
- 🔴 Update `examples/chat/` — uses plain values in MessageSchema, PreferenceSchema
- 🔴 Update `examples/postgres/` — uses plain values in DocSchema
- 🔴 Update `examples/rps-demo/` — uses plain values in GameSchema
- 🔴 Update `examples/todo-sse/` — uses plain values in TodoSchema
- 🔴 Update `examples/video-conference/` — uses plain values in participant/room schemas
- ✅ **Checkpoint:** `pnpm turbo run verify` (full monorepo including examples) passes

### Phase 7: Documentation 🔴

- 🔴 Update `TECHNICAL.md` with PlainValueRef architecture documentation
- 🔴 Create changeset documenting the breaking change
- 🔴 Update README.md if public API examples need updating

## Unit and Integration Tests

### Path Operations Tests (Pure - No CRDT)

```typescript
describe("path-ops", () => {
  describe("getAtPath", () => {
    it("returns value at shallow path", () => {
      expect(getAtPath({ a: 1 }, ["a"])).toBe(1);
    });

    it("returns value at deep path", () => {
      expect(getAtPath({ a: { b: { c: 2 } } }, ["a", "b", "c"])).toBe(2);
    });

    it("returns undefined for missing path", () => {
      expect(getAtPath({ a: 1 }, ["b"])).toBeUndefined();
    });

    it("returns undefined when traversing null", () => {
      expect(getAtPath({ a: null }, ["a", "b"])).toBeUndefined();
    });
  });

  describe("setAtPath", () => {
    it("sets value at shallow path", () => {
      const result = setAtPath({ a: 1 }, ["a"], 2);
      expect(result).toEqual({ a: 2 });
    });

    it("sets value at deep path", () => {
      const result = setAtPath({ a: { b: 1 } }, ["a", "b"], 2);
      expect(result).toEqual({ a: { b: 2 } });
    });

    it("creates intermediate objects", () => {
      const result = setAtPath({}, ["a", "b", "c"], 1);
      expect(result).toEqual({ a: { b: { c: 1 } } });
    });

    it("does not mutate original", () => {
      const original = { a: { b: 1 } };
      setAtPath(original, ["a", "b"], 2);
      expect(original.a.b).toBe(1);
    });
  });

  describe("deepClone", () => {
    it("clones nested objects", () => {
      const original = { a: { b: [1, 2, 3] } };
      const cloned = deepClone(original);
      cloned.a.b.push(4);
      expect(original.a.b).toEqual([1, 2, 3]);
    });
  });
});
```

### PlainValueRef Core Tests

```typescript
describe("PlainValueRef", () => {
  const schema = Shape.doc({
    meta: Shape.struct({
      title: Shape.plain.string().placeholder("Untitled"),
      count: Shape.plain.number().placeholder(0),
      active: Shape.plain.boolean().placeholder(false),
      nested: Shape.plain.struct({
        value: Shape.plain.string().placeholder("default"),
        deep: Shape.plain.struct({
          inner: Shape.plain.string().placeholder("innerDefault"),
        }),
      }),
    }),
    scores: Shape.record(Shape.plain.number()),
    tags: Shape.list(Shape.plain.string()),
  });

  it("returns PlainValueRef for plain value properties");
  it("value() unwraps PlainValueRef to current value");
  it("valueOf() enables coercion in template literals");
  it("valueOf() enables string concatenation");
  it("toJSON() returns plain value");
  it("direct assignment with raw value still works");
  it("assignment with PlainValueRef unwraps automatically");
  it("nested plain structs return PlainValueRef for nested access");
  it("RecordRef.get() returns PlainValueRef for value shapes");
  it("ListRef.get() returns PlainValueRef for value shapes");
  it("returns placeholder value when CRDT value is undefined");
});
```

### Nested Mutation Tests (Critical for Eager Write-Back)

```typescript
describe("PlainValueRef nested mutation", () => {
  it("nested mutation inside change() persists via eager write-back", () => {
    const doc = createTypedDoc(schema);
    change(doc, (draft) => {
      draft.meta.nested.value = "mutated";
    });
    expect(value(doc.meta.nested.value)).toBe("mutated");
  });

  it("deeply nested mutation works", () => {
    const doc = createTypedDoc(schema);
    change(doc, (draft) => {
      draft.meta.nested.deep.inner = "deepMutated";
    });
    expect(value(doc.meta.nested.deep.inner)).toBe("deepMutated");
  });

  it("multiple nested mutations in same change() all persist", () => {
    const doc = createTypedDoc(schema);
    change(doc, (draft) => {
      draft.meta.nested.value = "a";
      draft.meta.nested.deep.inner = "b";
    });
    expect(value(doc.meta.nested.value)).toBe("a");
    expect(value(doc.meta.nested.deep.inner)).toBe("b");
  });

  it("nested mutation outside change() auto-commits", () => {
    const doc = createTypedDoc(schema);
    doc.meta.nested.value = "directMutation";
    // Should auto-commit
    expect(value(doc.meta.nested.value)).toBe("directMutation");
    expect(loro(doc).frontiers().length).toBeGreaterThan(0);
  });
});
```

### Overlay Tests (Critical for getTransition)

```typescript
describe("PlainValueRef with DiffOverlay", () => {
  it("getTransition works with PlainValueRef", () => {
    const doc = createTypedDoc(schema);
    doc.meta.title = "initial";
    loro(doc).commit();

    let transition: Transition<typeof schema> | null = null;
    loro(doc).subscribe((event) => {
      if (event.by !== "checkout") {
        transition = getTransition(doc, event);
      }
    });

    doc.meta.title = "updated";
    loro(doc).commit();

    expect(value(transition!.before.meta.title)).toBe("initial");
    expect(value(transition!.after.meta.title)).toBe("updated");
  });

  it("overlay works with nested plain values", () => {
    const doc = createTypedDoc(schema);
    change(doc, (draft) => {
      draft.meta.nested.value = "before";
    });

    let transition: Transition<typeof schema> | null = null;
    loro(doc).subscribe((event) => {
      if (event.by !== "checkout") {
        transition = getTransition(doc, event);
      }
    });

    change(doc, (draft) => {
      draft.meta.nested.value = "after";
    });

    expect(value(transition!.before.meta.nested.value)).toBe("before");
    expect(value(transition!.after.meta.nested.value)).toBe("after");
  });
});
```

### Subscription Tests

```typescript
describe("subscribe() with PlainValueRef", () => {
  it("fires callback when value changes");
  it("does not fire for unrelated changes in parent container");
  it("works with nested plain struct paths");
  it("fires on nested mutation via PlainValueRef SET");
});
```

### React Hook Tests

```typescript
describe("useValue() with PlainValueRef", () => {
  it("returns current value");
  it("re-renders when value changes");
  it("does not re-render for unrelated changes");
  it("works with nested plain struct paths");
  it("re-renders on nested mutation");
});
```

## Transitive Effect Analysis

### Direct Dependencies (packages that import from @loro-extended/change)

| Package                     | Impact                                     | Action Required                  |
| --------------------------- | ------------------------------------------ | -------------------------------- |
| `@loro-extended/hooks-core` | Uses `AnyTypedRef` type, `loro()` function | Add PlainValueRef overload (NOT in AnyTypedRef) |
| `@loro-extended/react`      | Re-exports hooks                           | Update overload types            |
| `@loro-extended/hono`       | Re-exports hooks                           | Update overload types            |
| `@loro-extended/repo`       | Uses TypedDoc, change()                    | None expected                    |
| `@loro-extended/lens`       | Uses TypedDoc, change()                    | None expected                    |

### Transitive Consumers

| Consumer          | Dependency Chain                   | Impact                                              |
| ----------------- | ---------------------------------- | --------------------------------------------------- |
| Example apps      | → react → hooks-core → change      | Will see breaking type changes; updated in Phase 6  |
| User applications | → react/hono → hooks-core → change | Breaking: strict equality checks become type errors |

### Breaking Change Analysis

**What breaks:**

- Code using `===` to compare plain value properties: `if (doc.meta.title === "foo")`
- Code passing plain values to functions expecting raw types: `someFunction(doc.meta.title)`
- Code storing plain values in variables typed as raw: `const title: string = doc.meta.title`

**What continues to work:**

- Assignment: `doc.meta.title = "new value"`
- Nested assignment: `doc.meta.nested.value = "new"` (now via eager write-back)
- Loose equality (via valueOf): `if (doc.meta.title == "foo")`
- Template literals: `` `Title: ${doc.meta.title}` ``
- String concatenation: `doc.meta.title + " suffix"`
- JSON serialization: `JSON.stringify(doc.meta.title)`

**Migration path:**

```typescript
// Before
if (doc.meta.title === "foo") { ... }

// After - Option 1: use value()
if (value(doc.meta.title) === "foo") { ... }

// After - Option 2: use loose equality
if (doc.meta.title == "foo") { ... }
```

### Package Build Order

1. `@loro-extended/change` (new types and PlainValueRef)
2. `@loro-extended/hooks-core` (updated useValue — separate overload, NOT in AnyTypedRef)
3. `@loro-extended/react`, `@loro-extended/hono` (re-export updates)
4. Example apps (updated to use `value()`)
5. All other packages (no changes expected)

## Resources for Implementation

### Files to Create

| File | Responsibility | Type | Status |
|------|----------------|------|--------|
| `packages/change/src/utils/path-ops.ts` | Pure path traversal/mutation | Functional Core | ✅ Created |
| `packages/change/src/utils/path-ops.test.ts` | Path ops unit tests | Test | ✅ Created |
| `packages/change/src/plain-value-ref/symbols.ts` | Symbol definitions | Constants | ✅ Created |
| `packages/change/src/plain-value-ref/types.ts` | PlainValueRef interface | Types | ✅ Created (added, not in original plan — split from index.ts to break circular dep) |
| `packages/change/src/plain-value-ref/value-reader.ts` | Value resolution (overlay/container/placeholder) | Imperative Shell | ✅ Created (includes list-specific functions) |
| `packages/change/src/plain-value-ref/value-writer.ts` | CRDT write + commitIfAuto | Imperative Shell | ✅ Created (includes list-specific `writeListValue`) |
| `packages/change/src/plain-value-ref/factory.ts` | PlainValueRef assembly | Composition | ✅ Created (includes list item factory and struct proxy) |
| `packages/change/src/plain-value-ref/index.ts` | Public exports | Index | ✅ Created |
| `packages/change/src/plain-value-ref/plain-value-ref.test.ts` | Integration tests | Test | ✅ Created (isolation tests pass; e2e integration tests not yet added) |
| `packages/change/src/value.ts` | `value()` function | Public API | ✅ Created |
| `packages/change/src/typed-refs/plain-value-access.ts` | Shared helper for internals | Helper | ✅ Created (includes `createPlainValueRefForListItem`) |

### Files to Modify

| File | Change | Status |
|------|--------|--------|
| `packages/change/src/shape.ts` | Update \_mutable types for value shapes | ✅ Done (with deviation: uses `PlainValueRef<T> \| T` union, see Phase 3b) |
| `packages/change/src/index.ts` | Export new types and functions | ✅ Done |
| `packages/change/src/typed-refs/struct-ref-internals.ts` | Use PlainValueRef, simplify absorbPlainValues | ✅ Done |
| `packages/change/src/typed-refs/record-ref-internals.ts` | Use PlainValueRef, simplify absorbPlainValues | ✅ Done |
| `packages/change/src/typed-refs/list-ref-base-internals.ts` | Use PlainValueRef, simplify absorbPlainValues | ✅ Done |
| `packages/change/src/typed-refs/utils.ts` | Update absorbCachedPlainValues | 🔴 Not done (turned out unnecessary, see Phase 3c) |
| `packages/change/src/functional-helpers.ts` | Add subscribe() overload | 🔴 Phase 4 |
| `packages/hooks-core/src/create-ref-hooks.ts` | Add PlainValueRef overload (NOT in AnyTypedRef) | 🔴 Phase 5 |
| `packages/react/src/hooks-core.ts` | Add PlainValueRef overload as first overload | 🔴 Phase 5 |
| `packages/hono/src/hooks-core.ts` | Add PlainValueRef overload as first overload | 🔴 Phase 5 |
| `examples/bumper-cars/` | Update plain value comparisons to use `value()` | 🔴 Phase 6 |
| `examples/chat/` | Update plain value comparisons to use `value()` | 🔴 Phase 6 |
| `examples/postgres/` | Update plain value comparisons to use `value()` | 🔴 Phase 6 |
| `examples/rps-demo/` | Update plain value comparisons to use `value()` | 🔴 Phase 6 |
| `examples/todo-sse/` | Update plain value comparisons to use `value()` | 🔴 Phase 6 |
| `examples/video-conference/` | Update plain value comparisons to use `value()` | 🔴 Phase 6 |

**Test files modified** (existing tests updated to use `unwrap()` / `value()` for PlainValueRef comparisons):
- `src/change.test.ts`, `src/diff-overlay.test.ts`, `src/ext.test.ts`, `src/fork-at.test.ts`, `src/functional-helpers.test.ts`, `src/loro.test.ts`, `src/mergeable-flattened.test.ts`, `src/nested-container-materialization.test.ts`, `src/readonly.test.ts`, `src/shallow-fork.test.ts`
- `src/typed-refs/list-ref-value-updates.test.ts`, `src/typed-refs/record-ref.test.ts`, `src/typed-refs/record-ref-value-updates.test.ts`, `src/typed-refs/struct-ref.test.ts`

### Key Reference Files

- `packages/change/src/typed-refs/base.ts` — TypedRefParams, INTERNAL_SYMBOL, BaseRefInternals
- `packages/change/src/loro.ts` — LORO_SYMBOL, loro() function
- `packages/change/src/types.ts` — Infer, InferMutableType
- `packages/change/src/diff-overlay.ts` — DiffOverlay, createDiffOverlay
- `packages/hooks-core/src/utils/create-sync-store.ts` — Must use for React subscription
- `packages/hooks-core/src/utils/type-guards.ts` — hasToJSON, INTERNAL_SYMBOL
- `packages/change/src/typed-refs/utils.ts` — serializeRefToJSON (verified: works correctly with PlainValueRef.toJSON())

### Critical Type Definitions

> **Note:** The interface below matches the plan. The actual implementation lives in `plain-value-ref/types.ts` (not `index.ts`) due to a circular dependency: `factory.ts` imports `PlainValueRef` and `index.ts` imports `factory.ts`.

```typescript
// ============================================================================
// Symbols (plain-value-ref/symbols.ts)
// ============================================================================
export const PLAIN_VALUE_REF_SYMBOL = Symbol.for("loro-extended:plain-value-ref")
export const PARENT_INTERNALS_SYMBOL = Symbol.for("loro-extended:parent-internals")
export const PATH_SYMBOL = Symbol.for("loro-extended:path")
export const SHAPE_SYMBOL = Symbol.for("loro-extended:shape")

// ============================================================================
// PlainValueRef Interface (plain-value-ref/types.ts)
//
// NOTE: PlainValueRef must NOT be added to AnyTypedRef.
// AnyTypedRef uses ReturnType<R["toJSON"]> for inference;
// PlainValueRef<any>["toJSON"] returns `any`, destroying inference.
// Use a separate, higher-priority overload in useValue() instead.
//
// NOTE: PlainValueRef must NOT be accepted by loro(), ext(), or change().
// These are container-level operations. Attempting to pass PlainValueRef
// should result in a type error, guiding users to use value() instead.
// ============================================================================
export interface PlainValueRef<T> {
  readonly [PLAIN_VALUE_REF_SYMBOL]: true
  /** @internal */ readonly [PARENT_INTERNALS_SYMBOL]: BaseRefInternals<any>
  /** @internal */ readonly [PATH_SYMBOL]: string[]
  /** @internal */ readonly [SHAPE_SYMBOL]: ValueShape
  valueOf(): T
  toString(): string
  toJSON(): T
  [Symbol.toPrimitive](hint: string): T | string | number
}

// ============================================================================
// Pure Path Operations (utils/path-ops.ts)
// ============================================================================
export function getAtPath(obj: unknown, path: string[]): unknown

export function setAtPath(obj: unknown, path: string[], value: unknown): unknown

export function deepClone<T>(obj: T): T

// ============================================================================
// Value Reader (plain-value-ref/value-reader.ts)
// ============================================================================
export function getOverlayValue(
  internals: BaseRefInternals<any>,
  path: string[]
): unknown | undefined

export function getContainerValue(
  internals: BaseRefInternals<any>,
  path: string[]
): unknown | undefined

export function getPlaceholderValue(
  internals: BaseRefInternals<any>,
  path: string[]
): unknown | undefined

export function resolveValue<T>(
  internals: BaseRefInternals<any>,
  path: string[]
): T | undefined

// ============================================================================
// Value Writer (plain-value-ref/value-writer.ts)
// ============================================================================
export function writeValue(
  internals: BaseRefInternals<any>,
  path: string[],
  value: unknown
): void

// ============================================================================
// Factory (plain-value-ref/factory.ts)
// ============================================================================
export function createPlainValueRef<T>(
  internals: BaseRefInternals<any>,
  path: string[],
  shape: ValueShape
): PlainValueRef<T>

// ============================================================================
// value() Function (value.ts)
// ============================================================================
export function value<T>(ref: PlainValueRef<T>): T
export function value<S extends ContainerShape>(ref: TypedRef<S>): Infer<S>
export function value<D extends DocShape>(doc: TypedDoc<D>): Infer<D>

// ============================================================================
// Updated Shape Types (shape.ts)
// ============================================================================
// Deviation: _mutable uses PlainValueRef<T> | T union (not pure PlainValueRef<T>)
// to allow direct assignment of raw values. See Phase 3b note.
export interface StringValueShape<T extends string = string>
  extends Shape<T, PlainValueRef<T> | T, T> {
  readonly _type: "value"
  readonly valueType: "string"
  readonly options?: T[]
}
```

### Implementation Sketches

#### path-ops.ts (Functional Core - Pure)

```typescript
/**
 * Get a value at a nested path. Pure function.
 */
export function getAtPath(obj: unknown, path: string[]): unknown {
  let current = obj
  for (const key of path) {
    if (current == null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Set a value at a nested path, returning a new object. Pure function.
 * Creates intermediate objects as needed.
 */
export function setAtPath(obj: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value
  
  const cloned = deepClone(obj) ?? {}
  let target = cloned as Record<string, unknown>
  
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (target[key] == null || typeof target[key] !== 'object') {
      target[key] = {}
    }
    target = target[key] as Record<string, unknown>
  }
  
  target[path[path.length - 1]] = value
  return cloned
}

/**
 * Deep clone an object. Pure function.
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  return JSON.parse(JSON.stringify(obj))
}
```

#### value-reader.ts (Imperative Shell)

```typescript
import type { LoroMap, MapDiff } from "loro-crdt"
import type { BaseRefInternals } from "../typed-refs/base.js"
import { getAtPath } from "../utils/path-ops.js"

export function getOverlayValue(
  internals: BaseRefInternals<any>,
  path: string[]
): unknown | undefined {
  const overlay = internals.getOverlay()
  if (!overlay) return undefined
  
  const container = internals.getContainer() as LoroMap
  const containerId = (container as any).id
  const diff = overlay.get(containerId)
  
  if (diff?.type !== "map") return undefined
  const mapDiff = diff as MapDiff
  
  if (!(path[0] in mapDiff.updated)) return undefined
  return getAtPath(mapDiff.updated[path[0]], path.slice(1))
}

export function getContainerValue(
  internals: BaseRefInternals<any>,
  path: string[]
): unknown | undefined {
  const container = internals.getContainer() as LoroMap
  const rootValue = container.get(path[0])
  if (rootValue === undefined) return undefined
  return getAtPath(rootValue, path.slice(1))
}

export function getPlaceholderValue(
  internals: BaseRefInternals<any>,
  path: string[]
): unknown | undefined {
  const placeholder = internals.getPlaceholder() as Record<string, unknown> | undefined
  if (!placeholder) return undefined
  return getAtPath(placeholder[path[0]], path.slice(1))
}

export function resolveValue<T>(
  internals: BaseRefInternals<any>,
  path: string[]
): T | undefined {
  return (
    getOverlayValue(internals, path) ??
    getContainerValue(internals, path) ??
    getPlaceholderValue(internals, path)
  ) as T | undefined
}
```

#### value-writer.ts (Imperative Shell)

```typescript
import type { LoroMap } from "loro-crdt"
import type { BaseRefInternals } from "../typed-refs/base.js"
import { setAtPath, deepClone } from "../utils/path-ops.js"

export function writeValue(
  internals: BaseRefInternals<any>,
  path: string[],
  value: unknown
): void {
  const container = internals.getContainer() as LoroMap
  
  if (path.length === 1) {
    container.set(path[0], value)
  } else {
    const rootKey = path[0]
    const current = container.get(rootKey) ?? {}
    const updated = setAtPath(current, path.slice(1), value)
    container.set(rootKey, updated)
  }
  
  internals.commitIfAuto()
}
```

#### factory.ts (Assembly)

```typescript
import type { BaseRefInternals } from "../typed-refs/base.js"
import type { ValueShape, StructValueShape } from "../shape.js"
import {
  PLAIN_VALUE_REF_SYMBOL,
  PARENT_INTERNALS_SYMBOL,
  PATH_SYMBOL,
  SHAPE_SYMBOL,
} from "./symbols.js"
import { resolveValue } from "./value-reader.js"
import { writeValue } from "./value-writer.js"
import type { PlainValueRef } from "./index.js"

export function createPlainValueRef<T>(
  internals: BaseRefInternals<any>,
  path: string[],
  shape: ValueShape
): PlainValueRef<T> {
  const getValue = () => resolveValue<T>(internals, path)
  
  const base: PlainValueRef<T> = {
    [PLAIN_VALUE_REF_SYMBOL]: true,
    [PARENT_INTERNALS_SYMBOL]: internals,
    [PATH_SYMBOL]: path,
    [SHAPE_SYMBOL]: shape,
    valueOf: getValue,
    toString: () => String(getValue()),
    toJSON: getValue,
    [Symbol.toPrimitive](hint: string) {
      const v = getValue()
      if (hint === "string") return String(v)
      if (hint === "number") return Number(v)
      return v
    },
  }
  
  // For nested struct value shapes, wrap in Proxy
  if (shape.valueType === "struct" && "shape" in shape) {
    return createStructProxy(base, internals, path, shape as StructValueShape)
  }
  
  return base
}

function createStructProxy<T>(
  base: PlainValueRef<T>,
  internals: BaseRefInternals<any>,
  path: string[],
  shape: StructValueShape
): PlainValueRef<T> {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol" || prop in target) {
        return Reflect.get(target, prop, receiver)
      }
      if (typeof prop === "string" && prop in shape.shape) {
        return createPlainValueRef(internals, [...path, prop], shape.shape[prop])
      }
      return undefined
    },
    set(target, prop, value) {
      if (typeof prop === "string" && prop in shape.shape) {
        writeValue(internals, [...path, prop], value)
        return true
      }
      return false
    },
  }) as PlainValueRef<T>
}
```

## Known Issues Discovered During Implementation

### 1. `Shape.plain.record()` / `Shape.plain.array()` nested in container shapes don't support dynamic property SET

When `Shape.plain.record(Shape.plain.string())` is used inside a `Shape.struct()`, accessing the record returns a PlainValueRef wrapping the entire record. But the PlainValueRef factory only creates a Proxy wrapper for `StructValueShape` (to intercept named property access). `RecordValueShape` and `ArrayValueShape` get a bare PlainValueRef without any SET interception, so writes like `(draft.wrapper.config as any).theme = "dark"` silently do nothing.

**Options to fix:**
- Add Proxy wrapping for `RecordValueShape` that intercepts arbitrary string property SET and does read-modify-write on the whole record
- Add Proxy wrapping for `ArrayValueShape` that intercepts numeric index SET
- Alternatively, document that nested record/array value shapes require whole-value replacement: `draft.wrapper.config = { ...value(draft.wrapper.config), theme: "dark" }`

### 2. `RecordRef.values()` and `RecordRef.entries()` return PlainValueRef instead of raw values

These methods iterate over all keys calling `getOrCreateRef()`, which now returns PlainValueRef for value shapes. Callers expecting `number[]` get `PlainValueRef<number>[]`. Options:
- Have `values()`/`entries()` unwrap PlainValueRef before returning
- Or document that consumers should use `value()` to unwrap

### 3. `Object.keys()` / `Object.values()` on refs may expose PlainValueRef internals

Tests that use `Object.keys(structRef)` or `Object.values(recordRef)` may see PlainValueRef symbol properties or get PlainValueRef objects in the values array. This affects encapsulation and JSON compatibility tests.

### 4. List overlay reading is stubbed

`getListOverlayValue()` always returns `undefined`. Full list diff overlay support would require parsing `ListDiff` operations (insert/delete/retain) to map pre-diff indices to post-diff values. This means `getTransition()` with PlainValueRef on list items won't show "before" values correctly.

### 5. `value()` overload doesn't match StructRef

The `value<S extends ContainerShape>(ref: TypedRef<S>): Infer<S>` overload doesn't match StructRef because StructRef is implemented as a Proxy object, not a class extending TypedRef. TypeScript can't prove the Proxy satisfies `TypedRef<S>`. Workaround: use `ref.toJSON()` or add a StructRef-specific overload.

## Changeset

```markdown
---
"@loro-extended/change": major
"@loro-extended/hooks-core": major
"@loro-extended/react": major
"@loro-extended/hono": major
---

# PlainValueRef: Reactive subscriptions for plain values

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
doc.meta.title = "new value"; // Still works (StructRef proxy SET trap)
doc.meta.nested.value = "new"; // Also works (PlainValueRef proxy SET trap)
```
```

## TECHNICAL.md Updates

Add new section under "## @loro-extended/change Architecture":

```markdown
### PlainValueRef: Unified Read-Write Accessor for Plain Values

Plain values (`Shape.plain.*`) are stored as raw Loro `Value` types inside parent containers (StructRef, RecordRef, ListRef). Unlike container shapes, they don't have their own Container IDs and cannot be subscribed to directly.

**PlainValueRef** provides a unified interface for both reading and writing plain values:

| Operation | Behavior |
|-----------|----------|
| `ref.valueOf()` | Fresh read from parent container (with overlay/placeholder) |
| `ref.toJSON()` | Same as valueOf() |
| `ref[prop]` (GET) | Returns nested PlainValueRef |
| `ref[prop] = value` (SET) | Eager read-modify-write + autoCommit |
| `useValue(ref)` | Subscribe to parent, return valueOf() |
| `subscribe(ref, cb)` | Subscribe to parent, call cb when changed |

**FC/IS Architecture:**

The implementation separates pure functions (Functional Core) from CRDT operations (Imperative Shell):

- **Functional Core** (`utils/path-ops.ts`): Pure functions for path traversal and object manipulation
  - `getAtPath(obj, path)` - traverse nested object
  - `setAtPath(obj, path, value)` - return new object with value set
  - `deepClone(obj)` - deep clone

- **Imperative Shell** (`plain-value-ref/value-reader.ts`, `value-writer.ts`): CRDT operations
  - `resolveValue()` - reads from overlay → container → placeholder
  - `writeValue()` - writes to container + commitIfAuto

- **Assembly** (`plain-value-ref/factory.ts`): Composes the PlainValueRef interface

**Architecture:**

```
StructRef (container)
    └── property access for value shape
        └── PlainValueRef<T> (Proxy)
            ├── [PARENT_INTERNALS_SYMBOL]: BaseRefInternals
            ├── [PATH_SYMBOL]: ["nested", "value"]
            ├── GET trap: returns nested PlainValueRef
            ├── SET trap: writeValue() → eager read-modify-write + commitIfAuto
            └── valueOf(): resolveValue() → overlay → container → placeholder
```

**getValue() Resolution Chain:**

1. Check overlay first (for `getTransition()` "before" views)
2. Read from Loro container
3. Fallback to placeholder if value is undefined

**Eager Write-Back:**

When a PlainValueRef's SET trap is triggered (e.g., `draft.meta.nested.value = "new"`):
1. Read the root value from parent container
2. Use `setAtPath()` (pure) to compute updated value
3. Write the entire value back to container
4. Call `internals.commitIfAuto()` for auto-commit outside `change()` blocks

This eliminates the need for `batchedMutation` mode branching and the `absorbPlainValues()` pattern for value shapes.

**What was eliminated:**
- `batchedMutation` mode branching for value shapes
- Deep copy caching in `propertyCache` for value shapes
- The `absorbPlainValues()` pattern for value shapes (only container recursion remains)

**Assignment semantics:**
- Direct assignment (`doc.meta.title = "new"`): StructRef proxy SET trap → `loroMap.set()`
- Nested assignment (`doc.meta.nested.value = "new"`): PlainValueRef proxy SET trap → read-modify-write + commitIfAuto

Both result in immediate writes to Loro, providing a uniform mental model.

**Caveat - List item index stability:**
When you obtain a PlainValueRef from a list (`doc.items.get(0)`), it captures the index at that moment. If the list is subsequently mutated (items inserted, deleted, or moved), the PlainValueRef's index may point to a different item or be out of bounds. This is the same behavior as current list refs—indices are not stable across mutations.
```

# Learnings

- The changeset file (`.changeset/plain-value-ref.md`) is premature and inaccurate.** It claims `useValue()` and `subscribe()` work with PlainValueRef, but those overloads haven't been implemented yet (Phases 4-5). It also claims "strict equality comparisons become TypeScript errors," but this isn't true — because we used `PlainValueRef<T> | T` for `_mutable` (not pure `PlainValueRef<T>`), TypeScript still allows `doc.meta.title === "foo"` since the `string` branch of the union matches. The changeset should be rewritten or deleted and recreated when the implementation is actually complete.

- The `batchedMutation` flag is now dead code for value shapes.** The `change()` function still passes `batchedMutation: true` and the internals still read it, but it no longer affects any branching for value shapes (all the `if (!this.getBatchedMutation())` branches were removed). The comment in `typed-doc.ts` line ~294 saying "Enable value shape caching for find-and-mutate patterns" is now misleading. It should say something like "Enables container ref caching; value shapes use eager write-back via PlainValueRef regardless of this flag."

- The `_mutable` fields on runtime shape objects are still primitives, not PlainValueRef.** For example, `Shape.plain.string()` returns `{ _mutable: "" }` at runtime. This is fine because `_mutable` is only used for TypeScript type-level inference — the interfaces we changed (`StringValueShape extends Shape<T, PlainValueRef<T> | T, T>`) control the types, not the runtime values. But if anyone ever tries to read `_mutable` at runtime to determine what type a value shape returns, they'll get the wrong answer.

- The most architecturally significant issue is Category B from the plan (nested `Shape.plain.record()` / `Shape.plain.array()` in containers).** This isn't just a test fix — it's a missing feature. The factory only creates Proxy wrappers for `StructValueShape`, so `RecordValueShape` and `ArrayValueShape` get bare PlainValueRef objects with no property interception. Any code that previously did `draft.wrapper.config.theme = "dark"` (where `config` is `Shape.plain.record(Shape.plain.string())`) now silently fails at runtime. The easiest fix would be to add a `RecordValueShape` Proxy that intercepts arbitrary string keys for SET (doing read-modify-write of the whole record) and returns the value for GET. A similar approach would be needed for `ArrayValueShape` with numeric index interception. Additional suggestions:

```
  The old behavior that worked:**
  
  Inside `change()`, the old `getOrCreateRef()` for value shapes with `batchedMutation=true` returned a deep-copied plain object cached in `propertyCache`. So `draft.wrapper.config` gave you a real `{ theme: "dark", lang: "en" }` object. You could mutate it freely, and at the end of `change()`, `absorbPlainValues()` wrote the whole thing back to the LoroMap. The tests (and presumably user code) depended on this:
  
  ```loro-extended/packages/change/src/typed-refs/record-ref.test.ts#L87-L90
        change(doc, draft => {
          ;(draft.wrapper.config as any).theme = "dark"
          ;(draft.wrapper.config as any).lang = "en"
        })
  ```
  
  **What broke:**
  
  Now `getOrCreateRef()` always returns a PlainValueRef. The PlainValueRef for a `RecordValueShape` is a bare object with `valueOf`, `toJSON`, and symbol properties — no Proxy. Property SET goes to the object itself and is silently lost.
  
  **My recommendation: Add Proxy wrapping for `RecordValueShape` and `ArrayValueShape`, consistent with how `StructValueShape` already works.**
  
  The factory already has this pattern for structs — it wraps in a Proxy that intercepts GET (return nested value) and SET (read-modify-write + eager write-back). The same approach works cleanly for records and arrays:
  
  For `RecordValueShape`, the Proxy would:
  - **GET(prop)**: Read the whole record from the container via `valueOf()`, return `record[prop]`
  - **SET(prop, value)**: Read the whole record, shallow-merge the new property, write it all back via `writeValue()`
  - **deleteProperty(prop)**: Read the whole record, omit the property, write back
  
  For `ArrayValueShape`, the Proxy would:
  - **GET(index)**: Read the whole array via `valueOf()`, return `array[index]`
  - **GET("length")**: Return the array length
  - **SET(index, value)**: Read-copy-modify-write at the given index
  
  This is the right approach because:
  
  1. **It's consistent.** StructValueShape already works this way. The pattern is "Proxy intercepts property access, does read-modify-write on the whole blob stored in the parent LoroMap." Records and arrays are the same kind of blob.
  
  2. **It preserves backward compatibility.** The mutation patterns from the tests (`draft.wrapper.config.theme = "dark"`, `delete draft.wrapper.config.theme`) continue to work.
  
  3. **The performance cost is the same as StructValueShape.** Every access reads the whole value from the container — but that's already what happens for nested struct value shapes, and these are plain Loro `Value` blobs (not deep container trees), so the read is just a `LoroMap.get()` call.
  
  4. **It avoids re-introducing `batchedMutation` branching.** The Proxy's SET trap writes eagerly, so there's no need to cache mutable copies or absorb them later.
  
  I would **not** recommend the alternative of making these shapes return raw values (bypassing PlainValueRef), because that would create an inconsistency where some value shapes are subscribable and some aren't — exactly the kind of "gotcha" PlainValueRef was designed to eliminate.
```

- The `change()` eager-write-back is working correctly.** I verified that both `changeRef` (ref-level change) and `TypedDocInternal.change()` (doc-level change) work: writes from PlainValueRef SET traps go directly to the Loro container during the callback, and `absorbPlainValues()` at the end only recurses into container children. The find-and-mutate pattern on list items works because `getPredicateItem()` reads fresh from the container (after earlier mutations in the same `change()` wrote back eagerly). This was the biggest risk and it's clean.

- The `value()` TypedRef overload doesn't match StructRef.** Known issue #5 in the plan. If someone tries `value(doc.meta)` where `meta` is a StructRef, TypeScript picks the `TypedDoc` overload (which fails) rather than the `TypedRef` overload. This is because StructRef is Proxy-based and doesn't directly extend the `TypedRef` class. Either add a StructRef-specific overload or document that `ref.toJSON()` should be used instead for container refs.
