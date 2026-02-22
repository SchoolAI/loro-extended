# Plan: Consolidate `unwrap` into `value` Function

## Status: 🟢 Complete

## Purpose: API Consolidation and Clarity

This plan consolidates `unwrap()` into `value()`, simplifying the API surface to one function per context.

**Key insight**: `value()` should become **polymorphic** — absorbing `unwrap()`'s pass-through behavior. This means `value(x)` is a projection from the reactive world to the plain world: if `x` is already plain, it's a no-op. This resolves the type overload gap that blocked Phase 3.

**The result**:

| Context | Function | Meaning |
|---------|----------|---------|
| Non-React | `value(x)` | "Get the plain value" (tolerant — accepts anything) |
| React | `useValue(ref)` | "Subscribe to the plain value" (strict — refs/docs + nullish only) |

## Background

The `@loro-extended/change` package exports two functions for extracting plain values from reactive wrappers:

1. **`value(ref)`** - Strict function that accepts `PlainValueRef<T>`, `TypedRef`, or `TypedDoc` and throws if given anything else
2. **`unwrap(v)`** - Permissive function that returns raw values unchanged if not a `PlainValueRef`

The original plan attempted to add nullish overloads to the strict `value()` and then mechanically replace `unwrap(` → `value(`. This failed because:

- `value()` type overloads for `TypedRef<S> | undefined` don't match concrete subclasses like `StructRef<S, M>` (TypeScript overload resolution doesn't propagate through class hierarchies with extra generics)
- `unwrap()` works everywhere because its signature is `<T>(v: T)` — it accepts any type
- Many call sites pass values that are *sometimes* a PlainValueRef and *sometimes* a raw primitive (e.g., inside vs outside `change()`)

**The fix**: Make `value()` polymorphic like `unwrap()`, but also handle TypedRef/TypedDoc via `toJSON()`. The migration becomes a trivial `s/unwrap(/value(/g` with no call-site restructuring.

## Problem Statement

Having both `value()` and `unwrap()` creates API confusion:
- Users must learn two functions with subtle differences
- The "polymorphic" use case of `unwrap()` (accepting raw values) is needed in practice but lives under a confusing name
- `unwrap()` calls in `useLens()` patterns are misleading no-ops (the values are already plain)

**Important clarification about `useLens()` patterns**:
```typescript
// useLens() returns { lens, doc: worldview }
// where worldview = lens.worldview.toJSON() — already a PLAIN JSON object
const { lens, doc: worldview } = useLens(doc, options)

// These unwrap() calls are NO-OPS because worldview.game.players[id]?.choice
// is already a plain value, not a PlainValueRef
const myChoice = unwrap(myPlayer?.choice)  // Does nothing — value passes through
```

The `useLens()` hook handles reactivity via its own `useSyncExternalStore`. Using `useValue()` inside a `useLens()` component would create **duplicate subscriptions** and is incorrect.

## Success Criteria

1. `value()` is polymorphic — accepts any input, passes through non-ref values
2. `value()` handles nullish inputs (`undefined`, `null`) via pass-through
3. `useValue()` accepts nullish inputs (`undefined`, `null`) with no-op subscriptions
4. All usages of `unwrap()` are replaced with `value()` (mechanical substitution)
5. `useLens()` patterns have `unwrap()` calls replaced with `value()` (still no-ops, but consistent naming)
6. `unwrap` is removed from the public API export (deprecated alias kept temporarily)
7. Tests pass in all affected packages
8. Type inference remains correct for all existing patterns

## The Design

### New `value()` semantics

```typescript
value(plainValueRef)   // → unwraps via valueOf()
value(typedRef)        // → extracts via toJSON()
value(typedDoc)        // → extracts via toJSON()
value(undefined)       // → undefined (pass-through)
value(null)            // → null (pass-through)
value(42)              // → 42 (pass-through, already plain)
value("hello")         // → "hello" (pass-through)
```

### Type overloads

