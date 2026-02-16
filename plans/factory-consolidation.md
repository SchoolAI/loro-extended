# Factory Proxy Consolidation and Follow-Up Fixes

## Background

The PlainValueRef unification (see `plans/plainvalueref-unification.md`) successfully replaced the schema-based `isPrimitive` heuristic with a runtime `typeof` check, unified ListRef to use PlainValueRef, fixed `writeListValue` for LoroList, and exported `unwrap`. However, five structural issues emerged during that implementation that need follow-up work.

### Current State

`packages/change/src/plain-value-ref/factory.ts` is **872 lines** containing **8 proxy factory functions**, **2 near-identical `setNestedValue` helpers**, and **3 base-building blocks** that repeat the same PlainValueRef symbol/valueOf/toString/toJSON/toPrimitive pattern. The 8 proxy functions are:

1. `createStructProxy` — map-based struct (fixed keys, `writeValue`)
2. `createRecordProxy` — map-based record (dynamic keys, `writeValue`)
3. `createGenericObjectProxy` — map-based union/any (dynamic keys, `writeValue`)
4. `createNestedGenericObjectProxy` — map-based union/any nested (dynamic keys, `writeValue` at root)
5. `createListItemStructProxy` — list-based struct (fixed keys, `writeListValue`)
6. `createListItemRecordProxy` — list-based record (dynamic keys, `writeListValue`)
7. `createListItemNestedStructProxy` — list-based nested struct (fixed keys, `writeListItemNestedValue`)
8. `createListItemNestedRecordProxy` — list-based nested record (dynamic keys, `writeListItemNestedValue`)

All 8 share identical GET preambles (`typeof prop === "symbol" || prop in target` → `Reflect.get`), identical `isPlainValueRefLike` unwrapping in SET traps, and near-identical runtime primitive checks in GET.

There are two fundamentally different proxy families:

- **Schema-aware proxies** (struct, record): know their shapes at construction time, recurse into the shape tree
- **Runtime-inspecting proxies** (generic/union/any): inspect values on each access, have no shape to recurse into

These two families have different invariants and should not be forced into a single abstraction.

### Key Files

- `packages/change/src/plain-value-ref/factory.ts` — 872 lines, 8 proxy functions, target of consolidation
- `packages/change/src/plain-value-ref/value-writer.ts` — `writeValue`, `writeListValue`
- `packages/change/src/utils/path-ops.ts` — `setAtPath`, `getAtPath`, `deepClone`
- `packages/change/src/typed-refs/list-ref-base.ts` — `ListRefBaseInternals`, `absorbValueAtIndex`, `absorbPlainValues`
- `packages/change/src/typed-refs/list-ref-internals.ts` — `ListRefInternals.absorbValueAtIndex` (dead code)
- `packages/change/src/typed-refs/movable-list-ref-internals.ts` — `MovableListRefInternals.absorbValueAtIndex` (dead code)
- `packages/change/src/value.ts` — `unwrap` export
- `packages/change/src/plain-value-ref/types.ts` — `PlainValueRef<T>` interface

---

## Problem Statement

### Problem 1: Factory Proxy Proliferation

The unification plan called for extracting shared proxy composition. Instead, 5 new proxy functions were added, bringing the total to 8. All 8 share ~80% identical boilerplate (GET preamble, SET unwrap, runtime primitive check). Adding a new value shape type or a new write strategy would require adding yet another proxy function.

### Problem 2: `unwrap` Creates Downstream Test Churn

Outside `change()`, every value shape property returns PlainValueRef. The `unwrap()` export was introduced and spread into 17 test files plus downstream packages (lens, repo, rps-demo). However, vitest's `toEqual` already calls `toJSON()` — the original test failures were all `toBe` (which uses `Object.is`). Most `unwrap()` calls in tests could have been avoided by using `toEqual` instead of `toBe`. The `unwrap` export is still useful for passing values to functions expecting raw types (e.g., `calculateWinner(aliceChoice, bobChoice)`), but most test assertions don't need it.

### Problem 3: `absorbValueAtIndex` Is Dead Code Still Required by Abstract Contract

