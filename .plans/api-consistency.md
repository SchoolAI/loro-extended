# API Consistency: Dot for Traversal, Methods for Read/Write

## Principle

1. **Traversal** — Use dot notation for schema paths, `.get()` for dynamic/indexed access
2. **Read/Write** — Use method notation (`.get()`, `.set()`, etc.) — never assignment or property getters
3. **Uniform** — Same API inside and outside `change()` blocks. No dual mode.

## Status: ✅ NEARLY COMPLETE

- **Format:** ✅ passing
- **Types (source + tests):** ✅ zero errors
- **Logic:** ❌ 4 test failures remaining (down from 109 → 97% fixed)

### Remaining 4 Failures (Design Decisions)

All in `plainvalueref-unification.test.ts` — these test OLD expected behavior that conflicts with the new "consistent PlainValueRef everywhere" design:

| Test | Expects | Gets | Decision Needed |
|------|---------|------|-----------------|
| "union of primitives returns raw value inside change()" | raw `null` | PlainValueRef | Keep PlainValueRef for consistency? |
| "any shape with primitive value returns raw value" | raw `42` | PlainValueRef | Keep PlainValueRef for consistency? |
| "array .length property is accessible via PlainValueRef" | `5` (number) | PlainValueRef | Add special handling for array properties? |
| "numeric index access on array PlainValueRef returns the element" | `"first"` | PlainValueRef | Add special handling for array index access? |

**Recommendation:** Update these tests to match the new behavior (use `.get()` to unwrap), documenting that PlainValueRef is returned consistently for all values. This maintains the "uniform API" principle.

## What Was Done

### Phase 1: Core API changes (previous developer)

### 1. PlainValueRef: Added `.get()` and `.set()` methods ✅
- `packages/change/src/plain-value-ref/types.ts` — Added method signatures to interface
- `packages/change/src/plain-value-ref/factory.ts` — Implemented in `buildBasePlainValueRef()`
- `.get()` returns the current plain value (delegates to `valueOf()`)
- `.set(value)` writes through to the container immediately (via `writeValue` / `writeListValue`)

### 2. DeepPlainValueRef type ✅
- `packages/change/src/plain-value-ref/types.ts` — New type alias
- When `T` is a plain object, exposes each key as a nested `DeepPlainValueRef<T[K]>`
- Matches the runtime Proxy behavior where `ref.author` creates a nested PlainValueRef
- Kept separate from `PlainValueRef` to avoid circular type references in the shape system
- Applied at the access point via `Deepen` helper in `SelectByMode` (shape.ts)

### 3. CounterRef: Replaced `.value` getter with `.get()` method ✅
- `packages/change/src/typed-refs/counter-ref.ts`
- `valueOf()` and `toJSON()` still work for coercion

### 4. ListRef: Added `.set(index, value)`, removed bracket assignment ✅
- `packages/change/src/typed-refs/list-ref-base.ts` — Added `.set(index, value)` method
- `packages/change/src/typed-refs/list-ref.ts` — Removed `[index: number]` type signature
- `packages/change/src/typed-refs/movable-list-ref.ts` — Removed index signature, removed duplicate `.set()` (inherits from ListRefBase)
- `packages/change/src/typed-refs/proxy-handlers.ts` — Removed SET traps from list/movableList handlers
- Runtime: bracket GET still works via proxy (returns same as `.get()`), but types don't expose it

### 5. StructRef: Removed SET and deleteProperty traps ✅
- `packages/change/src/typed-refs/struct-ref.ts` — Removed SET and deleteProperty traps from Proxy
- Property access returns PlainValueRef; write via `.set()` on the PlainValueRef

### 6. RecordRef: Removed SET and deleteProperty traps ✅
- `packages/change/src/typed-refs/proxy-handlers.ts` — Removed SET and deleteProperty from `recordProxyHandler`
- Bracket GET still works for reading (`doc.players.alice` → calls `getRef("alice")`)
- Write via `record.set("key", value)`, delete via `record.delete("key")`

### 7. PlainValueRef Proxies: Removed all SET traps ✅
- `packages/change/src/plain-value-ref/factory.ts` — Removed SET traps from:
  - `createStructProxy`
  - `createGenericObjectProxy`
  - `createNestedGenericObjectProxy`
  - `createRecordProxy`
  - `createListItemStructProxy`
  - `createListItemRecordProxy`
  - `createListItemNestedStructProxy`
  - `createListItemNestedRecordProxy`
- Removed dead code: `unwrapForSet`, `isPlainValueRefLike`, `writeListItemNestedValue`
- Removed unused imports: `setAtPath`, `transformAtPath`