```typescript
// Specific overloads (checked first, provide precise return types)
export function value<T>(ref: PlainValueRef<T>): T
export function value<S extends ContainerShape>(ref: TypedRef<S>): Infer<S>
export function value<D extends DocShape>(doc: TypedDoc<D>): Infer<D>
export function value(ref: undefined): undefined
export function value(ref: null): null
export function value<T>(ref: PlainValueRef<T> | undefined): T | undefined
export function value<T>(ref: PlainValueRef<T> | null): T | null

// Catch-all (checked last, handles raw values and complex unions)
export function value<T>(v: T): T
```

The catch-all `value<T>(v: T): T` is the key insight. It matches `StructRef | undefined`, `number | PlainValueRef<number>`, and any other complex union that the specific overloads miss. For refs, the runtime dispatches correctly even though the return type is `T` (less precise but correct at runtime).

### Implementation

```typescript
export function value(target: unknown): unknown {
  // Nullish: pass through
  if (target === undefined) return undefined
  if (target === null) return null

  // PlainValueRef: call valueOf()
  if (isPlainValueRef(target)) {
    return target.valueOf()
  }

  // TypedRef and TypedDoc: call toJSON() (check for loro symbol to avoid matching Date, etc.)
  if (target && typeof target === "object") {
    const loroSymbol = Symbol.for("loro-extended:loro")
    const extSymbol = Symbol.for("loro-extended:ext")
    if (
      (loroSymbol in (target as object) || extSymbol in (target as object)) &&
      "toJSON" in target
    ) {
      return (target as { toJSON(): unknown }).toJSON()
    }
  }

  // Everything else: pass through (already plain)
  return target
}
```

Note: The loro symbol check (`LORO_SYMBOL` / `EXT_SYMBOL`) ensures we don't accidentally call `toJSON()` on arbitrary objects like `Date`. Only loro-extended refs and docs get the `toJSON()` treatment.

### `unwrap` becomes a deprecated alias

```typescript
/** @deprecated Use `value()` instead. */
export const unwrap = value
```

---

## Commit Strategy

### Squash existing commits, then deliver as one PR

The current commit stack has three changes from the old approach:

1. `nkxvtltk` — Added nullish overloads to strict `value()` (will be superseded)
2. `nnvvpxkm` — Added nullish support to `useValue()` hook (still valid)
3. `ywysxtym` — Partial Phase 3 attempt (detritus, should be dropped)

**Action**: Squash all three into a single new commit that:
- Makes `value()` polymorphic (absorbing `unwrap()` behavior + nullish support)
- Keeps the `useValue()` nullish support from commit 2
- Migrates all `unwrap()` → `value()` across the codebase
- Deprecates `unwrap` as an alias

This produces one clean PR with the commit message:

```
feat(change): consolidate unwrap() into polymorphic value()

Make value() polymorphic — it now accepts any input and extracts
the plain value from reactive wrappers (PlainValueRef, TypedRef,
TypedDoc), passes through nullish and raw values unchanged.

- Replace strict value() with polymorphic version (catch-all overload)
- Add loro symbol check for toJSON dispatch (avoids matching Date, etc.)
- Deprecate unwrap as alias: `export const unwrap = value`
- Migrate all unwrap() → value() across codebase (~25 files)
- Add nullish support to useValue() hook (no-op subscriptions)
- Update documentation and tests
```

### How to squash with jj

```bash
# Squash commits 1 and 3 into commit 2, then edit the result
jj squash --from ywysxtym --into nkxvtltk   # merge detritus into phase 1
jj squash --from nkxvtltk --into nnvvpxkm   # merge phase 1 into phase 2
jj edit nnvvpxkm                              # edit the combined commit
# Then implement the polymorphic value() and bulk migration on top
```

Alternatively, start fresh:
```bash
jj new nkxvtltk~1    # new empty change based on parent of phase 1
# Implement everything from scratch in one commit
```

---

## Implementation Phases (all within one PR)

### Step 1: Make `value()` Polymorphic 🟢

Replace the strict `value()` implementation with the polymorphic version.