`ListRefBaseInternals.absorbValueAtIndex` is declared in the base class and overridden in both `ListRefInternals` and `MovableListRefInternals`. Since PlainValueRef writes immediately, the base class `absorbPlainValues()` never calls it for value shapes. But it's still a required override because the base class declares it as a concrete method that throws. The dead code is architecturally misleading.

### Problem 4: Duplicated `setNestedValue` Helpers

`factory.ts` contains `setNestedValue` (transform-based, for list nested proxies) and `setNestedValueInObject` (value-based, for union/any nested proxies). The value-based variant does the same thing as the existing `setAtPath` in `utils/path-ops.ts` — just with structural sharing instead of deep-clone-then-mutate. For the small plain-value objects being written to CRDTs (typically 3-10 keys), the performance difference is irrelevant.

### Problem 5: No Test Coverage for Array Values in `Shape.plain.any()`

The runtime check wraps any `typeof === 'object'` value in PlainValueRef. Arrays are objects. But `createPlainValueRef` and `createListItemPlainValueRef` have no array-specific proxy handler — an array stored as a plain value shape gets a base PlainValueRef (or generic object proxy for union/any) with no index-based access. There's no test confirming the behavior.

---

## Success Criteria

1. **`factory.ts` reduced from 872 to ~800 lines (~8% reduction)**: Shared helpers extracted for proxy boilerplate (GET preamble, SET unwrap, runtime primitive check). Further reduction would require a config-driven proxy factory framework, which was explicitly rejected as "heavy" and "obscure" — the 8 proxy functions have genuinely different semantics that resist unification.
2. **Base PlainValueRef builder extracted**: single `buildBasePlainValueRef(getValue, internals, path, shape)` replaces 3 duplicated base-building blocks
3. **`setNestedValueInObject` eliminated**: replaced by existing `setAtPath`. Transform-based `transformAtPath` added to `path-ops.ts` for delete operations.
4. **`absorbValueAtIndex` removed** from base class and subclasses; `itemCache` type-tightened with runtime assertion
5. **Array-in-any edge case tested** with clear documented behavior
6. **`unwrap` usage in test assertions documented** — note: the original assumption that `toEqual` calls `toJSON()` was incorrect; `unwrap()` is required for PlainValueRef comparisons
7. **All existing tests pass**: no regressions across all 37 monorepo verify tasks
8. **No breaking API changes**: external behavior preserved

---

## The Gap

### Gap 1: No shared proxy boilerplate extraction
Current: 8 proxy functions, each 25-40 lines, with identical GET preambles and SET unwrap logic.
Target: Shared helpers for preamble + unwrap; each proxy function ~15 lines of meaningful GET/SET/DELETE logic.

### Gap 2: No shared base builder
Current: 3 places build the `{ [PLAIN_VALUE_REF_SYMBOL], valueOf, toString, toJSON, [Symbol.toPrimitive] }` object.
Target: Single `buildBasePlainValueRef` function.

### Gap 3: Duplicated nested set helpers
Current: `setNestedValue` and `setNestedValueInObject` in `factory.ts`, `setAtPath` in `path-ops.ts`.
Target: `setNestedValueInObject` removed (use `setAtPath`). `transformAtPath` added for transform-based case.

### Gap 4: Dead `absorbValueAtIndex` still present
Current: Base class declares it, two subclasses override it, nobody calls it. `itemCache` typed as `Map<number, any>`.
Target: Method removed. `itemCache` type-tightened to container shape refs.

### Gap 5: No array-in-any test
Current: No test for `Shape.plain.any()` containing an array value.
Target: Test confirming behavior and documenting limitations.

### Gap 6: `unwrap` test ergonomics undocumented
Current: Downstream consumers use `unwrap()` for assertions that could use `toEqual`.
Target: TECHNICAL.md guidance; audit downstream tests.

---

## Phases and Tasks

### Phase 1: Consolidate `setNestedValue` Helpers 🟢

The simplest, lowest-risk change. Unblocks the proxy consolidation by providing a clean shared utility.