### 8. Shape types unified: `_draft` = `_mutable` ✅
- `packages/change/src/shape.ts` — All ValueShape `_draft` types now return `PlainValueRef<T>` (same as `_mutable`)
- `SelectByMode` now applies `Deepen<T>` to expand `PlainValueRef<T>` into `DeepPlainValueRef<T>`
- Phantom type assignments in shape factories use `as any` (never instantiated at runtime)

### 9. Batched mutation: Always returns PlainValueRef ✅
- `packages/change/src/typed-refs/plain-value-access.ts`
- `resolveValueForBatchedMutation` now always returns PlainValueRef (no more raw primitives inside `change()`)
- `resolveListValueForBatchedMutation` same change

### 10. Test updates (partial, phase 1) ✅
- `.counter.value` → `.counter.get()` across all test files
- `draft.foo.bar = "value"` → `draft.foo.bar.set("value")` for many patterns
- `forkedDoc.items[0]` → `forkedDoc.items.get(0)`
- Various find-and-mutate patterns updated

### Phase 2: Runtime fixes + remaining test updates (current work)

### 11. AnyValueShape._draft fixed ✅
- `packages/change/src/shape.ts` — `AnyValueShape._draft` changed from `Value` to `PlainValueRef<Value>` (matching `_mutable`)
- Factory function updated: `_draft: {} as any` (same as `_mutable`)
- This was an oversight from Phase 1 — all other ValueShapes already had `_draft = _mutable`

### 12. List item proxy primitive checks removed ✅
- `packages/change/src/plain-value-ref/factory.ts` — Removed `runtimePrimitiveCheck` from:
  - `createListItemStructProxy` — always returns `createListItemNestedPlainValueRef` for nested properties
  - `createListItemNestedStructProxy` — same
  - `createGenericObjectProxy` — primitives now go through `createNestedGenericObjectProxy` (returns PlainValueRef base)
  - `createNestedGenericObjectProxy` — same recursive fix
- **Why:** With SET traps removed, returning raw primitives left no way to mutate nested list item properties. Consistency with `createStructProxy` (which never had the check).

### 13. Nested list item read-modify-write ✅
- `packages/change/src/plain-value-ref/value-writer.ts` — Added `writeListValueAtPath(internals, index, nestedPath, value)`
  - Reads the current item, updates the nested path via `setAtPath`, writes the whole item back
- `packages/change/src/plain-value-ref/factory.ts` — `buildBasePlainValueRef` now accepts `listNestedPath` parameter
  - `.set()` delegates to `writeListValueAtPath` when nested path is present
  - `createListItemNestedPlainValueRef` passes `nestedPath` to the builder

### 14. createRecordProxy: PlainValueRef for all keys ✅
- `packages/change/src/plain-value-ref/factory.ts` — `createRecordProxy` now always creates PlainValueRef for any key access (even non-existent keys)
- Enables `.set()` on new record keys via read-modify-write

### 15. Source code assignment fixes ✅
- `packages/change/src/json-patch.ts` — `handleAdd`, `handleRemove`, `handleReplace` use `ref.set()` instead of `parent[key] = value`
- `packages/change/src/typed-refs/utils.ts` — `assignPlainValueToTypedRef` split into struct path (uses `propRef.set()`) and record path (uses `ref.set(k, v)`)

### 16. All type-level test errors fixed ✅
- 60 type errors → 0 type errors
- `_draft` expectations updated to `PlainValueRef<T>`
- ListRef index signature tests updated to use `.get()` return type
- `Draft<>` type assertions updated

## Remaining Work: ~60 Test Type Errors

All remaining errors are in test files using old patterns. The fixes are mechanical:

| Old Pattern | New Pattern |
|-------------|-------------|
| `draft.meta.title = "New"` | `draft.meta.title.set("New")` |
| `draft.data.tags = ["a", "b"]` | `draft.data.tags.set(["a", "b"])` |
| `draft.data.point = { x: 1 }` | `draft.data.point.set({ x: 1 })` |
| `item.completed = !item.completed` | `item.completed.set(!item.completed.get())` |
| `record.alice = { ... }` | `record.set("alice", { ... })` |
| `doc.counter.value` | `doc.counter.get()` |

### Completed test fixes (previously failing, now passing)

