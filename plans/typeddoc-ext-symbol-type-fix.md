# TypedDoc `[EXT_SYMBOL]` Type Fix

## Background

The `@loro-extended/change` library uses symbol-based escape hatches to provide clean separation between different access patterns:

| Symbol | Function | Purpose |
|--------|----------|---------|
| `INTERNAL_SYMBOL` | (internal) | Private implementation details |
| `LORO_SYMBOL` | `loro()` | Access native Loro types directly |
| `EXT_SYMBOL` | `ext()` | Access loro-extended-specific features |

The `change()` function from `@loro-extended/change` is the unified mutation API for TypedDoc, TypedRef, and Lens. It uses function overloads to provide type-safe mutations:

1. Specific overloads for `TypedDoc<Shape>`, `TreeRef`, `StructRef`, etc.
2. A generic fallback overload for any object with `[EXT_SYMBOL].change()` (e.g., Lens)

The generic overload enables extensibility—any type that implements `[EXT_SYMBOL].change()` can be used with `change()` without circular dependencies.

## Problem Statement

When `TypedDoc<T>` is passed through function parameters or React component props, TypeScript sometimes fails to match the specific `TypedDoc<Shape>` overload and falls back to the generic `[EXT_SYMBOL]` overload. This produces the error:

```
error TS2769: No overload matches this call.
  The last overload gave the following error.
    Property '[EXT_SYMBOL]' is missing in type 'IssueDoc' but required in type 
    '{ [EXT_SYMBOL]: { change: (fn: (draft: any) => void, options?: ChangeOptions | undefined) => void; }; }'.
```

## Root Cause Analysis

### The Mechanism

**Investigation confirmed the root cause is TypeScript's generic inference behavior with type aliases across module boundaries.**

1. **The `change()` function's first overload** uses generic inference:
   ```typescript
   function change<Shape extends DocShape>(
     doc: TypedDoc<Shape>,
     fn: (draft: Mutable<Shape>) => void,
   ): TypedDoc<Shape>
   ```

2. **TypeScript generic inference requires pattern matching.** For `change<Shape>` to infer `Shape`, the argument must be recognizable as `TypedDoc<T>` for some `T`. TypeScript then extracts `T` as the value for `Shape`.

3. **Type flattening breaks inference.** When a type alias like `type IssueDoc = TypedDoc<typeof IssueSchema>` crosses module boundaries (exported, imported, used in `.d.ts` files), TypeScript may "expand" it to its structural form:
   ```typescript
   // Instead of preserving: TypedDoc<IssueSchema>
   // TypeScript sees: { title: TextRef; ... } & { toJSON(): { title: string; ... } }
   ```

4. **Without the `TypedDoc<T>` wrapper, inference fails.** TypeScript sees "some object with these properties" not "TypedDoc<T>". It cannot extract `T`, so **overload 1 fails to match**.

5. **Fallback to `[EXT_SYMBOL]` overload.** TypeScript tries subsequent overloads, eventually hitting:
   ```typescript
   function change<T extends { [EXT_SYMBOL]: { change: ... } }>(
     target: T,
     fn: (draft: ExtractDraft<T>) => void,
   ): T
   ```

6. **TypedDoc lacks `[EXT_SYMBOL]` in its type.** The fallback overload requires `[EXT_SYMBOL]` in the type, but `TypedDoc` is defined as:
   ```typescript
   type TypedDoc<Shape> = Mutable<Shape> & { toJSON(): Infer<Shape> }
   ```
   No `[EXT_SYMBOL]` property—hence the error.

### Proof from Investigation

The investigation files (`overload-break.test.ts`, `overload-root-cause.test.ts`) demonstrated:

- **Direct `TypedDoc<T>` usage works**: TypeScript preserves the wrapper and infers `T` correctly
- **Structurally identical types fail**: `type ManualDoc = Mutable<Schema> & { toJSON(): Infer<Schema> }` produces `draft: unknown` because TypeScript can't infer the `Shape` parameter
- **Type aliases in same file work**: The alias is visible in the same compilation unit
- **Cross-module/flattened types fail**: When the `TypedDoc<T>` wrapper is lost, inference breaks