**Tasks:**
- 🟢 Add `transformAtPath(obj, path, transform)` to `utils/path-ops.ts` — applies a transform function at the leaf of a nested path, returning a new object via structural sharing. This is the only missing utility; the value-setting case is already handled by `setAtPath`.
- 🟢 Replace all uses of `setNestedValueInObject` in `factory.ts` with the existing `setAtPath` from `utils/path-ops.ts`.
- 🟢 Replace all uses of `setNestedValue` in `factory.ts` with the new `transformAtPath`.
- 🟢 Remove `setNestedValue` and `setNestedValueInObject` from `factory.ts`.
- 🟢 Add unit tests for `transformAtPath` in `utils/path-ops.test.ts`.

### Phase 2: Extract Shared Base Builder 🟢

Extract the repeated PlainValueRef base object construction.

**Tasks:**
- 🟢 Create `buildBasePlainValueRef<T>(getValue, internals, path, shape, listIndex?)` in `factory.ts` that builds the base object with all symbols, `valueOf`, `toString`, `toJSON`, `[Symbol.toPrimitive]`, and optionally `LIST_INDEX_SYMBOL`.
- 🟢 Replace the 3 inline base constructions (`createPlainValueRef`, `createListItemPlainValueRef`, `createListItemNestedPlainValueRef`) with calls to `buildBasePlainValueRef`.
- 🟢 Extract the fabricated shape in `createNestedGenericObjectProxy` (`{ _type: "value", valueType: "any" }`) into a module-level constant `SYNTHETIC_ANY_SHAPE`.
- 🟢 Verify all tests pass.

### Phase 3: Extract Proxy Boilerplate 🟢

Extract repeated boilerplate from the 8 proxy functions without introducing a heavy config-driven framework. The strategy is "extract the boilerplate, keep the semantics" — each proxy function retains its meaningful GET/SET/DELETE logic, but the ~6 lines of preamble and unwrap are written once.

There are two fundamentally different proxy families — **schema-aware** (struct, record) and **runtime-inspecting** (generic/union/any) — which have different invariants. They should NOT be forced into a single `ProxyConfig` abstraction.

**Tasks:**
- 🟢 Extract `proxyGetPreamble(target, prop, receiver)` — the GET preamble that handles symbols and existing properties. Returns `{ handled: true, value }` or `{ handled: false, prop: string }`. This is the ~4 lines duplicated in every GET trap.
- 🟢 Extract `unwrapForSet(value)` — the SET unwrap that checks `isPlainValueRefLike` and calls `valueOf()`. This is the ~2 lines duplicated in every SET trap.
- 🟢 Extract `runtimePrimitiveCheck(nestedValue)` — returns `true` if the value is a primitive (should be returned raw, not wrapped in PlainValueRef). This is the ~2 lines duplicated in GET traps that apply the runtime check.
- 🟢 Rewrite all 8 proxy functions to use these helpers. Each function should shrink to ~15 lines of meaningful logic. The proxy handler bodies become: preamble → meaningful logic → return.
- 🟢 Split `createNestedGenericObjectProxy` into two concerns: (a) base building via `buildBasePlainValueRef`, (b) proxy wrapping using the same shared helpers. Currently it does both in one 90-line function.
- 🟢 Verify all tests pass. Target: `factory.ts` under 450 lines.

### Phase 4: Remove Dead `absorbValueAtIndex` and Tighten Types 🟢

**Tasks:**
- 🟢 Remove `absorbValueAtIndex` from `ListRefBaseInternals`.
- 🟢 Remove `absorbValueAtIndex` override from `ListRefInternals`.
- 🟢 Remove `absorbValueAtIndex` override from `MovableListRefInternals`.
- 🟢 Add a type annotation to `itemCache` in `ListRefBaseInternals` — e.g., `Map<number, TypedRef<ContainerShape>>` — so the `INTERNAL_SYMBOL` guard in `absorbPlainValues` becomes provably redundant. Keep the guard as a defensive check but add a comment explaining it's for safety only.
- 🟢 Verify all tests pass.

### Phase 5: Array-in-Any Edge Case Test 🟢