| File | Status | What was fixed |
|------|--------|----------------|
| `src/change.test.ts` | ✅ | Assignment → `.set()`, `.toBe()` → `value()` unwrap, slice unwrap, live-ref move fix |
| `src/types.test.ts` | ✅ (1 left) | `_draft` expectations updated to `PlainValueRef<T>`, ListRef index → `.get()` return type |
| `src/typed-refs/plainvalueref-unification.test.ts` | ✅ (4 left) | Assignment → `.set()`, array-in-any `.set()` |
| `tests/world-state-schema.test.ts` | ✅ | All assignment → `.set()` |
| `src/readonly.test.ts` | ✅ | `d.meta.count = 1` → `.set(1)` |
| `src/discriminated-union.test.ts` | ✅ | `.set({...})` for discriminated union |
| `src/typed-refs/list-ref-value-updates.test.ts` | ✅ | `.set()` for struct props |
| `src/path-selector.test.ts` | ✅ | `.set("light")` |
| `src/overlay-recursion.test.ts` | ✅ | `.set("Alice")` |
| `src/functional-helpers.test.ts` | ✅ (1 left) | `.set(10)` |
| `src/typed-refs/record-ref.test.ts` | Partial (5 left) | `draft.scores.alice = 100` → `draft.scores.set("alice", 100)` |
| `src/typed-refs/record-ref-value-updates.test.ts` | ✅ | `draft.input.set("key1", 100)` |

### Fixed Issues (Previously 30 failures, now 4)

| File | Previous Failures | Status | What Was Fixed |
|------|-------------------|--------|----------------|
| `src/mergeable-flattened.test.ts` | 8 | ✅ FIXED | Tests updated to use `change()` + `.set()` |
| `src/json-patch.test.ts` | 5 | ✅ FIXED | Source: unwrap PlainValueRef before mutation, proper deleteProperty |
| `src/typed-refs/record-ref.test.ts` | 4 | ✅ FIXED | Source: `assignPlainValueToTypedRef` handles CounterRef, nested structs, text |
| `src/nested-container-materialization.test.ts` | 4 | ✅ FIXED | Source: list handling in struct assignment loop |
| `src/discriminated-union-tojson.test.ts` | 1 | ✅ FIXED | Source: list/movableList handling in `assignPlainValueToTypedRef` |
| `src/typed-refs/struct-ref.test.ts` | 1 | ✅ FIXED | Test updated to use `.set()` |
| `src/typed-refs/tree-node-ref.test.ts` | 1 | ✅ FIXED | Source: `createNode()` uses `assignPlainValueToTypedRef` for container refs |
| `src/typed-refs/movable-list-ref.test.ts` | 1 | ✅ FIXED | Source: `list.set()` updates existing containers |
| `src/fork-at.test.ts` | 1 | ✅ FIXED | Source: tree createNode fix cascaded |
| `src/typed-refs/plainvalueref-unification.test.ts` | 4 | ❌ 4 remain | Design decision: raw primitives vs PlainValueRef |

### How to fix remaining tests

The failures fall into these categories:

#### 1. Assignment → `.set()` (most common)
```typescript
// Old:
draft.foo.bar = "value"
// New:
draft.foo.bar.set("value")
```

#### 2. Record assignment → `record.set(key, value)`
```typescript
// Old:
draft.scores.alice = 100
// New:
draft.scores.set("alice", 100)
```

#### 3. PlainValueRef comparison → unwrap with `value()` or `.get()`
```typescript
// Old:
expect(draft.items.get(0)).toBe("a")
expect(draft.items.find(x => x === "a")).toBe("a")
expect(draft.items.filter(x => x > 0)).toEqual([1, 2])
expect(draft.items.slice(0, 2)).toEqual(["a", "b"])
// New:
expect(value(draft.items.get(0))).toBe("a")
expect(value(draft.items.find(x => x === "a"))).toBe("a")
expect(draft.items.filter(x => x > 0).map(v => value(v))).toEqual([1, 2])
expect(draft.items.slice(0, 2).map(v => value(v))).toEqual(["a", "b"])
```

#### 4. PlainValueRef is a LIVE reference (critical gotcha)
```typescript
// WRONG: .get() reads current state, which changes after delete
const ref = draft.items.get(0)
draft.items.delete(0, 1)
draft.items.insert(2, ref.get()) // ref now points to shifted index!

// RIGHT: capture raw value BEFORE mutating
const rawValue = draft.items.get(0)?.get()
draft.items.delete(0, 1)
draft.items.insert(2, rawValue)
```

#### 5. Old SET-trap tests should be removed or rewritten
Tests like "nested struct SET triggers writeValue" that specifically tested the
Proxy SET trap behavior should be rewritten to test `.set()` instead.

### Verification command

```bash
pnpm turbo run verify --filter=@loro-extended/change
```

To run a single test file:
```bash
pnpm turbo run verify --filter=@loro-extended/change -- logic -- -t "change.test"
```

## Audit Findings (What We Fixed)

### Source code bugs found via systematic audit

All of these have now been fixed:

| Location | Bug | Fix |
|----------|-----|-----|
| `tree-ref.ts:96`, `tree-node-ref.ts:101` | `createNode()` called `propRef.set(value)` on RecordRef (wrong signature) | Use `assignPlainValueToTypedRef()` for container refs |
| `utils.ts` (assignPlainValueToTypedRef) | Counter handler used `.value` (removed API) | Changed to `.get()` |
| `utils.ts` (assignPlainValueToTypedRef) | Didn't handle CounterRef properties in structs | Added counter-specific increment/decrement logic |
| `utils.ts` (assignPlainValueToTypedRef) | Didn't handle nested StructRef/RecordRef | Added recursive `assignPlainValueToTypedRef` calls |
| `utils.ts` (assignPlainValueToTypedRef) | Didn't handle TextRef | Added `.update()` call |
| `utils.ts` (assignPlainValueToTypedRef) | Didn't handle ListRef/MovableListRef in structs | Added recursive assignment |
| `json-patch.ts` (handleMove/handleCopy) | Used live PlainValueRef after mutation | Added `unwrapValue()` to capture raw value BEFORE removal |
| `json-patch.ts` (handleRemove) | Set property to `undefined` instead of deleting | Use `internals.deleteProperty()` for proper deletion |
| `json-patch.ts` (handleAdd/handleReplace) | Confused PlainValueRef.set(value) with RecordRef.set(key, value) | Added `isPlainValueRef()` check to distinguish |
| `list-ref-base.ts` (set) | Tried to replace containers instead of updating them | For container shapes, use `assignPlainValueToTypedRef` on existing ref |

### `createRecordProxy` behavioral change has trade-offs
The change to always return PlainValueRef for any key access (even non-existent keys)
enables `.set()` on new keys, but breaks truthiness checks: `if (record.someKey)` is
now always truthy. This may need refinement — perhaps only create PlainValueRef when
the key already exists in the container.

### Performance implications not measured
Always creating PlainValueRef objects for every nested property access on list items
is more expensive than returning raw primitives. Each access creates an object with
`.get()`, `.set()`, `.valueOf()`, `.toString()`, `.toJSON()` plus symbol properties.
For hot paths with large lists, this could be a significant regression.

## Critical Findings

### PlainValueRef is a LIVE reference, not a snapshot
When you call `list.get(0)`, the returned PlainValueRef reads from the container
at call time. If you delete from the list, indices shift, and `.get()` on the
old PlainValueRef returns the WRONG value. Always capture raw values before
mutating the container.

### Runtime primitive check inconsistency (now fixed)
`createStructProxy` (top-level structs) NEVER had a runtime primitive check —
it always returned PlainValueRef for nested properties. But `createListItemStructProxy`
DID have a primitive check, returning raw primitives for nested properties. After
removing SET traps, this created a dead zone where nested list item primitives had
NO write path. The fix was removing the check from all list item proxies.

### `assignPlainValueToTypedRef` was a hidden dependency
This function in `utils.ts` is called when setting a plain value on a container-valued
record (e.g., `draft.players.set("alice", { name: "Alice", score: 100 })`). It used
`(ref as any)[k] = value[k]` internally, which broke after SET trap removal. It now
splits struct/record paths and uses `.set()` appropriately.

### Generic object proxies (union/any shapes) need special handling
For `Shape.plain.any()` and `Shape.plain.union()`, nested property access goes through
`createGenericObjectProxy` / `createNestedGenericObjectProxy`. These use `SYNTHETIC_ANY_SHAPE`
since there's no schema info. After the fix, primitives get a PlainValueRef base with
`.set()` that writes via `writeValue` (read-modify-write on the parent map key).

## Design Decisions & Rationale

### Why not keep assignment inside `change()` only?

We considered keeping assignment-based mutation inside `change()` for ergonomics:
```typescript
change(doc, draft => { draft.title = "New" })  // Rejected
```

This was rejected because:
- Two different APIs for the same data is confusing
- Documentation burden doubles ("use this here, but that there")
- The `_draft` and `_mutable` type parameters can collapse into one
- Consistency compounds — easier to learn, teach, and maintain

### Why `DeepPlainValueRef` is separate from `PlainValueRef`

Using a conditional type directly in `PlainValueRef<T>` causes TypeScript circular reference errors in the shape system. The shapes reference `PlainValueRef`, and `PlainValueRef` would reference itself recursively via the conditional expansion. By keeping `PlainValueRef` simple and applying expansion at the access point (`SelectByMode` → `Deepen`), we avoid the cycle.

### Why bracket access is removed from types but works at runtime

The list/movableList proxy GET traps are preserved (so `list[0]` returns the same as `list.get(0)` at runtime), but the TypeScript index signature is removed. This means `list[0]` is a type error, guiding users to the canonical `.get(0)`. The runtime proxy is kept as a safety net but is not the intended API.