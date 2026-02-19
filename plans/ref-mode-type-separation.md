# Plan: Generic Mode Parameter for Ref Type Separation

## Background

The `@loro-extended/change` package introduced `PlainValueRef<T>`, a reactive wrapper for plain values stored in CRDT containers. When accessing value shape properties (e.g., `doc.meta.title` where `title` is `Shape.plain.string()`), the current return type is `PlainValueRef<T> | T`.

This union exists because the same type parameter (`_mutable`) serves two different contexts:
1. **Outside `change()`**: Always returns `PlainValueRef<T>` at runtime
2. **Inside `change()`**: Returns raw `T` for primitives (for ergonomic `if (draft.active)` patterns)

The union causes type errors when using `useValue(doc.meta.title)` because TypeScript cannot resolve the overload for the union type.

### Key Insight from Research

The runtime behavior is already correct:
- `struct-ref-internals.ts:129-133`: Outside `change()`, always returns `PlainValueRef<T>`
- `struct-ref-internals.ts:121-127`: Inside `change()`, primitives return raw `T` via `resolveValueForBatchedMutation()`

The problem is purely at the type level—TypeScript's view doesn't match runtime reality.

## Problem Statement

```typescript
const title = useValue(doc.meta.title) // ERROR: No overload matches
```

TypeScript reports:
```
No overload matches this call.
  Argument of type 'string | PlainValueRef<string>' is not assignable to parameter of type 'CounterRef | StructRef<...> | TextRef | ...'
```

## Success Criteria

1. `doc.meta.title` returns `PlainValueRef<string>` (not a union) for direct access
2. Inside `change()`, `draft.meta.title` returns `string` for primitives
3. `useValue(doc.meta.title)` compiles with a clean `PlainValueRef<T>` overload
4. All existing tests pass
5. Runtime behavior unchanged (this is a type-only refactor)

## The Gap

| Component | Current State | Required Change |
|-----------|---------------|-----------------|
| `Shape` interface | Single `_mutable` type | Add `_draft` type parameter |
| Value shapes | `_mutable = PlainValueRef<T> \| T` | `_mutable = PlainValueRef<T>`, `_draft = T` |
| `StructRef` type | Uses `_mutable` for properties | Generic `Mode` parameter to switch between `_mutable`/`_draft` |
| `ListRef` type | Uses `_mutable` for index access | Generic `Mode` parameter |
| Container shapes | `_mutable = StructRef<N>` | `_mutable = StructRef<N, "mutable">`, `_draft = StructRef<N, "draft">` |
| `change()` callback | Uses `Mutable<Shape>` | Uses `Draft<Shape>` (which uses `_draft`) |
| `useValue()` | No `PlainValueRef` overload | Add overload for `PlainValueRef<T>` |

## Phases and Tasks

### Phase 1: Shape Interface Extension 🔴

- 🔴 **Task 1.1**: Add `_draft` to `Shape` interface in `packages/change/src/shape.ts`
  ```typescript
  interface Shape<Plain, Mutable, Draft = Mutable, Placeholder = Plain> {
    readonly _type: string
    readonly _plain: Plain
    readonly _mutable: Mutable
    readonly _draft: Draft
    readonly _placeholder: Placeholder
  }
  ```

- 🔴 **Task 1.2**: Add `RefMode` type and type helper
  ```typescript
  type RefMode = "mutable" | "draft"
  
  // Helper to select type based on mode
  type SelectByMode<Mutable, Draft, Mode extends RefMode> = 
    Mode extends "mutable" ? Mutable : Draft
  ```

### Phase 2: Value Shape Updates 🔴

- 🔴 **Task 2.1**: Update primitive value shapes in `packages/change/src/shape.ts`
  - `StringValueShape`: `_mutable = PlainValueRef<T>`, `_draft = T`
  - `NumberValueShape`: `_mutable = PlainValueRef<number>`, `_draft = number`
  - `BooleanValueShape`: `_mutable = PlainValueRef<boolean>`, `_draft = boolean`
  - `NullValueShape`: `_mutable = PlainValueRef<null>`, `_draft = null`
  - `UndefinedValueShape`: `_mutable = PlainValueRef<undefined>`, `_draft = undefined`
  - `Uint8ArrayValueShape`: `_mutable = PlainValueRef<Uint8Array>`, `_draft = Uint8Array`