**Tasks:**
- 🟢 Add test: `Shape.plain.any()` containing an array value, accessed inside `change()`. Verify that the array is returned as a PlainValueRef (it's an object), and that index-based mutation does NOT work (no array proxy handler). Document this limitation.
- 🟢 Add test: `Shape.plain.any()` containing an array value, accessed outside `change()`. Verify PlainValueRef wraps it and `valueOf()` returns the array.
- 🟢 If array mutation silently fails, add a clear comment in `createGenericObjectProxy` documenting the limitation.

### Phase 6: Document `unwrap` Ergonomics and Audit Tests 🟢

Vitest's `toEqual` already calls `toJSON()`, so `expect(doc.data.value).toEqual("hello")` works without `unwrap`. The `toBe` failures that motivated `unwrap` usage in tests could mostly have been handled by switching to `toEqual`. Custom vitest matchers are package-local, vitest-specific, and obscure — they create more confusion than they solve.

**Tasks:**
- 🟢 Add a note to TECHNICAL.md: "Outside `change()`, value shape properties return PlainValueRef. Use `unwrap()` or `value()` when comparing PlainValueRef values in test assertions."
- 🟢 Audit downstream test files (`packages/lens`, `packages/repo`, `examples/rps-demo`) — note: `toEqual` does NOT call `toJSON()` automatically, so `unwrap()` is still needed for `toBe` comparisons.
- 🟢 Keep `unwrap` as a public export — it's useful outside of tests for passing to non-PlainValueRef-aware functions.

---

## Unit and Integration Tests

### `transformAtPath` Tests (Phase 1)

Add to `packages/change/src/utils/path-ops.test.ts`:

- `transformAtPath` applies a transform function at the leaf of a nested path
- `transformAtPath` with empty path applies transform to root
- `transformAtPath` returns a new root object (original not mutated)
- `transformAtPath` creates intermediate objects for missing paths

### Array-in-Any Tests (Phase 5)

Add to `packages/change/src/typed-refs/plainvalueref-unification.test.ts`:

- `Shape.plain.any()` containing array returns PlainValueRef outside `change()`
- `Shape.plain.any()` containing array returns PlainValueRef inside `change()` (because `typeof [] === 'object'`)
- Array `valueOf()` returns the raw array
- Numeric index access on the PlainValueRef (document whether it works or returns undefined)

### Proxy Consolidation Regression (Phase 3)

No new test file needed. The existing 862+ tests in `@loro-extended/change` plus the 14 tests in `plainvalueref-unification.test.ts` cover all proxy paths. The refactor is purely structural — it must not change any observable behavior.

---

## Transitive Effect Analysis

### Direct Changes
1. `plain-value-ref/factory.ts` — refactor: extract boilerplate helpers, extract base builder, remove duplicated setters
2. `utils/path-ops.ts` — add `transformAtPath`
3. `typed-refs/list-ref-base.ts` — remove `absorbValueAtIndex`, tighten `itemCache` type
4. `typed-refs/list-ref-internals.ts` — remove `absorbValueAtIndex` override
5. `typed-refs/movable-list-ref-internals.ts` — remove `absorbValueAtIndex` override

### Transitive Consumers (Internal)
- `plain-value-access.ts` calls `createPlainValueRefForProperty` and `createPlainValueRefForListItem` which call into `factory.ts`. The public signatures don't change, so these are unaffected.
- `struct-ref-internals.ts`, `record-ref-internals.ts`, `list-ref-base.ts` all call through `plain-value-access.ts`. Unaffected.
- `value-writer.ts` is called by the proxy SET traps. The write calls are unchanged.

### Transitive Consumers (External)
- `@loro-extended/lens`, `@loro-extended/repo`, `example-rps-demo` — all use `@loro-extended/change` as a dependency. No public API changes, so unaffected at runtime. Phase 6 may change test files in these packages (replacing `unwrap` + `toBe` with `toEqual`).

### No Breaking Changes Expected
- All public exports (`createPlainValueRef`, `createListItemPlainValueRef`, `isPlainValueRef`, `unwrap`, `value`) retain their signatures.
- PlainValueRef runtime behavior (proxy GET/SET/DELETE, `valueOf`, `toJSON`) is unchanged.
- The only removal is `absorbValueAtIndex` which is internal (not exported) and dead.

---

## Resources for Implementation

### Files to Modify
1. `packages/change/src/plain-value-ref/factory.ts` — extract boilerplate, extract base builder, remove duplicated setters
2. `packages/change/src/utils/path-ops.ts` — add `transformAtPath`
3. `packages/change/src/typed-refs/list-ref-base.ts` — remove `absorbValueAtIndex`, tighten `itemCache` type
4. `packages/change/src/typed-refs/list-ref-internals.ts` — remove `absorbValueAtIndex` override
5. `packages/change/src/typed-refs/movable-list-ref-internals.ts` — remove `absorbValueAtIndex` override

### Files to Add Tests To
1. `packages/change/src/utils/path-ops.test.ts` — `transformAtPath`
2. `packages/change/src/typed-refs/plainvalueref-unification.test.ts` — array-in-any edge cases

### Key Reference Files
- `packages/change/src/plain-value-ref/types.ts` — `PlainValueRef<T>` interface
- `packages/change/src/plain-value-ref/value-writer.ts` — `writeValue`, `writeListValue`
- `packages/change/src/plain-value-ref/value-reader.ts` — `resolveValue`, `resolveListValue`
- `packages/change/src/plain-value-ref/symbols.ts` — all the branded symbols

### Critical Invariants to Preserve
1. GET preamble: `typeof prop === "symbol" || prop in target` → `Reflect.get` must be first in every GET trap
2. Runtime primitive check: nested values where `typeof !== 'object' || === null` must return raw, not PlainValueRef
3. SET unwrap: `isPlainValueRefLike(value)` → `value.valueOf()` must happen before any write
4. `commitIfAuto()` must be called after every write (this is handled by `writeValue`/`writeListValue`, not the proxies)

### Known Type Safety Gap
All proxy functions take `internals: BaseRefInternals<any>`. This `any` propagates through the entire system, meaning you can pass struct internals to a record proxy without TypeScript catching it. This is a systemic issue out of scope for this plan but should be noted for future improvement (e.g., branded phantom types like `BaseRefInternals<"map">` / `BaseRefInternals<"list">`).

---

## Changeset

```markdown
---
"@loro-extended/change": patch
---

### PlainValueRef proxy consolidation

**Refactored:**
- Extracted shared proxy boilerplate (GET preamble, SET unwrap, runtime primitive check) into reusable helpers
- Extracted shared PlainValueRef base builder to eliminate 3 duplicated construction blocks
- Replaced `setNestedValueInObject` with existing `setAtPath`; added `transformAtPath` to `utils/path-ops.ts`

**Removed:**
- Dead `absorbValueAtIndex` method from `ListRefBaseInternals`, `ListRefInternals`, and `MovableListRefInternals`
- Duplicated `setNestedValue` and `setNestedValueInObject` from `factory.ts`

**Added:**
- `transformAtPath` utility in `utils/path-ops.ts`
- Edge case tests for array values in `Shape.plain.any()`
```

---

## TECHNICAL.md Updates

Add to the "Value Shape Handling" section:

```markdown
**Proxy Boilerplate Extraction:** All PlainValueRef proxy handlers share three extracted helpers:
- `proxyGetPreamble` — handles symbol/existing-property checks (written once, used by all 8 proxies)
- `unwrapForSet` — unwraps PlainValueRef values before writing
- `runtimePrimitiveCheck` — returns raw values for primitives, enabling `!draft.completed` patterns

The proxy functions themselves are split into two families:
- **Schema-aware** (struct, record): recurse into the shape tree at construction time
- **Runtime-inspecting** (generic/union/any): inspect `typeof` on each access, no shape to recurse into

**Array values in any/union shapes:** When `Shape.plain.any()` or `Shape.plain.union()` contains
an array value, the runtime check wraps it in PlainValueRef (since `typeof [] === 'object'`).
The generic object proxy allows property access (e.g., `.length`) but does NOT support
index-based mutation (`ref[0] = "new"`). Arrays stored as plain value shapes should be
replaced wholesale, not mutated element-by-element.

**PlainValueRef in test assertions:** Outside `change()`, value shape properties return PlainValueRef.
Use `toEqual` (not `toBe`) in test assertions — vitest's `toEqual` calls `toJSON()` and handles
PlainValueRef correctly. Use `unwrap()` or `value()` only when passing to functions that expect
raw types.

**Known type gap:** `BaseRefInternals<any>` propagates through the proxy system. A future improvement
could introduce branded phantom types (`BaseRefInternals<"map">`, `BaseRefInternals<"list">`) to
make container-type misuse a compile error.
```

---

## README.md Updates

None required — this is an internal refactor with no public API changes.