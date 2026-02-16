# PlainValueRef Unification: Runtime Value Check and List Integration

## Background

PlainValueRef was introduced to provide reactive subscriptions for plain values (strings, numbers, booleans, nested structs) stored in CRDT containers. The implementation is mostly complete, but two issues emerged during integration:

1. **Primitive Heuristic Problem**: The code decides whether to return raw values or PlainValueRef inside `change()` based on the schema's `valueType` string. This is semantically wrong because `union` and `any` shapes can contain either primitives or objects at runtime.

2. **Parallel Mutation Systems**: StructRef/RecordRef use PlainValueRef with eager writes, while ListRef uses a separate `itemCache` + `absorbPlainValues()` system with deferred writes. This creates behavioral inconsistencies and maintenance burden.

### Current State

**StructRef/RecordRef** (PlainValueRef path):
- Inside `change()`: Returns raw value for "primitive-like" types, PlainValueRef for struct/record/array
- Outside `change()`: Returns PlainValueRef
- Writes are **immediate** via `writeValue()` which does read-modify-write

**ListRef** (`itemCache` path):
- Inside `change()`: Returns deep-cloned cached object via `JSON.parse(JSON.stringify())`
- Outside `change()`: Returns raw container value
- Writes are **deferred** until `absorbPlainValues()` at end of `change()`

### Key Files

- `packages/change/src/typed-refs/struct-ref-internals.ts` — primitive heuristic at L127-140
- `packages/change/src/typed-refs/record-ref-internals.ts` — same pattern duplicated
- `packages/change/src/typed-refs/list-ref-base.ts` — `getMutableItem()` at L150-220, `absorbPlainValues()` at L285-310
- `packages/change/src/plain-value-ref/factory.ts` — `createListItemPlainValueRef()` exists but unused by ListRef
- `packages/change/src/plain-value-ref/value-writer.ts` — `writeListValue()` for immediate list writes
- `packages/change/src/typed-refs/plain-value-access.ts` — shared helpers for PlainValueRef access

---

## Problem Statement

### Problem 1: Primitive Heuristic is Semantically Wrong

The current code checks `valueType` against a hardcoded list:

```typescript
const isPrimitive =
  valueType === "string" ||
  valueType === "number" ||
  valueType === "boolean" ||
  valueType === "null" ||
  valueType === "union" ||  // WRONG: union can contain objects
  valueType === "any"       // WRONG: any can be anything
```

**Failure scenario** with union of structs:
```typescript
metadata: Shape.plain.union([
  Shape.plain.struct({ type: Shape.plain.string("a"), value: Shape.plain.number() }),
  Shape.plain.struct({ type: Shape.plain.string("b"), data: Shape.plain.string() }),
])

change(doc, draft => {
  draft.metadata.value = 42  // Silent data loss — mutates in-memory object, never written back
})
```

### Problem 2: Two Parallel Mutation Tracking Systems