- 🔴 **Task 2.2**: Update compound value shapes (all get plain types for `_draft`)
  - `StructValueShape<T>`: `_mutable = PlainValueRef<{...}>`, `_draft = { [K]: T[K]["_draft"] }` (plain nested object)
  - `RecordValueShape<T>`: `_mutable = PlainValueRef<Record<...>>`, `_draft = Record<string, T["_draft"]>`
  - `ArrayValueShape<T>`: `_mutable = PlainValueRef<T[]>`, `_draft = T["_draft"][]`
  - `UnionValueShape<T>`: `_mutable = PlainValueRef<T>`, `_draft = T` (plain union type)
  - `DiscriminatedUnionValueShape`: `_mutable = PlainValueRef<T>`, `_draft = T` (plain discriminated union)
  - `AnyValueShape`: `_mutable = PlainValueRef<Value>`, `_draft = Value`

  **Rationale**: Inside `change()`, the draft should look exactly like the plain JSON schema. The Proxy makes `PlainValueRef<T>` behave like `T` for property access, so typing `_draft` as plain `T` matches runtime behavior and provides ideal DX. Users shouldn't need `valueOf()` in normal draft manipulation.

- 🔴 **Task 2.3**: Update `Shape.plain.*` factory functions to set both `_mutable` and `_draft`

### Phase 3: Container Ref Type Updates 🔴

- 🔴 **Task 3.1**: Add `Mode` parameter to `StructRef` in `packages/change/src/typed-refs/struct-ref.ts`
  ```typescript
  type StructRef<
    NestedShapes extends Record<string, ContainerOrValueShape>,
    Mode extends RefMode = "mutable"
  > = {
    [K in keyof NestedShapes]: Mode extends "mutable" 
      ? NestedShapes[K]["_mutable"] 
      : NestedShapes[K]["_draft"]
  } & { ... }
  ```

- 🔴 **Task 3.2**: Add `Mode` parameter to `ListRef` in `packages/change/src/typed-refs/list-ref.ts`
  ```typescript
  class ListRef<
    NestedShape extends ContainerOrValueShape,
    Mode extends RefMode = "mutable"
  > extends ListRefBase<NestedShape> {
    [index: number]: (Mode extends "mutable" 
      ? NestedShape["_mutable"] 
      : NestedShape["_draft"]) | undefined
  }
  ```

- 🔴 **Task 3.3**: Add `Mode` parameter to `MovableListRef` in `packages/change/src/typed-refs/movable-list-ref.ts`

- 🔴 **Task 3.4**: Add `Mode` parameter to `IndexedRecordRef` in `packages/change/src/typed-refs/record-ref.ts`
  ```typescript
  type IndexedRecordRef<
    NestedShape extends ContainerOrValueShape,
    Mode extends RefMode = "mutable"
  > = RecordRef<NestedShape> & {
    [key: string]: (Mode extends "mutable" 
      ? NestedShape["_mutable"] 
      : NestedShape["_draft"]) | undefined
  }
  ```

- 🔴 **Task 3.5**: Update `TreeNodeRef.data` in `packages/change/src/typed-refs/tree-node-ref.ts`
  - The `data` getter returns `StructRef<DataShape["shapes"]>` with `_mutable` properties
  - Add `Mode` parameter to `TreeNodeRef` type (or keep as `"mutable"` since tree access is typically outside `change()`)

- 🔴 **Task 3.6**: Update `ListRefBase` class with mode-dependent types
  
  **Complexity Note**: `ListRefBase` is a class with `MutableItem = NestedShape["_mutable"]` baked in. To make return types mode-dependent:
  1. Add `Mode extends RefMode = "mutable"` type parameter to `ListRefBase`
  2. Add `DraftItem = NestedShape["_draft"]` type parameter
  3. Update method signatures to use conditional return types:
     ```typescript
     find(predicate: ...): (Mode extends "mutable" ? MutableItem : DraftItem) | undefined
     filter(predicate: ...): (Mode extends "mutable" ? MutableItem : DraftItem)[]
     slice(start?, end?): (Mode extends "mutable" ? MutableItem : DraftItem)[]
     ```
  4. Update `ListRef` and `MovableListRef` to pass the Mode parameter through

### Phase 4: Container Shape Updates 🔴

- 🔴 **Task 4.1**: Update `StructContainerShape` in `packages/change/src/shape.ts`
  ```typescript
  interface StructContainerShape<NestedShapes> extends Shape<
    { [K in keyof NestedShapes]: NestedShapes[K]["_plain"] },
    StructRef<NestedShapes, "mutable">,
    StructRef<NestedShapes, "draft">,
    { [K in keyof NestedShapes]: NestedShapes[K]["_placeholder"] }
  > { ... }
  ```

