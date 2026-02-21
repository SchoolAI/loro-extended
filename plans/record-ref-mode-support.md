# Plan: Add Mode Support to RecordRef

## Background

The RefMode type separation (commit `ouulnkxo`) introduced `"mutable"` and `"draft"` modes to distinguish between:
- **Outside `change()`**: Value shape properties return `PlainValueRef<T>` for reactive subscriptions
- **Inside `change()`**: Value shape properties return plain `T` for ergonomic mutation

This was implemented for `StructRef`, `ListRef`, `MovableListRef`, and `IndexedRecordRef` (type alias). However, the underlying `RecordRef` class doesn't have a Mode parameter, causing type errors when using `RecordRef.get()` inside `change()` callbacks.

## Problem Statement

The `rps-demo` example fails type verification with errors like:

```
src/client/use-rps-game.ts(63,11): error TS2322: Type 'string' is not assignable to type 'PlainValueRef<Choice | null>'.
```

This occurs because:
1. `RecordRef.get()` always returns `InferMutableType<NestedShape>`
2. Inside `change()`, the draft should return `InferDraftType<NestedShape>` (plain values for value shapes)
3. When assigning `player.choice = "rock"`, TypeScript thinks `choice` is `PlainValueRef<Choice>` instead of `Choice`

The same issue affects `RecordRef.values()` and `RecordRef.entries()`.

## Success Criteria

1. ✅ `example-rps-demo` passes type verification
2. ✅ `RecordRef.get()` returns `Mode extends "mutable" ? NestedShape["_mutable"] : NestedShape["_draft"]`
3. ✅ `RecordRef.values()` and `RecordRef.entries()` respect Mode
4. ✅ All existing tests pass (899 change, 58 lens, 725 repo)
5. ✅ No runtime behavioral changes

## The Gap

| Current State | Target State |
|---------------|--------------|
| `RecordRef<NestedShape>` (no Mode) | `RecordRef<NestedShape, Mode>` |
| `get()` returns `InferMutableType<NestedShape>` | `get()` returns Mode-dependent type |
| `values()` returns `InferMutableType<NestedShape>[]` | `values()` returns Mode-dependent type |
| `entries()` returns `[string, InferMutableType<NestedShape>][]` | `entries()` returns Mode-dependent type |
| `IndexedRecordRef` extends `RecordRef<NestedShape>` | `IndexedRecordRef` extends `RecordRef<NestedShape, Mode>` |

## Phases and Tasks

### Phase 0: Repurpose Existing `SelectByMode` Helper ✅

The `Mode extends "mutable" ? X["_mutable"] : X["_draft"]` pattern is duplicated in `ListRefBase`, `StructRef`, and `IndexedRecordRef`. A helper `SelectByMode` already exists in `shape.ts` but is **unused** and has a verbose signature. Repurpose it with a more ergonomic signature.

**Discovery**: `SelectByMode<Mutable, Draft, Mode>` exists in `shape.ts` but requires passing both types explicitly. It's never used anywhere in the codebase.

- ✅ **Task 0.1**: Update `SelectByMode` in `shape.ts` to use ergonomic signature `SelectByMode<Shape, Mode>`
- ✅ **Task 0.2**: Update `ListRefBase` to use `SelectByMode` instead of inline conditional
- ✅ **Task 0.3**: Update `StructRef` type to use `SelectByMode`
- ✅ **Task 0.4**: Update `IndexedRecordRef` type to use `SelectByMode`
- ✅ **Task 0.5**: Verify all existing tests still pass after helper adoption

### Phase 1: Update RecordRef Class ✅

- ✅ **Task 1.1**: Add `Mode extends RefMode = "mutable"` type parameter to `RecordRef` class
- ✅ **Task 1.2**: Update `get()` return type to use `SelectByMode<NestedShape, Mode>`
- ✅ **Task 1.3**: Update `values()` return type to use `SelectByMode<NestedShape, Mode>[]`
- ✅ **Task 1.4**: Update `entries()` return type to use `[string, SelectByMode<NestedShape, Mode>][]`

### Phase 2: Update IndexedRecordRef Type ✅

- ✅ **Task 2.1**: Update `IndexedRecordRef` to extend `RecordRef<NestedShape, Mode>`
- ✅ **Task 2.2**: Verify index signature still works correctly with Mode (already uses `SelectByMode` from Phase 0)

### Phase 3: Verify and Test ✅

- ✅ **Task 3.1**: Run `example-rps-demo` verification (19 files formatted, types pass, 22/22 tests)
- ✅ **Task 3.2**: Run full `@loro-extended/change` test suite (899/899 tests)
- ✅ **Task 3.3**: Run dependent package tests (lens 58/58, repo 725/725)

**Note**: Phases 3 and 4 from the original plan (RecordRefInternals and Proxy Handler) were not needed because this is a type-only fix. The runtime already correctly uses `getBatchedMutation()` to return appropriate values.

### Discovery: Cross-Module Conditional Type Alias Issue

During Phase 3, we discovered that `Draft<GameDocShape>` resolves differently when accessed through an **imported type alias** vs defined inline. Specifically:

- ✅ `type LocalFn = (draft: Draft<GameDocShape>) => void` — works in the same file
- ❌ `import type { GameChangeFn } from "./schema.js"` — resolves `Draft` to mutable mode

This is a TypeScript limitation with conditional type (`infer D`) resolution across module boundaries through type aliases. The fix for `example-rps-demo` was to define the `(draft: Draft<GameDocShape>) => void` type inline at each usage site rather than importing a shared alias.

## Key Type Signatures