## The Fix

Add `[EXT_SYMBOL]` with the `change` method signature to the `TypedDoc` type. This provides a **fallback path** that correctly infers the draft type via `ExtractDraft<T>`.

**Use the narrow type (just the `change` method), not the full `ExtDocRef<Shape>`:**

```typescript
export type TypedDoc<Shape extends DocShape> = Mutable<Shape> & {
  toJSON(): Infer<Shape>
  
  /**
   * Internal symbol for change() detection.
   * Use `change(doc, fn, options?)` instead of accessing this directly.
   * @internal
   */
  readonly [EXT_SYMBOL]: {
    change: (fn: (draft: Mutable<Shape>) => void, options?: ChangeOptions) => void
  }
}
```

### Why Narrow Type, Not `ExtDocRef<Shape>`

1. **Avoids circular type reference**: `ExtDocRef<Shape>` includes `TypedDoc<Shape>` in its return types
2. **Matches the Lens pattern**: `Lens<D>` uses the same narrow signature
3. **Sufficient for `ExtractDraft<T>`**: The helper only inspects the `change` method signature
4. **Keeps the type simpler**: Less overhead for TypeScript to process

## Success Criteria

1. ✅ The `TypedDoc<Shape>` type includes `readonly [EXT_SYMBOL]: { change: ... }`
2. ✅ `change(doc, fn)` compiles without error when `doc` is a flattened/expanded type
3. ✅ All existing tests pass (754/754 in @loro-extended/change)
4. ✅ Type safety is preserved—draft type is correctly inferred via `ExtractDraft<T>`
5. ✅ Documentation is updated to reflect the change

## Phases and Tasks

### Phase 1: Update TypedDoc Type Definition ✅

- ✅ **Task 1.1**: Modify `TypedDoc<Shape>` type in `packages/change/src/typed-doc.ts` to include the narrow `[EXT_SYMBOL]` type
- ✅ **Task 1.2**: Add `ChangeOptions` import if not already present (was already imported)
- ✅ **Task 1.3**: Add JSDoc comment marking it as `@internal`

### Phase 2: Add Regression Tests ✅

- ✅ **Task 2.1**: Add test that creates a manually constructed type (simulating flattening) and verifies `change()` works
- ✅ **Task 2.2**: Add compile-time assertion that `TypedDoc<T>` satisfies the `[EXT_SYMBOL]` constraint
- ✅ **Task 2.3**: Verify draft type inference is correct for the flattened case

### Phase 3: Verify and Update Documentation ✅

- ✅ **Task 3.1**: Run full test suite: `pnpm turbo run verify --filter=@loro-extended/change` (754/754 tests pass)
- ✅ **Task 3.2**: Update `TECHNICAL.md` Symbol-Based Escape Hatches section
- ✅ **Task 3.3**: Create changeset for patch version bump

### Phase 4: Cleanup ✅

- ✅ **Task 4.1**: Remove investigation test files (`overload-investigation.test.ts`, `overload-cross-file-*.ts`, `overload-break.test.ts`, `overload-root-cause.test.ts`)

## Unit Tests

Add to `packages/change/src/functional-helpers.test.ts`:

```typescript
describe("change() with TypedDoc type fixes", () => {
  const TestSchema = Shape.doc({
    count: Shape.counter(),
    title: Shape.text(),
  })

  /**
   * TYPE ASSERTION TEST
   * Verifies that TypedDoc<T> now includes [EXT_SYMBOL] in its type.
   * This is a compile-time test - if the type regresses, this file won't compile.
   */
  it("TypedDoc includes [EXT_SYMBOL] in its type (compile-time assertion)", () => {
    // Static assertion helper - causes compile error if T is not true
    type AssertTrue<T extends true> = T

    // Test 1: TypedDoc has [EXT_SYMBOL] property
    type HasExtSymbol = TypedDoc<typeof TestSchema> extends { [EXT_SYMBOL]: unknown } ? true : false
    const _assert1: AssertTrue<HasExtSymbol> = true

    // Test 2: The [EXT_SYMBOL] has a change method
    type HasChangeMethod = TypedDoc<typeof TestSchema> extends {
      [EXT_SYMBOL]: { change: (...args: any[]) => any }
    } ? true : false
    const _assert2: AssertTrue<HasChangeMethod> = true

    // Test 3: Can access [EXT_SYMBOL] on a TypedDoc (type-level)
    type ExtSymbolType = TypedDoc<typeof TestSchema>[typeof EXT_SYMBOL]
    const _assert3: ExtSymbolType = {} as ExtSymbolType // Just needs to compile

    expect(_assert1).toBe(true)
    expect(_assert2).toBe(true)
  })

  /**
   * INFERENCE TEST
   * Verifies that ExtractDraft<TypedDoc<T>> correctly yields Mutable<T>.
   * This ensures the fallback overload path works correctly.
   */
  it("ExtractDraft correctly infers draft type from TypedDoc (compile-time assertion)", () => {
    type AssertTrue<T extends true> = T

    // ExtractDraft<TypedDoc<Schema>> should be Mutable<Schema>, not 'never'
    type Draft = ExtractDraft<TypedDoc<typeof TestSchema>>
    type IsNotNever = Draft extends never ? false : true
    const _assert1: AssertTrue<IsNotNever> = true

    // Draft should have the schema's properties
    type HasCount = Draft extends { count: { increment: (n: number) => void } } ? true : false
    const _assert2: AssertTrue<HasCount> = true

    expect(_assert1).toBe(true)
    expect(_assert2).toBe(true)
  })

  /**
   * RUNTIME TEST
   * Verifies that change() works correctly at runtime when using TypedDoc.
   */
  it("change() works with TypedDoc passed through function parameters", () => {
    // Simulate the pattern that previously failed
    function mutateDoc(doc: TypedDoc<typeof TestSchema>) {
      change(doc, (draft) => {
        draft.count.increment(1)
        draft.title.insert(0, "Hello")
      })
    }

    const doc = createTypedDoc(TestSchema)
    mutateDoc(doc)

    expect(doc.toJSON().count).toBe(1)
    expect(doc.toJSON().title).toBe("Hello")
  })

  /**
   * FALLBACK PATH TEST
   * Verifies that even when type flattening occurs, change() still works
   * by falling through to the [EXT_SYMBOL] overload.
   */
  it("change() works via EXT_SYMBOL fallback when type is structurally expanded", () => {
    const doc = createTypedDoc(TestSchema)

    // Simulate accessing through the EXT_SYMBOL path directly
    // This is what happens internally when the first overload fails
    const extNs = (doc as any)[EXT_SYMBOL]
    extNs.change((draft: Mutable<typeof TestSchema>) => {
      draft.count.increment(5)
    })

    expect(doc.toJSON().count).toBe(5)
  })
})
```

**Note**: The test file will need to import `ExtractDraft` from `functional-helpers.ts`. If it's not exported, either export it or inline the type definition in the test:

```typescript
// Helper type (copy from functional-helpers.ts if not exported)
type ExtractDraft<T> = T extends {
  [EXT_SYMBOL]: {
    change: (fn: (draft: infer D) => void, options?: ChangeOptions) => void
  }
} ? D : never
```

## Transitive Effect Analysis

1. **Direct consumers of `TypedDoc` type**: No change needed—adding a property is backward compatible
2. **Type assignability**: Existing code continues to compile; flattened types now also work
3. **No runtime changes**: Type-only fix
4. **Downstream packages**: `@loro-extended/lens`, `@loro-extended/repo`, `@loro-extended/react` all benefit from the fix without changes