- 🔴 **Task 4.2**: Update `ListContainerShape`
  ```typescript
  interface ListContainerShape<NestedShape> extends Shape<
    NestedShape["_plain"][],
    ListRef<NestedShape, "mutable">,
    ListRef<NestedShape, "draft">,
    never[]
  > { ... }
  ```

- 🔴 **Task 4.3**: Update `MovableListContainerShape` similarly

- 🔴 **Task 4.4**: Update `RecordContainerShape` similarly
  ```typescript
  interface RecordContainerShape<NestedShape> extends Shape<
    Record<string, NestedShape["_plain"]>,
    IndexedRecordRef<NestedShape, "mutable">,
    IndexedRecordRef<NestedShape, "draft">,
    Record<string, never>
  > { ... }
  ```

- 🔴 **Task 4.5**: Keep `TreeContainerShape` with default `_draft = _mutable`
  - `TreeRefInterface` doesn't expose value shape properties directly
  - `TreeNodeRef.data` returns `StructRef`—handled by Task 3.5
  - No mode parameter needed for tree containers themselves

- 🔴 **Task 4.6**: Update `DocShape` to propagate `_draft`
  ```typescript
  interface DocShape<NestedShapes> extends Shape<
    { [K in keyof NestedShapes]: NestedShapes[K]["_plain"] },
    { [K in keyof NestedShapes]: NestedShapes[K]["_mutable"] },
    { [K in keyof NestedShapes]: NestedShapes[K]["_draft"] },
    { [K in keyof NestedShapes]: NestedShapes[K]["_placeholder"] }
  > { ... }
  ```

### Phase 5: Type Helper Updates 🔴

- 🔴 **Task 5.1**: Update `types.ts` with new type helpers
  ```typescript
  // Existing (unchanged semantics)
  type InferMutableType<T> = T extends Shape<any, infer M, any, any> ? M : never
  
  // New: Extract draft type
  type InferDraftType<T> = T extends Shape<any, any, infer D, any> ? D : never
  
  // Existing: For direct access
  type Mutable<T extends DocShape> = InferMutableType<T>
  
  // New: For change() callbacks
  type Draft<T extends DocShape> = InferDraftType<T>
  ```

- 🔴 **Task 5.2**: Export `RefMode` type from `packages/change/src/index.ts`

### Phase 6: change() and TypedDoc Updates 🔴

- 🔴 **Task 6.1**: Update `TypedDoc` type in `packages/change/src/typed-doc.ts`
  - Keep `TypedDoc<Shape>` extending `Mutable<Shape>` (direct access uses `_mutable`)
  - Update `[EXT_SYMBOL].change` signature to use `Draft<Shape>`

- 🔴 **Task 6.2**: Update `change()` overloads in `packages/change/src/functional-helpers.ts`
  - Doc overload: `fn: (draft: Draft<Shape>) => void`
  - Ref overloads: Use draft mode types

### Phase 7: useValue() Overload 🔴

- 🔴 **Task 7.1**: Add `PlainValueRef` overload in `packages/hooks-core/src/create-ref-hooks.ts`
  ```typescript
  function useValue<T>(ref: PlainValueRef<T>): T
  ```
  - Place BEFORE `AnyTypedRef` overload (TypeScript resolves in declaration order)
  - Runtime: detect via `isPlainValueRef()`, subscribe to parent container

- 🔴 **Task 7.2**: Add overload to `packages/react/src/hooks-core.ts`

- 🔴 **Task 7.3**: Add overload to `packages/hono/src/hooks-core.ts`

### Phase 8: Testing 🔴

- 🔴 **Task 8.1**: Add type-level tests in `packages/change/src/types.test.ts`
  - Verify `_mutable` returns `PlainValueRef<T>` for value shapes
  - Verify `_draft` returns `T` for primitive value shapes
  - Verify `StructRef<N, "mutable">` property types
  - Verify `StructRef<N, "draft">` property types

- 🔴 **Task 8.2**: Add type-level tests for `useValue` in `packages/react/src/use-value-types.test.ts`
  ```typescript
  it("returns T for PlainValueRef<T>", () => {
    declare const ref: PlainValueRef<string>
    const result = useValue(ref)
    expectTypeOf(result).toEqualTypeOf<string>()
  })
  ```

- 🔴 **Task 8.3**: Verify existing tests pass (runtime behavior unchanged)

### Phase 9: Documentation 🔴

- 🔴 **Task 9.1**: Update `TECHNICAL.md` with new section on RefMode type separation
  - Document the `_mutable` vs `_draft` distinction
  - Document the `RefMode` generic parameter pattern
  - Document `useValue()` overload ordering

- 🔴 **Task 9.2**: Update changeset `plain-value-ref.md` if needed to reflect the cleaner types