**Tasks**:
- 🟢 Replace `value()` implementation: remove throw, add pass-through
- 🟢 Add catch-all `value<T>(v: T): T` overload after specific overloads
- 🟢 Use loro symbol checks for toJSON dispatch (not bare `"toJSON" in target`)
- 🟢 Make `unwrap` a deprecated alias: `export const unwrap = value`
- 🟢 Update tests: restore "returns non-PlainValueRef values as-is" test

**Key Design Decision: Loro Symbol Check**

The old strict `value()` used a bare `"toJSON" in target` check, which would match `Date`, custom classes, etc. The new polymorphic version MUST narrow this to loro objects only:

```typescript
// ❌ Too broad (old strict value)
if (target && typeof target === "object" && "toJSON" in target) { ... }

// ✅ Narrow to loro objects (new polymorphic value)
const loroSymbol = Symbol.for("loro-extended:loro")
const extSymbol = Symbol.for("loro-extended:ext")
if ((loroSymbol in target || extSymbol in target) && "toJSON" in target) { ... }
```

**Files to Update**:
- `packages/change/src/value.ts` — Replace implementation, add catch-all overload
- `packages/change/src/typed-refs/plainvalueref-unification.test.ts` — Restore pass-through test

**Test Changes**:

```typescript
describe("value() export", () => {
  it("unwraps PlainValueRef to raw value", () => { /* existing */ })

  it("returns non-ref values as-is (polymorphic pass-through)", () => {
    expect(value(42)).toBe(42)
    expect(value("hello")).toBe("hello")
    expect(value({ a: 1 })).toEqual({ a: 1 })
    expect(value(undefined)).toBeUndefined()
    expect(value(null)).toBeNull()
  })
})
```

### Step 2: `useValue()` Nullish Support 🟢

**Status**: Already implemented. Kept from prior work. `useValue()` stays strict (refs/docs + nullish only). It does NOT become polymorphic like `value()`.

**Why `useValue()` stays strict**: It's a React hook that creates CRDT subscriptions. Passing raw values would be meaningless — nothing to subscribe to. The nullish case handles `record.get("key")` returning undefined.

**Files (already updated)**:
- `packages/hooks-core/src/create-ref-hooks.ts` ✅
- `packages/hooks-core/src/create-ref-hooks.test.tsx` ✅
- `packages/react/src/hooks-core.ts` ✅
- `packages/hono/src/hooks-core.ts` ✅

### Step 3: Migrate All `unwrap` → `value` 🟢

Mechanical find-and-replace, now unblocked by the catch-all overload.

**Tasks**:
- 🟢 `s/unwrap(/value(/g` across all non-internal files
- 🟢 Update imports: replace `unwrap` with `value` (or add `value` if not already imported)
- 🟢 Remove unused `unwrap` imports
- 🟢 Run full verification

**Files Requiring Updates**:

**Examples:**
- `examples/rps-demo/src/server/reactors.ts`
- `examples/rps-demo/src/client/use-rps-game.ts`
- `examples/rps-demo/src/shared/filters.integration.test.ts`

**Package: @loro-extended/change (Test Files):**
- `src/diff-overlay.test.ts`
- `src/ext.test.ts`
- `src/fork-at.test.ts`
- `src/functional-helpers.test.ts`
- `src/loro.test.ts`
- `src/mergeable-flattened.test.ts`
- `src/nested-container-materialization.test.ts`
- `src/readonly.test.ts`
- `src/shallow-fork.test.ts`
- `src/types.test.ts`
- `src/typed-refs/encapsulation.test.ts`
- `src/typed-refs/json-compatibility.test.ts`
- `src/typed-refs/list-ref-value-updates.test.ts`
- `src/typed-refs/plainvalueref-unification.test.ts`
- `src/typed-refs/record-ref-value-updates.test.ts`
- `src/typed-refs/record-ref.test.ts`
- `src/typed-refs/struct-ref.test.ts`
- `src/typed-refs/tree-node-ref.test.ts`

**Package: @loro-extended/lens:**
- `src/lens.test.ts`
- `src/peerid-edge-cases.test.ts`