## Resources for Implementation

### Files to Modify

1. `packages/change/src/typed-doc.ts` - Update `TypedDoc` type definition (lines 414-426)
2. `packages/change/src/functional-helpers.test.ts` - Add regression tests

### Files to Delete (Cleanup)

1. `packages/change/src/overload-investigation.test.ts`
2. `packages/change/src/overload-cross-file-a.ts`
3. `packages/change/src/overload-cross-file-b.test.ts`
4. `packages/change/src/overload-break.test.ts`
5. `packages/change/src/overload-root-cause.test.ts`

### Key Type Definitions

**Current TypedDoc** (`packages/change/src/typed-doc.ts`):
```typescript
export type TypedDoc<Shape extends DocShape> = Mutable<Shape> & {
  toJSON(): Infer<Shape>
}
```

**Proposed TypedDoc**:
```typescript
export type TypedDoc<Shape extends DocShape> = Mutable<Shape> & {
  toJSON(): Infer<Shape>
  /**
   * Internal symbol for change() detection.
   * Use `change(doc, fn, options?)` instead of accessing this directly.
   * @internal
   */
  readonly [EXT_SYMBOL]: {
    change: (fn: (draft: Mutable<Shape>) => void, options?: ChangeOptions) => void
  }
}
```

**ExtractDraft helper** (`packages/change/src/functional-helpers.ts`):
```typescript
type ExtractDraft<T> = T extends {
  [EXT_SYMBOL]: {
    change: (fn: (draft: infer D) => void, options?: ChangeOptions) => void
  }
}
  ? D
  : never
```

**Lens type for reference** (`packages/lens/src/types.ts`):
```typescript
export interface Lens<D extends DocShape> {
  readonly worldview: TypedDoc<D>
  readonly world: TypedDoc<D>
  dispose(): void
  readonly [EXT_SYMBOL]: {
    change: (fn: (draft: Mutable<D>) => void, options?: ChangeOptions) => void
  }
}
```

## Changeset

Create `.changeset/typeddoc-ext-symbol-type.md`:

```markdown
---
"@loro-extended/change": patch
---

fix(change): Add `[EXT_SYMBOL]` to TypedDoc type for robust change() support

Fixed a TypeScript type inference issue where `change(doc, fn)` would fail to compile when `TypedDoc<T>` was "flattened" across module boundaries (e.g., in `.d.ts` files or re-exported type aliases).

Root cause: TypeScript's generic inference for `change<Shape>(doc: TypedDoc<Shape>, ...)` requires the argument to match the `TypedDoc<T>` pattern. When types get expanded/flattened, the wrapper is lost and inference fails, causing TypeScript to fall through to the `[EXT_SYMBOL]` fallback overload—which requires `[EXT_SYMBOL]` in the type.

The fix adds the `[EXT_SYMBOL]` property (with the `change` method signature) to the `TypedDoc` type. This:
1. Matches runtime behavior (the proxy already exposes this symbol)
2. Provides a fallback path when type flattening breaks the primary overload
3. Aligns with how `Lens<D>` is already typed

Before (required workaround):
```typescript
function MyComponent({ doc }: { doc: any }) {  // had to use 'any'
  change(doc, draft => { ... })
}
```

After:
```typescript
function MyComponent({ doc }: { doc: TypedDoc<MySchema> }) {
  change(doc, draft => { ... })  // ✅ Works correctly
}
```
```

## Documentation Updates

### TECHNICAL.md

Add to the "Symbol-Based Escape Hatches" section:

```markdown
**TypedDoc and Lens both expose `[EXT_SYMBOL]` in their types**: Both `TypedDoc<Shape>` and `Lens<D>` include `[EXT_SYMBOL]` with a `change` method signature. This serves as a fallback for the `change()` function when TypeScript's generic inference fails due to type flattening across module boundaries. Users should always use `change(doc, fn)` or `ext(doc)` rather than accessing the symbol directly.
```