## Unit and Integration Tests

### Type-Level Tests

```typescript
// packages/change/src/types.test.ts
import { expectTypeOf } from "vitest"
import type { PlainValueRef, Shape, StringValueShape, StructRef } from "./index"

describe("RefMode type separation", () => {
  describe("Value shapes", () => {
    it("StringValueShape._mutable is PlainValueRef<string>", () => {
      type Result = StringValueShape["_mutable"]
      expectTypeOf<Result>().toEqualTypeOf<PlainValueRef<string>>()
    })

    it("StringValueShape._draft is string", () => {
      type Result = StringValueShape["_draft"]
      expectTypeOf<Result>().toEqualTypeOf<string>()
    })
  })

  describe("StructRef with mode", () => {
    type TestShapes = { title: StringValueShape; count: NumberValueShape }

    it("mutable mode returns PlainValueRef properties", () => {
      type Ref = StructRef<TestShapes, "mutable">
      type TitleType = Ref["title"]
      expectTypeOf<TitleType>().toEqualTypeOf<PlainValueRef<string>>()
    })

    it("draft mode returns raw properties for primitives", () => {
      type Ref = StructRef<TestShapes, "draft">
      type TitleType = Ref["title"]
      expectTypeOf<TitleType>().toEqualTypeOf<string>()
    })
  })
})
```

### Runtime Tests

No new runtime tests needed—this is a type-only refactor. Existing tests verify runtime behavior.

**Note on `valueOf()` in tests**: Some existing tests use `valueOf()` for deep equality assertions (e.g., `expect(foundTodo?.valueOf()).toEqual({...})`). This is for test purposes only. In normal code inside `change()`, users access properties directly without `valueOf()`. The new `_draft` types reflect this expected usage pattern.

### IDE Hover Display Verification

Verified via TypeScript compiler output:
- Type aliases are preserved in hovers: `StructRef<MetaShapes, "mutable">`
- Property access resolves correctly: `mutableRef.title` → `PlainValueRef<string>`, `draftRef.title` → `string`
- The Mode parameter adds minimal verbosity and documents intent

### Verification Strategy

After each phase, run:
```bash
pnpm turbo run verify --filter=@loro-extended/change
```

After Phase 7 (useValue), run:
```bash
pnpm turbo run verify --filter=@loro-extended/hooks-core
pnpm turbo run verify --filter=@loro-extended/react
pnpm turbo run verify --filter=@loro-extended/hono
```

Full verification:
```bash
pnpm turbo run verify
```

## Transitive Effect Analysis

| Change | Direct Impact | Transitive Impact |
|--------|---------------|-------------------|
| Add `_draft` to `Shape` | All shape definitions | All type inference using shapes |
| Update `StructRef` with `Mode` | `StructRef` usages | `StructContainerShape._mutable`/`._draft`, `change()` callback types |
| Update `ListRef` with `Mode` | `ListRef` usages | `ListContainerShape`, `find()`/`filter()` return types |
| Update `change()` to use `Draft<T>` | `change()` callback types | All code inside `change()` blocks (improved types) |
| Add `useValue()` overload | `useValue` calls | Apps using `useValue` with `PlainValueRef` (now works) |

**Risk Assessment:**
- Low risk: Runtime behavior is unchanged
- Medium risk: Type changes may surface hidden type errors in existing code that relied on the union
- Mitigation: Run full test suite after each phase

## Resources for Implementation

### Critical Files (in modification order)
1. `packages/change/src/shape.ts` — Shape interface, value shapes, container shapes
2. `packages/change/src/types.ts` — Type helpers (`InferDraftType`, `Draft<T>`)
3. `packages/change/src/typed-refs/struct-ref.ts` — `StructRef` type with `Mode`
4. `packages/change/src/typed-refs/list-ref.ts` — `ListRef` with `Mode`
5. `packages/change/src/typed-refs/list-ref-base.ts` — Array method return types
6. `packages/change/src/typed-refs/movable-list-ref.ts` — `MovableListRef` with `Mode`
7. `packages/change/src/typed-refs/record-ref.ts` — `IndexedRecordRef` with `Mode`
8. `packages/change/src/typed-doc.ts` — `TypedDoc` type, `change()` signature
9. `packages/change/src/functional-helpers.ts` — `change()` overloads
10. `packages/hooks-core/src/create-ref-hooks.ts` — `useValue()` overload
11. `packages/react/src/hooks-core.ts` — Re-export `useValue()` with overload
12. `packages/hono/src/hooks-core.ts` — Re-export `useValue()` with overload