**Package: @loro-extended/repo:**
- `src/tests/fork-and-merge-sync.test.ts`

**Internal Functions (Do Not Rename)**:
- `unwrapForSet()` in `src/plain-value-ref/factory.ts` — internal proxy helper
- `unwrapPlainValueRef()` in `src/typed-refs/plain-value-access.ts` — internal assignment helper
- `unwrapReadonlyPrimitive()` in `src/typed-refs/utils.ts` — internal readonly helper

### Step 4: Deprecate `unwrap`, Update Docs 🟡

**Tasks**:
- 🟢 Ensure `unwrap` is exported as deprecated alias with `@deprecated` JSDoc
- 🔴 Update `TECHNICAL.md` line 139 — replace `Use value() or unwrap()` with `Use value()`
- 🟢 Update module JSDoc in `packages/change/src/value.ts`
- 🔴 Create changesets for affected packages

**Reactivity Documentation to Add**:

```markdown
## Choosing Between value(), useValue(), and useLens()

| Context | Function | Why |
|---------|----------|-----|
| Non-React | `value(x)` | Extract plain value from any ref type (or pass through) |
| React with Lens | `useLens()` | Already reactive — no need for useValue() on worldview |
| React with direct ref | `useValue(ref)` | Subscribe to individual ref changes |

**Common mistake**: Using `useValue()` inside a `useLens()` component creates
duplicate subscriptions. The `doc` returned by `useLens()` is already a reactive snapshot.
```

---

## Acceptance Criteria (for the single PR)

- `value(42)` returns `42` (pass-through)
- `value(plainValueRef)` returns unwrapped value
- `value(typedRef)` returns toJSON() (via loro symbol check)
- `value(undefined)` returns undefined
- `value(null)` returns null
- `useValue(undefined)` returns undefined (no-op subscription)
- `useValue(ref)` returns reactive value (existing behavior preserved)
- `unwrap` still exported as deprecated alias
- No remaining `unwrap(` calls in non-internal code
- All test suites pass across all packages
- No functional behavior changes

---

---

## Lessons Learned

### Why the Original Approach Failed

The original plan tried to keep `value()` strict and add nullish overloads. This failed because:

1. **TypeScript overload resolution**: `TypedRef<S> | undefined` overloads don't match `StructRef<S, M> | undefined` — TypeScript doesn't propagate through class hierarchies with extra generic params
2. **False assumption**: The plan assumed `unwrap()` was only used for nullish handling. In reality, many call sites pass values that are sometimes refs and sometimes plain primitives (depending on `change()` context)
3. **Unnecessary restructuring**: The migration attempted to change `unwrap(x?.prop)` to `value(x)?.prop`, which changed the semantics. The correct approach is `value(x?.prop)` — same structure, just rename the function

### The Polymorphic Insight

Making `value()` polymorphic (like `unwrap()` was) resolves all three issues:
- The catch-all overload matches any type — no overload resolution problems
- Pass-through behavior handles primitive/ref unions naturally
- Migration is a mechanical find-and-replace with no restructuring

### `useValue()` Correctly Remains Strict

`useValue()` is a React hook that creates subscriptions. Accepting raw values would be meaningless (nothing to subscribe to). The nullish support handles `record.get("key")` returning undefined — a legitimate optional chaining pattern.

### One PR Is Better Than Five

The original plan proposed a 5-PR stack. Three iterations of learning revealed that the changes are tightly coupled — making `value()` polymorphic, migrating call sites, and deprecating `unwrap` are all part of one atomic idea. Splitting them only created intermediate states (strict value with nullish overloads) that were wrong and had to be undone.

---

## Summary

**One function per context**:
- `value(x)` — "get the plain value" (polymorphic, tolerant)
- `useValue(ref)` — "subscribe to the plain value" (strict, reactive)

**The migration is mechanical**: `s/unwrap(/value(/g` — no restructuring, no type issues, no behavior changes.

**Delivered as one PR**: Squash existing commits, implement the polymorphic `value()`, migrate all call sites, deprecate `unwrap`. One atomic change, one review.