```typescript
// EXISTING (unused, verbose) in shape.ts
export type SelectByMode<Mutable, Draft, Mode extends RefMode> = 
  Mode extends "mutable" ? Mutable : Draft

// UPDATED (ergonomic) in shape.ts - repurposed existing helper
export type SelectByMode<
  Shape extends ContainerOrValueShape,
  Mode extends RefMode
> = Mode extends "mutable" ? Shape["_mutable"] : Shape["_draft"]

// Current (broken)
export class RecordRef<NestedShape extends ContainerOrValueShape> {
  get(key: string): InferMutableType<NestedShape> | undefined
  values(): InferMutableType<NestedShape>[]
  entries(): [string, InferMutableType<NestedShape>][]
}

// Target (fixed) - uses repurposed SelectByMode helper
export class RecordRef<
  NestedShape extends ContainerOrValueShape,
  Mode extends RefMode = "mutable",
> {
  get(key: string): SelectByMode<NestedShape, Mode> | undefined
  values(): SelectByMode<NestedShape, Mode>[]
  entries(): [string, SelectByMode<NestedShape, Mode>][]
}

// IndexedRecordRef (updated to propagate Mode, uses SelectByMode)
export type IndexedRecordRef<
  NestedShape extends ContainerOrValueShape,
  Mode extends RefMode = "mutable",
> = RecordRef<NestedShape, Mode> & {
  [key: string]: SelectByMode<NestedShape, Mode> | Infer<NestedShape> | undefined
}

// ListRefBase (updated to use SelectByMode)
export abstract class ListRefBase<
  NestedShape extends ContainerOrValueShape,
  Mode extends RefMode = "mutable",
  Item = NestedShape["_plain"],
  MutableItem = SelectByMode<NestedShape, Mode>,  // Was inline conditional
> extends TypedRef<any> { ... }

// StructRef (updated to use SelectByMode)
export type StructRef<
  NestedShapes extends Record<string, ContainerOrValueShape>,
  Mode extends RefMode = "mutable",
> = {
  [K in keyof NestedShapes]: SelectByMode<NestedShapes[K], Mode>  // Was inline conditional
} & { ... }
```

## Transitive Effect Analysis

### Direct Dependencies

| File | Change | Impact |
|------|--------|--------|
| `shape.ts` | Update `SelectByMode` signature | Repurpose unused helper, no breaking changes |
| `record-ref.ts` | Add Mode parameter, use helper | Must update all usages |
| `list-ref-base.ts` | Use `SelectByMode` helper | Refactor only, no behavior change |
| `struct-ref.ts` | Use `SelectByMode` helper | Refactor only, no behavior change |

**Not needed** (runtime already correct):
- `record-ref-internals.ts` - No changes needed, `getBatchedMutation()` already works
- `proxy-handlers.ts` - No changes needed, proxies delegate to internals

### Transitive Dependencies

1. **`@loro-extended/change` tests**: May need type annotation updates if they use `RecordRef` directly
2. **`example-rps-demo`**: The primary consumer that exposed this gap - should work after fix
3. **Other examples using records**: Need verification

### Risk Assessment

**Low Risk**: This is purely a type-level fix:
- Runtime behavior is already correct (refs behave correctly in draft mode)
- Extracting `InferByMode` helper reduces duplication, doesn't add new logic
- Existing tests should catch any type regressions

## Resources for Implementation

### Files to Modify (in order)

1. `packages/change/src/shape.ts` - Update `SelectByMode` to ergonomic signature
2. `packages/change/src/typed-refs/list-ref-base.ts` - Use `SelectByMode` (refactor)
3. `packages/change/src/typed-refs/struct-ref.ts` - Use `SelectByMode` (refactor)
4. `packages/change/src/typed-refs/record-ref.ts` - Add Mode, use `SelectByMode`

### Reference Files

- `packages/change/src/shape.ts` - `SelectByMode` helper and `RecordContainerShape` definition

## Unit and Integration Tests

### Existing Tests

The `example-rps-demo` serves as the integration test. Its type verification will confirm the fix works.

### Type-Level Tests

Add to `types.test.ts`:

```typescript
describe("SelectByMode type helper", () => {
  it("returns _mutable for mutable mode", () => {
    type Result = SelectByMode<StringValueShape<string>, "mutable">
    // Result should be PlainValueRef<string>
    type Test = Assert<Equal<Result, PlainValueRef<string>>>
  })
  
  it("returns _draft for draft mode", () => {
    type Result = SelectByMode<StringValueShape<string>, "draft">
    // Result should be string
    type Test = Assert<Equal<Result, string>>
  })
})

describe("RecordRef with Mode", () => {
  it("returns draft types inside change()", () => {
    const schema = Shape.doc({
      players: Shape.record(Shape.struct({
        score: Shape.plain.number(),
      })),
    })
    
    type DocType = typeof schema
    type DraftPlayers = Draft<DocType>["players"]
    
    // DraftPlayers.get() should return StructRef<..., "draft"> | undefined
    // where score property is `number`, not `PlainValueRef<number>`
  })
})
```

## Changeset

```markdown
---
"@loro-extended/change": patch
---

Add Mode support to RecordRef

`RecordRef.get()`, `.values()`, and `.entries()` now return the correct type based on Mode:
- Outside `change()`: Returns `PlainValueRef<T>` for value shape properties
- Inside `change()`: Returns plain `T` for ergonomic mutation

This fixes type errors when mutating record entries inside `change()` callbacks.
```

## Documentation Updates

### TECHNICAL.md

No changes needed - the Mode system is already documented. This just extends it to `RecordRef`.