### Reference Files
- `packages/change/src/typed-refs/struct-ref-internals.ts` — Runtime behavior (lines 114-133)
- `packages/change/src/typed-refs/plain-value-access.ts` — `resolveValueForBatchedMutation()`
- `packages/change/src/plain-value-ref/types.ts` — `PlainValueRef<T>` interface
- `packages/change/src/typed-refs/tree-node-ref.ts` — `TreeNodeRef.data` property (lines 70-77)
- `packages/change/src/typed-refs/record-ref.ts` — `IndexedRecordRef` type (lines 166-178)

## Critical Type Signatures

### Shape Interface
```typescript
interface Shape<Plain, Mutable, Draft = Mutable, Placeholder = Plain> {
  readonly _type: string
  readonly _plain: Plain
  readonly _mutable: Mutable
  readonly _draft: Draft
  readonly _placeholder: Placeholder
}
```

### RefMode and StructRef
```typescript
type RefMode = "mutable" | "draft"

type StructRef<
  NestedShapes extends Record<string, ContainerOrValueShape>,
  Mode extends RefMode = "mutable"
> = {
  [K in keyof NestedShapes]: Mode extends "mutable"
    ? NestedShapes[K]["_mutable"]
    : NestedShapes[K]["_draft"]
} & {
  toJSON(): Infer<StructContainerShape<NestedShapes>>
  [INTERNAL_SYMBOL]: RefInternalsBase
  [LORO_SYMBOL]: LoroMap
}
```

### Type Helpers
```typescript
type InferDraftType<T> = T extends Shape<any, any, infer D, any> ? D : never
type Draft<T extends DocShape> = InferDraftType<T>
```

### useValue Overload
```typescript
// Must be FIRST overload (highest priority)
function useValue<T>(ref: PlainValueRef<T>): T
```

## Changeset

No new changeset required. The existing `plain-value-ref.md` changeset documents `useValue()` working with plain value properties. This plan completes that implementation with cleaner types.

## Documentation Updates

### TECHNICAL.md Addition

Add under "Value Shape Handling":

```markdown
### RefMode Type Separation

The type system uses a `RefMode` generic parameter to distinguish between direct access and `change()` contexts:

| Mode | Context | Value Shape Property Type |
|------|---------|--------------------------|
| `"mutable"` | Direct access (`doc.meta.title`) | `PlainValueRef<T>` |
| `"draft"` | Inside `change()` (`draft.meta.title`) | `T` for primitives, `PlainValueRef<T>` for objects |

Container refs (`StructRef`, `ListRef`, etc.) accept a `Mode` parameter that cascades to child property types:

```typescript
type StructRef<NestedShapes, Mode extends RefMode = "mutable"> = {
  [K in keyof NestedShapes]: Mode extends "mutable"
    ? NestedShapes[K]["_mutable"]
    : NestedShapes[K]["_draft"]
} & { ... }
```

This enables:
- Clean `useValue(doc.meta.title)` calls (no union type)
- Ergonomic `if (draft.active)` patterns inside `change()` (raw booleans)
- Type-safe distinction between reactive reads and mutation contexts
```

### subscribe() Consideration

The `subscribe()` function in `functional-helpers.ts` may also need a `PlainValueRef` overload for completeness. The existing changeset (`plain-value-ref.md`) mentions:
> `subscribe(doc.meta.title, cb)` - Now works with plain value properties

This should be addressed as a follow-up task after the core type separation is complete.

## Design Decisions

### Why Plain Types for All `_draft` Values

The original plan proposed keeping `PlainValueRef` for object-typed values inside `change()`. After research, we determined **all** `_draft` types should be plain:

1. **Runtime Proxy Behavior**: The `PlainValueRef` Proxy makes objects behave like plain objects for property access and assignment
2. **Ideal DX**: `draft.meta.author.name = "Alice"` should type as `string`, not `PlainValueRef<string>`
3. **No `valueOf()` Needed**: Users shouldn't call `valueOf()` in normal draft code—the Proxy handles it
4. **Type/Runtime Alignment**: Typing `_draft` as plain `T` matches how developers actually use drafts

**Trade-off**: `valueOf()`, `toJSON()`, `toString()` won't be available at the type level on object-typed draft values. This is acceptable because users shouldn't need them in normal draft manipulation.

### IDE Hover Display with Mode Parameter

Investigated and confirmed acceptable:
- TypeScript preserves the type alias: `StructRef<MetaShapes, "mutable">` (not expanded)
- Property types resolve correctly when accessed
- The Mode parameter is meaningful and self-documenting
- Slight verbosity vs separate types is acceptable trade-off for single definition