| Aspect | StructRef/RecordRef | ListRef |
|--------|---------------------|---------|
| Write timing | Immediate | Deferred |
| Cloning | None (proxy) | `JSON.parse(JSON.stringify())` |
| Multiple accesses | Fresh PlainValueRef each time | Same cached object |
| `undefined` handling | Correct | Lost (JSON doesn't support) |
| Code complexity | PlainValueRef module | ~80 lines in list-ref-base |

The `JSON.parse(JSON.stringify())` cloning also loses:
- `undefined` values
- Functions, Symbols
- Circular references
- Performance for large objects

### Problem 3: `writeListValue` Assumes `container.set()` Exists on LoroList

**Confirmed bug:** `writeListValue()` calls `container.set(index, value)` on both LoroList and LoroMovableList. But **LoroList does NOT have `.set()`** — only LoroMovableList does. The existing `absorbValueAtIndex` in `ListRefInternals` works around this with `container.delete(index, 1); container.insert(index, value)`, but `writeListValue` does not.

This means any PlainValueRef write to a LoroList value shape would throw `list.set is not a function` at runtime.

### Problem 4: Proxy Factory Duplication

`factory.ts` currently has 3 proxy implementations (`createStructProxy`, `createRecordProxy`, `createListItemStructProxy`) that share identical GET preambles, identical `isPlainValueRefLike` unwrapping, and near-identical SET traps. The plan as originally written would add a 4th (`createListItemRecordProxy`), deepening the duplication.

### Problem 5: `unwrap()` Duplicated in 17 Test Files

The identical `unwrap` helper is copy-pasted into 17 test files. It should be exported from the package and the copies removed.

---

## Success Criteria

1. **Runtime value check**: Inside `change()`, return raw values only when the actual value is a primitive (`typeof !== 'object'` or `=== null`), not based on schema type
2. **Unified mutation tracking**: ListRef uses PlainValueRef for value shapes, eliminating `itemCache` for value shapes and `absorbPlainValues()` value-shape logic
3. **Consistent behavior**: Same timing, cloning, and visibility semantics for value shapes regardless of container type
4. **LoroList write correctness**: `writeListValue` uses delete+insert for LoroList, `.set()` for LoroMovableList
5. **No proxy duplication**: Proxy creation uses shared composition, not 4 copy-pasted functions
6. **Single `unwrap` source**: Exported from package, test copies removed
7. **All existing tests pass**: No regressions in 848 tests
8. **No breaking API changes**: External behavior preserved

---

## The Gap

### Gap 1: Heuristic needs runtime check
Current: Schema-based `valueType` check
Target: Runtime `typeof` check on resolved value

### Gap 2: ListRef doesn't use PlainValueRef
Current: `getMutableItem()` returns cached clones for value shapes
Target: `getMutableItem()` returns `createPlainValueRefForListItem()` for value shapes

### Gap 3: List item struct proxy needs parity
Current: `createListItemStructProxy` does read-modify-write but returns raw nested values on GET
Target: Nested property GET should return sub-PlainValueRef for consistent mutation tracking

### Gap 4: `writeListValue` doesn't work on LoroList
Current: Calls `container.set(index, value)` which throws on LoroList
Target: Branches on container type: delete+insert for LoroList, `.set()` for LoroMovableList

### Gap 5: 4 copy-pasted proxy functions in factory.ts
Current: 3 proxies with a 4th needed
Target: Shared proxy composition with write-strategy and key-strategy parameters

### Gap 6: No shared `unwrap`
Current: 17 identical copies in test files
Target: Exported from `index.ts`, copies replaced with imports

---

## Phases and Tasks

### Phase 0: Reduce Duplication Before Adding More 🟢

Refactor factory.ts and plain-value-access.ts to eliminate duplication *before* adding list record proxy support or the runtime check. This prevents the plan from making the duplication worse.

**Tasks:**
- 🟢 Extract `createBasePlainValueRef(getValue, internals, pathOrIndex, shape)` helper that builds the base object (symbols, valueOf, toString, toJSON, toPrimitive). Currently duplicated between `createPlainValueRef` and `createListItemPlainValueRef`.
- 🟢 Extract shared proxy handler composition in factory.ts. The two axes of variation are: (a) write function (`writeValue` with path vs `writeListValue` with index) and (b) key validation (static keys from `shape.shape` for struct vs any string key for record). Extract a `createValueShapeProxyHandlers(options)` function that produces GET/SET/DELETE traps parameterized by these two axes.
- 🟢 Rewrite existing `createStructProxy`, `createRecordProxy`, and `createListItemStructProxy` as thin calls to the shared composition. Verify all 848 tests still pass.
- 🟢 Extract `resolveValueForBatchedMutation(internals, key, shape)` into `plain-value-access.ts`. This function encapsulates: read from container → fallback to placeholder → runtime `typeof` check → return raw value or PlainValueRef. Currently this logic is duplicated in `struct-ref-internals.ts` and `record-ref-internals.ts`, and will be needed in `list-ref-base.ts`.
- 🟢 Export `unwrap` from `packages/change/src/index.ts` (or `value.ts`). Replace all 17 test-file copies with imports.
- 🟢 Fix `writeListValue` to branch on container type: use `container.delete(index, 1); container.insert(index, value)` for LoroList, and `container.set(index, value)` for LoroMovableList. Add a unit test confirming both paths work.

### Phase 1: Runtime Value Check for Primitive Heuristic 🟢

Replace schema-based `valueType` check with runtime `typeof` check via the shared `resolveValueForBatchedMutation` extracted in Phase 0.

**Tasks:**
- 🟢 Replace the `isPrimitive` heuristic in `StructRefInternals.getOrCreateRef()` with a call to `resolveValueForBatchedMutation(this, key, actualShape)`
- 🟢 Replace the same heuristic in `RecordRefInternals.getOrCreateRef()` with the same call
- 🟢 Add tests for union-of-structs and any-containing-object scenarios

**`resolveValueForBatchedMutation` approach:**
```typescript
export function resolveValueForBatchedMutation(
  internals: BaseRefInternals<any>,
  key: string,
  shape: ValueShape,
): unknown {
  const container = internals.getContainer() as LoroMap
  const rawValue = container.get(key)
  const resolved = rawValue !== undefined ? rawValue : (internals.getPlaceholder() as any)?.[key]

  // Return raw value only for actual primitives (not objects/arrays).
  // This handles union and any correctly regardless of what they contain at runtime.
  if (resolved === null || typeof resolved !== 'object') {
    return resolved
  }

  // For objects, return PlainValueRef for nested mutation tracking
  return createPlainValueRefForProperty(internals, key, shape)
}
```

### Phase 2: Unify ListRef Value Shape Handling 🟢

Migrate ListRef to use PlainValueRef for value shapes, removing the parallel caching system.

**Tasks:**
- 🟢 Modify `getMutableItem()` to return `createPlainValueRefForListItem()` for value shapes in both batched and non-batched modes. Inside batched mode, also apply the runtime primitive check (return raw for primitives, PlainValueRef for objects).
- 🟢 Remove value-shape caching logic from `getMutableItem()` (keep container-shape caching)
- 🟢 Remove the `itemCache` read from `getPredicateItem()` for value shapes. With PlainValueRef and immediate writes, predicates should read fresh from the container and see the same mutations.
- 🟢 Remove value-shape absorption logic from `absorbPlainValues()` (keep container-shape recursion)
- 🟢 Remove `JSON.parse(JSON.stringify())` cloning
- 🟢 Add list-item record proxy support via the shared proxy composition from Phase 0 (no new copy-pasted function needed)
- 🟢 Update `createListItemStructProxy` to return sub-PlainValueRef for nested property GET (parity with map-based struct proxy), again via the shared composition

### Phase 3: Tests and Cleanup 🟢

**Tasks:**
- 🟢 Add test: union-of-structs inside `change()` with nested mutation persists
- 🟢 Add test: `Shape.plain.any()` containing object with nested mutation persists
- 🟢 Add test: ListRef with struct value shape, nested mutation persists via PlainValueRef
- 🟢 Add test: ListRef with record value shape, dynamic key SET persists
- 🟢 Add test: `writeListValue` works on LoroList (not just LoroMovableList)
- 🟢 Add test: Predicate sees in-flight mutations within same `change()` — mutate via `getMutableItem`, then verify `getPredicateItem` / `find()` sees the mutation
- 🟢 Verify all existing tests still pass
- 🟢 Remove dead code from list-ref-base: value shape caching in `getMutableItem()`
- 🟢 Simplify `absorbPlainValues()`: value-shape branch becomes unreachable (PlainValueRef writes immediately)
- 🟢 Mark `absorbValueAtIndex()` in ListRefInternals and MovableListRefInternals as dead code for value shapes (keep for potential future use, but document that PlainValueRef bypasses it)

### Phase 4: Documentation 🟢

**Tasks:**
- 🟢 Update TECHNICAL.md "Value Shape Caching" section to reflect unified PlainValueRef approach
- 🟢 Update plans/plain-value-ref.md "Known Issues" section to mark issues as resolved
- 🟢 Add changeset for the fix

---

## Unit and Integration Tests

### writeListValue LoroList Compatibility Test

```typescript
describe("writeListValue", () => {
  it("writes to LoroList via delete+insert", () => {
    const doc = new LoroDoc()
    const list = doc.getList("test")
    list.insert(0, "original")
    doc.commit()
    expect(list.get(0)).toBe("original")

    // writeListValue must work on LoroList (which has no .set())
    writeListValue(/* internals wrapping this list */, 0, "updated")
    expect(list.get(0)).toBe("updated")
  })

  it("writes to LoroMovableList via .set()", () => {
    const doc = new LoroDoc()
    const list = doc.getMovableList("test")
    list.insert(0, "original")
    doc.commit()

    writeListValue(/* internals wrapping this list */, 0, "updated")
    expect(list.get(0)).toBe("updated")
  })
})
```

### Runtime Value Check Tests

```typescript
describe("runtime primitive check", () => {
  it("union of primitives returns raw value inside change()", () => {
    const schema = Shape.doc({
      data: Shape.struct({
        nullable: Shape.plain.union([Shape.plain.null(), Shape.plain.string()])
      })
    })
    const doc = createTypedDoc(schema)
    change(doc, draft => {
      expect(draft.data.nullable).toBeNull()  // raw null, not PlainValueRef
      draft.data.nullable = "hello"
      expect(draft.data.nullable).toBe("hello")  // raw string
    })
  })

  it("union of structs returns PlainValueRef inside change() for nested mutation", () => {
    const schema = Shape.doc({
      data: Shape.struct({
        metadata: Shape.plain.union([
          Shape.plain.struct({ type: Shape.plain.string(), value: Shape.plain.number() }),
        ])
      })
    })
    const doc = createTypedDoc(schema)
    change(doc, draft => {
      draft.data.metadata = { type: "a", value: 1 }
    })
    change(doc, draft => {
      draft.data.metadata.value = 42  // Must persist
    })
    expect(doc.toJSON().data.metadata.value).toBe(42)
  })

  it("any shape with object value returns PlainValueRef for nested mutation", () => {
    const schema = Shape.doc({
      config: Shape.struct({
        options: Shape.plain.any()
      })
    })
    const doc = createTypedDoc(schema)
    change(doc, draft => {
      draft.config.options = { nested: { deep: true } }
    })
    change(doc, draft => {
      draft.config.options.nested.deep = false  // Must persist
    })
    expect(doc.toJSON().config.options.nested.deep).toBe(false)
  })
})
```

### List PlainValueRef Integration Tests

```typescript
describe("ListRef PlainValueRef unification", () => {
  it("list item struct mutation persists via PlainValueRef", () => {
    const schema = Shape.doc({
      items: Shape.list(Shape.plain.struct({
        name: Shape.plain.string(),
        active: Shape.plain.boolean()
      }))
    })
    const doc = createTypedDoc(schema)
    change(doc, draft => {
      draft.items.push({ name: "item1", active: false })
    })
    change(doc, draft => {
      const item = draft.items.get(0)
      item.active = true  // Must persist
    })
    expect(doc.toJSON().items[0].active).toBe(true)
  })

  it("find-and-mutate pattern works with PlainValueRef", () => {
    const schema = Shape.doc({
      users: Shape.list(Shape.plain.struct({
        id: Shape.plain.string(),
        score: Shape.plain.number()
      }))
    })
    const doc = createTypedDoc(schema)
    change(doc, draft => {
      draft.users.push({ id: "a", score: 0 })
      draft.users.push({ id: "b", score: 0 })
    })
    change(doc, draft => {
      const user = draft.users.find(u => u.id === "a")
      if (user) user.score = 100  // Must persist
    })
    expect(doc.toJSON().users[0].score).toBe(100)
  })

  it("predicate sees in-flight mutations within same change()", () => {
    const schema = Shape.doc({
      items: Shape.list(Shape.plain.struct({
        id: Shape.plain.string(),
        value: Shape.plain.number()
      }))
    })
    const doc = createTypedDoc(schema)
    change(doc, draft => {
      draft.items.push({ id: "x", value: 0 })
    })
    change(doc, draft => {
      // Mutate via getMutableItem (PlainValueRef writes immediately)
      const item = draft.items.get(0)
      item.value = 999

      // Predicate should see the mutation (reads fresh from container)
      const found = draft.items.find(i => i.value === 999)
      expect(found).toBeDefined()
    })
  })

  it("list outside change() returns PlainValueRef for value shapes", () => {
    const schema = Shape.doc({
      items: Shape.list(Shape.plain.struct({ value: Shape.plain.number() }))
    })
    const doc = createTypedDoc(schema)
    change(doc, draft => {
      draft.items.push({ value: 42 })
    })
    const item = doc.items.get(0)
    expect(isPlainValueRef(item)).toBe(true)
    expect(unwrap(item?.value)).toBe(42)
  })
})
```

---

## Transitive Effect Analysis

### Direct Changes
1. `plain-value-ref/factory.ts` — refactor proxy creation into shared composition, extract base builder
2. `plain-value-ref/value-writer.ts` — fix `writeListValue` for LoroList
3. `typed-refs/plain-value-access.ts` — add `resolveValueForBatchedMutation`
4. `struct-ref-internals.ts` — replace isPrimitive heuristic with `resolveValueForBatchedMutation`
5. `record-ref-internals.ts` — same replacement
6. `list-ref-base.ts` — `getMutableItem()` rewrite, `getPredicateItem()` simplification, `absorbPlainValues()` simplification
7. `index.ts` — export `unwrap`

### Transitive Consumers
- `list-ref.ts` extends `ListRefBase` — inherits changes automatically
- `movable-list-ref.ts` extends `ListRefBase` — inherits changes automatically
- `list-ref-internals.ts` overrides `absorbValueAtIndex()` — becomes dead code for value shapes because PlainValueRef calls `writeListValue()` immediately instead of deferring to absorption
- `movable-list-ref-internals.ts` overrides `absorbValueAtIndex()` — same, becomes dead code for value shapes

**Note on `absorbValueAtIndex()`:** These methods implemented deferred writes:
- `ListRefInternals`: `container.delete(index, 1); container.insert(index, value)` 
- `MovableListRefInternals`: `container.set(index, value)`

With PlainValueRef, writes happen immediately via `writeListValue()`. The absorption path is no longer taken for value shapes. These methods can be kept as dead code with documentation, or removed.

**Note on `getPredicateItem()`:** Currently reads from `itemCache` first so predicates see in-flight mutations from cached objects. After removing value-shape caching, this cache-read becomes dead code. Predicates should instead see in-flight mutations because PlainValueRef writes immediately to the container, and `getPredicateItem` reads from the container. Add a test to verify this behavioral equivalence.

### Test Files Affected
- `list-ref-value-updates.test.ts` — verifies value mutation persistence
- `change.test.ts` — find-and-mutate patterns
- `json-compatibility.test.ts` — Array methods on lists
- `functional-helpers.test.ts` — `change()` integration
- All 17 files with `const unwrap = ...` — replace with import

### No Breaking Changes Expected
- External API unchanged (PlainValueRef vs raw value is implementation detail inside `change()`)
- `getPredicateItem()` still returns raw values for predicate callbacks (correct, unchanged)
- Outside `change()`, behavior is the same (PlainValueRef for value shapes)
- New `unwrap` export is additive

---

## Resources for Implementation

### Files to Modify

1. `packages/change/src/plain-value-ref/factory.ts`
   - Extract `createBasePlainValueRef` from duplicated base-building code
   - Extract `createValueShapeProxyHandlers` for shared proxy composition
   - Rewrite 3 existing proxy functions as calls to shared composition
   - Add list-item record proxy via composition (not a new copy-pasted function)

2. `packages/change/src/plain-value-ref/value-writer.ts`
   - Fix `writeListValue` to detect LoroList vs LoroMovableList and branch accordingly

3. `packages/change/src/typed-refs/plain-value-access.ts`
   - Add `resolveValueForBatchedMutation()` — single source of truth for runtime typeof check

4. `packages/change/src/typed-refs/struct-ref-internals.ts`
   - Replace L117-145 `isPrimitive` heuristic with call to `resolveValueForBatchedMutation`

5. `packages/change/src/typed-refs/record-ref-internals.ts`
   - Replace L136-165 `isPrimitive` heuristic with call to `resolveValueForBatchedMutation`

6. `packages/change/src/typed-refs/list-ref-base.ts`
   - `getMutableItem()`: return PlainValueRef for value shapes, apply runtime primitive check inside batchedMutation
   - `getPredicateItem()`: remove `itemCache` read for value shapes
   - `absorbPlainValues()`: remove value-shape absorption branch

7. `packages/change/src/index.ts`
   - Export `unwrap`

8. `packages/change/src/typed-refs/list-ref-internals.ts`
   - `absorbValueAtIndex()` — document as dead code for value shapes

9. `packages/change/src/typed-refs/movable-list-ref-internals.ts`
   - `absorbValueAtIndex()` — document as dead code for value shapes

10. 17 test files
    - Replace `const unwrap = ...` with `import { unwrap } from ...`

### Key Reference Files

- `packages/change/src/plain-value-ref/value-reader.ts` — `resolveValue()`, `resolveListValue()`
- `packages/change/src/typed-refs/plain-value-access.ts` — `createPlainValueRefForListItem()`
- `packages/change/src/shape.ts` — ValueShape type definitions, `valueType` strings

### Critical Invariants to Preserve

1. `getPredicateItem()` must continue returning raw values (not PlainValueRef) for predicate callbacks
2. Container shape caching in `itemCache` must be preserved (only value shape caching removed)
3. `absorbPlainValues()` must still recurse into container shape refs
4. `writeListValue` must use delete+insert on LoroList (no `.set()` method)

---

## Changeset

```markdown
---
"@loro-extended/change": patch
---

### PlainValueRef: Runtime value check and list integration

**Fixes:**
- Union and any value shapes now correctly return PlainValueRef for object values inside `change()`, enabling nested mutation tracking
- ListRef value shapes now use PlainValueRef with immediate writes, matching StructRef/RecordRef behavior
- `writeListValue` now correctly handles LoroList (delete+insert) vs LoroMovableList (.set())

**New exports:**
- `unwrap()` — helper to unwrap PlainValueRef or return value as-is

**Removed:**
- `JSON.parse(JSON.stringify())` cloning for list value shape items
- Deferred `absorbPlainValues()` logic for list value shapes

**Behavior unchanged:**
- Primitive values (string, number, boolean, null) still return raw values inside `change()` for boolean logic ergonomics
- Outside `change()`, all value shapes return PlainValueRef
- Predicate callbacks (`find`, `filter`, etc.) still receive raw values
```

---

## TECHNICAL.md Updates

Update the "Value Shape Caching" section:

```markdown
### Value Shape Handling

When `batchedMutation: true` (inside `change()` blocks):

- **Primitive values** (string, number, boolean, null) are returned as raw values
  for ergonomic boolean logic (`if (draft.active)`, `!draft.published`)
- **Object/array values** are wrapped in PlainValueRef with immediate write-back
  to support nested mutation patterns (`item.metadata.author = "Alice"`)

When `batchedMutation: false` (direct access outside `change()`):

- All value shapes return PlainValueRef for reactive subscriptions
- Use `value()` or `unwrap()` to get the raw value

**Note:** The primitive vs object decision is made at runtime based on the actual
value (`typeof`), not the schema type. This correctly handles `union` and `any`
shapes that can contain either primitives or objects.

**List items:** ListRef uses the same PlainValueRef mechanism as StructRef/RecordRef.
Mutations are written immediately via `writeListValue()`, not deferred. For LoroList
(which lacks `.set()`), this uses delete+insert. For LoroMovableList, it uses `.set()`.
```

---

## README.md Updates

None required — this is an internal implementation fix with no public API changes beyond the additive `unwrap` export.