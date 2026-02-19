# Plan: Consolidate `unwrap` into `value` Function

## Status: 🔴 Not Started

## Background

The `@loro-extended/change` package exports two functions for extracting plain values from reactive wrappers:

1. **`value(ref)`** - Strict function that accepts `PlainValueRef<T>`, `TypedRef`, or `TypedDoc` and throws if given anything else
2. **`unwrap(v)`** - Permissive function that returns raw values unchanged if not a `PlainValueRef`

The `value()` function was designed as a symmetric parallel to the `useValue()` React hook:

| Non-reactive | Reactive |
|--------------|----------|
| `value(ref)` | `useValue(ref)` |

Both accept the same types and return plain values. However, `unwrap()` was created as a workaround for optional chaining patterns where `value()` would throw:

```typescript
// This pattern requires unwrap() because value() throws on undefined
const choice = unwrap(players.get("alice")?.choice) ?? null

// With nullish support in value(), this becomes:
const choice = value(players.get("alice")?.choice) ?? null
```

## Problem Statement

Having both `value()` and `unwrap()` creates API confusion:
- Users must learn two functions with subtle differences
- The "polymorphic" use case of `unwrap()` (accepting raw values) is not actually used in practice
- All real usages of `unwrap()` are handling `T | undefined` from optional chaining

## Success Criteria

1. `value()` accepts nullish inputs (`undefined`, `null`) and returns them unchanged
2. All usages of `unwrap()` are replaced with `value()`
3. `unwrap` is removed from the public API export
4. Tests pass
5. Type inference remains correct for all existing patterns

## The Gap

Currently `value()` throws on non-ref inputs:

```typescript
// Current implementation
export function value(target) {
  if (isPlainValueRef(target)) return target.valueOf()
  if (target && typeof target === "object" && "toJSON" in target) return target.toJSON()
  throw new Error("value() requires a PlainValueRef, TypedRef, or TypedDoc...")
}
```

Need to add nullish handling before the throw.

---

## Phase 1: Extend `value()` to Handle Nullish Inputs 🔴

### Tasks

- 🔴 Add overload signatures for `value()` accepting `T | undefined` and `T | null`
- 🔴 Update implementation to return nullish values unchanged (before the throw)
- 🔴 Add unit tests for `value(undefined)` and `value(null)` returning unchanged
- 🔴 Add unit tests for `value(ref | undefined)` pattern with optional chaining

### Type Signatures to Add

```typescript
// New overloads (add before existing overloads for proper resolution)
export function value<T>(ref: PlainValueRef<T> | undefined): T | undefined
export function value<T>(ref: PlainValueRef<T> | null): T | null
export function value<T>(ref: PlainValueRef<T> | null | undefined): T | null | undefined
```

---

## Phase 2: Replace All `unwrap` Usages with `value` 🔴

### Tasks

- 🔴 Update import statements: replace `unwrap` with `value` in imports
- 🔴 Replace all `unwrap(...)` calls with `value(...)`
- 🔴 Run verification to ensure no regressions

### Files Requiring Updates

**Examples:**
- `examples/rps-demo/src/server/reactors.ts` (import + 2 usages)
- `examples/rps-demo/src/shared/filters.integration.test.ts` (import + 10 usages)

**Package: @loro-extended/change:**
- `src/diff-overlay.test.ts` (import + 4 usages)
- `src/ext.test.ts` (import + 2 usages)
- `src/fork-at.test.ts` (import + 3 usages)
- `src/functional-helpers.test.ts` (import + 2 usages)
- `src/loro.test.ts` (import + 2 usages)
- `src/mergeable-flattened.test.ts` (import + 18 usages)
- `src/nested-container-materialization.test.ts` (import + 6 usages)
- `src/plain-value-ref/plain-value-ref.test.ts` (docstring mentions "unwraps")
- `src/readonly.test.ts` (import + 2 usages)
- `src/shallow-fork.test.ts` (import + 8 usages)
- `src/types.test.ts` (import + 1 usage)
- `src/types.ts` (docstring mentions unwrap)
- `src/typed-refs/encapsulation.test.ts` (import + 3 usages)
- `src/typed-refs/json-compatibility.test.ts` (import + 3 usages)
- `src/typed-refs/list-ref-value-updates.test.ts` (import + 18 usages)
- `src/typed-refs/plainvalueref-unification.test.ts` (import + 5 usages, update test block)
- `src/typed-refs/record-ref-value-updates.test.ts` (import + 14 usages)
- `src/typed-refs/record-ref.test.ts` (import + 8 usages)
- `src/typed-refs/struct-ref.test.ts` (import + 14 usages)
- `src/typed-refs/tree-node-ref.test.ts` (import + 14 usages)

**Package: @loro-extended/lens:**
- `src/lens.test.ts` (import + 1 usage)
- `src/peerid-edge-cases.test.ts` (import + 4 usages)

**Package: @loro-extended/repo:**
- `src/tests/fork-and-merge-sync.test.ts` (import + 9 usages)

### Internal Functions (Do Not Rename)

These internal helpers have `unwrap` in their names but serve different purposes:

- `unwrapForSet()` in `src/plain-value-ref/factory.ts` - internal proxy helper
- `unwrapPlainValueRef()` in `src/typed-refs/plain-value-access.ts` - internal assignment helper
- `unwrapReadonlyPrimitive()` in `src/typed-refs/utils.ts` - internal readonly helper

These are not part of the public API and should retain their names.

---

## Phase 3: Remove `unwrap` from Public API 🔴

### Tasks

- 🔴 Remove `unwrap` export from `src/value.ts`
- 🔴 Remove `unwrap` from `src/index.ts` exports
- 🔴 Update module JSDoc in `src/value.ts` to remove `unwrap` mention
- 🔴 Update `describe("unwrap export", ...)` in `plainvalueref-unification.test.ts`:
  - Rename to `describe("value() nullish handling", ...)`
  - Keep first test (rename to use `value()`)
  - Replace second test (`returns non-PlainValueRef values as-is`) with nullish tests

---

## Phase 4: Documentation Updates 🔴

### Tasks

- 🔴 Update `TECHNICAL.md` - remove references to `unwrap()` as a user-facing function
- 🔴 Create changeset documenting the API change

---

## Tests

### Test Updates in Phase 3

The existing `describe("unwrap export", ...)` block in `plainvalueref-unification.test.ts` (lines 416-444) should be transformed:

**Current tests:**
1. `it("unwraps PlainValueRef to raw value", ...)` - rename to use `value()`
2. `it("returns non-PlainValueRef values as-is", ...)` - **remove** (tests polymorphic behavior we're eliminating)

**Replace with:**
```typescript
describe("value() nullish handling", () => {
  it("extracts PlainValueRef to raw value", () => {
    // Keep existing test, replace unwrap → value
  })

  it("returns undefined unchanged", () => {
    expect(value(undefined)).toBeUndefined()
  })

  it("returns null unchanged", () => {
    expect(value(null)).toBeNull()
  })

  it("handles PlainValueRef | undefined from optional chaining", () => {
    const schema = Shape.doc({
      players: Shape.record(Shape.struct({
        choice: Shape.plain.string().nullable()
      }))
    })
    const doc = createTypedDoc(schema)
    
    // Non-existent key returns undefined
    expect(value(doc.players.get("alice")?.choice)).toBeUndefined()
    
    // After setting, returns the value
    change(doc, d => { d.players.alice = { choice: "rock" } })
    expect(value(doc.players.get("alice")?.choice)).toBe("rock")
  })
})
```

### Existing Test Validation

All existing tests using `unwrap()` will be updated to use `value()`. Running `pnpm turbo run verify` validates no regressions.

---

## Transitive Effect Analysis

### Direct Dependencies

| Module | Impact |
|--------|--------|
| `@loro-extended/change` | Source of change - update exports |
| `@loro-extended/lens` | Test files import `unwrap` |
| `@loro-extended/repo` | Test files import `unwrap` |
| `examples/rps-demo` | Production code imports `unwrap` |

### Downstream Effects

- **No runtime breaking changes**: `value()` gains functionality, doesn't lose any
- **Import changes only**: All changes are import statement updates and call site renames
- **Type compatibility**: The new overloads are additive; existing code continues to type-check

### Risk Assessment

- **Low risk**: This is a mechanical find-and-replace with added functionality
- **TypeScript validates**: If any usage relies on `unwrap()` accepting arbitrary non-ref values (not just nullish), TypeScript will catch it
- **Test coverage**: Existing tests exercise all the patterns that need updating

---

## Resources for Implementation

### Files to Read

- `packages/change/src/value.ts` - Implementation to modify
- `packages/change/src/index.ts` - Export to update
- `TECHNICAL.md` lines 124-174 - Value shape handling context

### Commands

```bash
# Verify all packages after changes
pnpm turbo run verify

# Verify specific package
pnpm turbo run verify --filter=@loro-extended/change

# Run specific test file
pnpm turbo run verify --filter=@loro-extended/change -- logic -- -t 'value()'
```

---

## Changeset

Create `.changeset/consolidate-value-unwrap.md`:

```markdown
---
"@loro-extended/change": minor
---

Consolidated `unwrap()` into `value()` function.

**Breaking Change:** The `unwrap()` export has been removed. Use `value()` instead.

`value()` now accepts nullish inputs (`undefined`, `null`) and returns them unchanged,
enabling patterns like:

```typescript
// Before
const choice = unwrap(players.get("alice")?.choice) ?? null

// After
const choice = value(players.get("alice")?.choice) ?? null
```

This aligns `value()` as the symmetric non-reactive counterpart to `useValue()`.
```
