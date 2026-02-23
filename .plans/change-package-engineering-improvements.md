# Plan: @loro-extended/change Engineering Improvements

## Background

Following a major refactor that unified the API around method-based read/write (`.get()`, `.set()`), a post-implementation analysis revealed several opportunities for better engineering practices. All 909 tests pass, but the codebase has accumulated technical debt in the form of code duplication, missing documentation, incomplete error handling, and a stale reference hazard for list mutations.

**Key reference files:**
- `TECHNICAL.md` (root) — Architectural documentation
- `.plans/api-consistency.md` — Recent API unification plan (completed)
- `.plans/change-library-loose-ends.md` — Recent cleanup plan (completed)
- `packages/change/src/typed-refs/struct-ref-internals.ts` — Duplication source
- `packages/change/src/typed-refs/record-ref-internals.ts` — Duplication source
- `packages/change/src/typed-refs/list-ref-base.ts` — Stale ref hazard location
- `packages/change/src/plain-value-ref/factory.ts` — Proxy factory duplication
- `packages/change/src/typed-refs/struct-ref.ts` — Deprecated method comments

## Problem Statement

1. **Code Duplication**: `StructRefInternals` and `RecordRefInternals` share ~70% identical logic. The 8 proxy factory functions in `plain-value-ref/factory.ts` follow repetitive patterns.

2. **Stale Reference Hazard**: `PlainValueRef` is a live reference to a list index. When a list is mutated (delete/insert), outstanding PlainValueRefs point to shifted indices, causing silent data corruption.

3. **Deprecated Method Comments Incorrect**: `StructRef` has deprecated methods with comments saying "Use property assignment" but property assignment was removed in the refactor.

4. **Missing Package Documentation**: No `TECHNICAL.md` exists for `packages/change/`. Architecture, design decisions, and gotchas are scattered or undocumented.

5. **Error Handling**: All errors are plain `Error` instances without path context or structured types.

6. **No Runtime Validation**: Values passed to `.set()` are not validated against the schema, risking data corruption.

7. **List Overlay Incomplete**: `getTransition()` doesn't work correctly for list values (TODO in code).

8. **Proxy Factory Duplication**: 8 similar proxy functions with subtle differences increase maintenance burden.

## Success Criteria

1. **StructRefInternals/RecordRefInternals share a base class** with ~30% less combined code
2. **Stale list refs are detectable** via a version counter that warns/throws on access after mutation
3. **Deprecated method comments are accurate** for the current API
4. **`packages/change/TECHNICAL.md` exists** with architecture overview, design decisions, and gotchas
5. **Custom error types** provide path context for debugging
6. **Optional runtime validation** is available via a flag or method
7. **List overlay is complete** for `getTransition()` support
8. **Proxy factories consolidated** to use a higher-order factory pattern

## The Gap

| Current State | Target State |
|---------------|--------------|
| Duplicated internals classes | Shared `MapBasedRefInternals` base class |
| Stale refs silently return wrong data | Stale refs throw `StaleRefError` |
| Comments say "use assignment" | Comments say "use `.set()` on PlainValueRef" |
| No package-level TECHNICAL.md | Comprehensive TECHNICAL.md |
| Plain `Error` everywhere | `LoroExtendedError` hierarchy with context |
| No validation at boundaries | Optional `{ validate: true }` flag |
| List overlay returns undefined | List overlay applies reverse delta |
| 8 similar proxy functions | 3 consolidated factory functions |

## Transitive Effect Analysis

| Changed Module | Direct Dependents | Transitive Impact |
|----------------|-------------------|-------------------|
| New `MapBasedRefInternals` | `StructRefInternals`, `RecordRefInternals` | All struct/record usage — behavioral equivalent |
| `ListRefBaseInternals` (version counter) | `list-ref-base.ts`, `movable-list-ref.ts` | All list-item PlainValueRefs |
| New error types | All modules that throw | External callers can `catch` specific types |
| `factory.ts` refactor | `plain-value-access.ts`, internals classes | All PlainValueRef creation |
| List overlay completion | `value-reader.ts`, `getTransition()` | Subscriptions using before/after on lists |

**Key constraint**: All changes are internal refactors. Public API signatures remain unchanged. Existing tests must pass without modification (except where we add new tests).

---

## Phase 1: Extract MapBasedRefInternals Base Class ✅

**Goal**: Eliminate duplication between `StructRefInternals` and `RecordRefInternals`.

### Tasks

1. ✅ **Create `map-based-ref-internals.ts`** in `typed-refs/` with abstract class:

   ```typescript
   export abstract class MapBasedRefInternals<
     Shape extends StructContainerShape | RecordContainerShape
   > extends BaseRefInternals<Shape> {
     protected refCache = new Map<string, TypedRef<ContainerShape>>()

     abstract getNestedShape(key: string): ContainerOrValueShape | undefined
     abstract getChildPlaceholder(key: string): unknown

     getChildTypedRefParams(key: string, shape: ContainerShape): TypedRefParams<ContainerShape> {
       const placeholder = this.getChildPlaceholder(key)
       return buildChildTypedRefParams(this, key, shape, placeholder)
     }

     override finalizeTransaction(): void {
       for (const ref of this.refCache.values()) {
         ref[INTERNAL_SYMBOL].finalizeTransaction?.()
       }
     }

     protected override createExtNamespace(): ExtMapRef {
       // Shared implementation
     }
   }
   ```

2. ✅ **Refactor `StructRefInternals`** to extend `MapBasedRefInternals`:
   - Implement `getNestedShape(key)` → `structShape.shapes[key]`
   - Implement `getChildPlaceholder(key)` → `(this.getPlaceholder() as any)?.[key]`
   - Remove duplicated `finalizeTransaction()`, `createExtNamespace()`, cache field

3. ✅ **Refactor `RecordRefInternals`** to extend `MapBasedRefInternals`:
   - Implement `getNestedShape(key)` → `recordShape.shape` (same for all keys)
   - Implement `getChildPlaceholder(key)` → existing derive-fallback logic
   - Remove duplicated methods

4. ✅ **Run `verify`** — all tests must pass (909/909)

**Resources**: `struct-ref-internals.ts`, `record-ref-internals.ts`, `utils.ts` (for `buildChildTypedRefParams`)

---

## Phase 2: Fix Deprecated Method Comments ✅

**Goal**: Correct outdated JSDoc comments in `StructRef`.

### Tasks

1. ✅ **Update deprecated comments** in `struct-ref.ts`:

   | Method | Old Comment | New Comment |
   |--------|-------------|-------------|
   | `get(key)` | "Use property access instead: obj.key" | "Use property access: `obj.key.get()`" |
   | `set(key, value)` | "Use property assignment instead: obj.key = value" | "Use `.set()` on the property's PlainValueRef: `obj.key.set(value)`" |
   | `delete(key)` | "Use delete obj.key instead" | "Struct properties cannot be deleted. Use `.set()` to set to null/undefined if the schema allows." |
   | `has(key)` | "Use 'key' in obj instead" | "Use property access to check: `obj.key.get() !== undefined`" |
   | `keys()` | "Use Object.keys(obj) instead" | "`Object.keys(obj)` works correctly" |
   | `values()` | "Use Object.values(obj) instead" | "`Object.values(obj)` returns PlainValueRefs; use `.get()` to unwrap" |
   | `size` | "Not standard for objects" | "Use `Object.keys(obj).length` instead" |

2. ✅ **Run `verify`** — types and format

**Resources**: `struct-ref.ts`

---

## Phase 3: Create Package-Level TECHNICAL.md ✅

**Goal**: Document architecture, design decisions, and gotchas for the `change` package.

### Tasks

1. ✅ **Create `packages/change/TECHNICAL.md`** with sections:

   - **Architecture Overview**: Shape system, TypedDoc, TypedRefs, PlainValueRef
   - **Symbol-Based Escape Hatches**: `LORO_SYMBOL`, `EXT_SYMBOL`, `INTERNAL_SYMBOL`
   - **Ref Internals Pattern**: Facade + Internals, why split
   - **PlainValueRef Design**: Read chain (overlay → container → placeholder), write-through
   - **Mergeable Storage**: When to use, limitations, path encoding
   - **Draft Mode**: How `batchedMutation` affects behavior
   - **Known Limitations**: Stale list refs, list overlay TODO, no runtime validation
   - **Gotchas**: Numbered list matching TECHNICAL.md root but specific to this package

2. ✅ **Cross-reference from root TECHNICAL.md**: Add a note in the `@loro-extended/change Architecture` section pointing to the package-level doc for implementation details.

**Resources**: Root `TECHNICAL.md`, `README.md` in `packages/change/`

---

## Phase 4: Implement Stale List Ref Detection 🔴

**Goal**: Prevent silent data corruption when list PlainValueRefs are accessed after list mutation.

### Design

Each `ListRefBaseInternals` maintains a `mutationVersion: number` that increments on delete/insert/set. Each PlainValueRef for a list item captures the version at creation time. On `.get()` or `.set()`, if versions don't match, throw `StaleRefError`.

### Tasks

1. 🔴 **Add `StaleRefError`** to new `errors.ts` file:

   ```typescript
   export class LoroExtendedError extends Error {
     constructor(message: string, public context?: Record<string, unknown>) {
       super(message)
       this.name = 'LoroExtendedError'
     }
   }

   export class StaleRefError extends LoroExtendedError {
     constructor(public listId: string, public originalIndex: number) {
       super(
         `Stale PlainValueRef: list "${listId}" was mutated after this ref was created at index ${originalIndex}. ` +
         `Capture values with .get() before mutating the list.`,
         { listId, originalIndex }
       )
       this.name = 'StaleRefError'
     }
   }
   ```

2. 🔴 **Add `mutationVersion` to `ListRefBaseInternals`**:
   - Initialize to `0`
   - Increment in `delete()`, `insert()`, `set()`, `push()`
   - Expose via `getMutationVersion(): number`

3. 🔴 **Extend `buildBasePlainValueRef`** to accept optional `listMutationVersion`:
   - Store in closure
   - In `.get()` and `.set()`, if `listMutationVersion !== undefined`, fetch current version from internals and compare
   - Throw `StaleRefError` on mismatch

4. 🔴 **Update `createListItemPlainValueRef`** to pass `listMutationVersion`:
   - Call `internals.getMutationVersion()` at creation time
   - Pass to `buildBasePlainValueRef`

5. 🔴 **Write test** in `list-ref.test.ts`:
   ```typescript
   it('throws StaleRefError when accessing a PlainValueRef after list mutation', () => {
     const ref = doc.items.get(0)
     doc.items.delete(0, 1)
     expect(() => ref.get()).toThrow(StaleRefError)
   })

   it('allows access to PlainValueRef before list mutation', () => {
     const ref = doc.items.get(0)
     expect(ref.get()).toBe('first') // No error
   })
   ```

6. 🔴 **Run `verify`**

**Resources**: `list-ref-base.ts`, `factory.ts`, `plain-value-access.ts`

---

## Phase 5: Custom Error Types + Validation Wiring ✅ (partial)

**Goal**: Create structured error types and wire up the existing `validateValue()` for opt-in validation at write boundaries.

**Key Discovery**: `validateValue(value, schema, path)` **already exists** in `packages/change/src/validation.ts` (lines 19-260). It's a comprehensive recursive validator that handles all container and value shape types. Phase 5 and 6 are merged because:
1. Error types are needed for proper validation errors
2. The existing `validateValue()` throws plain `Error` and should throw `SchemaViolationError`
3. Wiring validation to `.set()` requires the error types to exist first

### Tasks

1. ✅ **Create `errors.ts`** with error type hierarchy:

   ```typescript
   export class LoroExtendedError extends Error {
     constructor(message: string, public context?: Record<string, unknown>) {
       super(message)
       this.name = 'LoroExtendedError'
     }
   }

   export class StaleRefError extends LoroExtendedError {
     constructor(public listId: string, public originalIndex: number) {
       super(
         `Stale PlainValueRef: list "${listId}" was mutated after this ref was created at index ${originalIndex}. ` +
         `Capture values with .get() before mutating the list.`,
         { listId, originalIndex }
       )
       this.name = 'StaleRefError'
     }
   }

   export class PathNavigationError extends LoroExtendedError {
     constructor(
       public path: (string | number)[],
       public failedSegment: string | number,
       message?: string
     ) {
       super(message ?? `Cannot navigate to path segment: ${failedSegment}`, { path, failedSegment })
       this.name = 'PathNavigationError'
     }
   }

   export class SchemaViolationError extends LoroExtendedError {
     constructor(
       public schemaPath: string,
       public expectedType: string,
       public actualValue: unknown
     ) {
       super(`Schema violation at ${schemaPath}: expected ${expectedType}, got ${typeof actualValue}`, {
         schemaPath, expectedType, actualValue
       })
       this.name = 'SchemaViolationError'
     }
   }

   export class ContainerTypeError extends LoroExtendedError {
     constructor(
       public containerType: string,
       public operation: string
     ) {
       super(`Cannot perform ${operation} on container type: ${containerType}`, {
         containerType, operation
       })
       this.name = 'ContainerTypeError'
     }
   }
   ```

2. ✅ **Export from `index.ts`**: Export all error types for external catch handling

3. ✅ **Update existing `validateValue()` in `validation.ts`**:
   - Import `SchemaViolationError` from `./errors.js`
   - Replace all `throw new Error(...)` with `throw new SchemaViolationError(path, expectedType, value)`
   - This is a find-and-replace refactor, not new logic

4. ✅ **Replace key error sites in other modules**:
   - `json-patch.ts` navigation errors → `PathNavigationError`
   - `utils.ts` container type errors → (deferred - would add overhead)

5. 🔵 **DEFERRED: Add `validate?: boolean` option to PlainValueRef**:
   - Extend `buildBasePlainValueRef` to accept `validate` option
   - In `.set()`, when `validate: true`, call existing `validateValue()` before `writeValue()`
   - Default: `false` (no runtime cost unless opted in)

6. 🔵 **DEFERRED: Add `validate` option to `change()` and `createTypedDoc()`**:
   - Add to `TypedRefParams` so it propagates to all refs
   - Add to `ChangeOptions` for per-transaction validation
   - Add to `CreateTypedDocOptions` for document-wide default

7. 🔵 **DEFERRED: Write tests** for validation wiring:
   ```typescript
   it('validates value against schema when validate: true', () => {
     const doc = createTypedDoc(schema, { validate: true })
     expect(() => doc.count.set("not a number")).toThrow(SchemaViolationError)
   })

   it('skips validation by default', () => {
     const doc = createTypedDoc(schema)
     // This would fail at runtime in Loro, but we don't validate
     expect(() => doc.count.set("not a number" as any)).not.toThrow(SchemaViolationError)
   })
   ```

8. ✅ **Run `verify`**

**Note**: Tasks 5-7 deferred. Adding runtime validation at write boundaries adds overhead to every `.set()` call. The error types are now available for users who want to call `validateValue()` manually before writes. If demand arises, we can revisit opt-in validation wiring.

**Resources**: `validation.ts` (existing), `errors.ts` (new), `factory.ts`, `functional-helpers.ts`, `typed-doc.ts`, `json-patch.ts`, `utils.ts`

---

## Phase 6: Complete List Overlay for getTransition() 🔴

**Goal**: Make `getTransition()` work correctly for list values.

**Key Discovery**: `applyListDelta(input, delta)` already exists in `list-ref-base.ts` (lines 603-623). Rather than creating duplicate delta application logic, we follow FC/IS by:
1. Creating a pure function to reverse a delta
2. Reusing the existing `applyListDelta` for application

### Tasks

1. 🔴 **Create `reverseListDelta`** pure function in `list-ref-base.ts`:
   ```typescript
   /**
    * Reverses a list delta to reconstruct the "before" state.
    * Pure function: delta in, reversed delta out.
    * 
    * Inverse operations:
    * - retain N → retain N (unchanged)
    * - delete N → insert (the N deleted items from originalValues)
    * - insert items → delete items.length
    * 
    * @param delta - The forward delta from Loro
    * @param originalValues - The values that were present before the delta
    * @returns A reversed delta that, when applied to "after", produces "before"
    */
   export function reverseListDelta<T>(
     delta: Delta<T[]>[],
     afterValues: T[],
     beforeLength: number
   ): Delta<T[]>[]
   ```

2. 🔴 **Export `applyListDelta`** from `list-ref-base.ts`:
   - Currently a private function
   - Export it for use in `value-reader.ts`

3. 🔴 **Update `getListOverlayValue`** in `value-reader.ts`:
   - Import `reverseListDelta` and `applyListDelta` from `list-ref-base.js`
   - Reconstruct the "before" array using: `applyListDelta(afterValues, reverseListDelta(delta, afterValues, beforeLength))`
   - Return the value at the requested index from the reconstructed array
   - Remove the TODO comment

4. 🔴 **Update `getOverlayList`** in `list-ref-base.ts`:
   - Use the same `reverseListDelta` + `applyListDelta` pattern
   - Replace the existing partial implementation

5. 🔴 **Write tests** for list transitions:
   ```typescript
   describe('reverseListDelta', () => {
     it('reverses insert operations', () => {
       const delta = [{ retain: 1 }, { insert: ['b'] }]
       const afterValues = ['a', 'b']
       const reversed = reverseListDelta(delta, afterValues, 1)
       const before = applyListDelta(afterValues, reversed)
       expect(before).toEqual(['a'])
     })

     it('reverses delete operations', () => {
       // ... test delete reversal
     })
   })

   describe('getTransition with lists', () => {
     it('returns correct before/after for list push', () => {
       const doc = createTypedDoc(schema)
       doc.items.push('first')

       const unsubscribe = subscribe(doc, event => {
         const { before, after } = getTransition(doc, event)
         expect(before.items.toJSON()).toEqual([])
         expect(after.items.toJSON()).toEqual(['first'])
       })

       doc.items.push('second')
       unsubscribe()
     })
   })
   ```

6. 🔴 **Run `verify`**

**Resources**: `list-ref-base.ts` (existing `applyListDelta`), `value-reader.ts`, `diff-overlay.ts`

---

## Phase 7: Consolidate List-Item Proxy Factories 🔴

**Goal**: Reduce 8 proxy factories to 6 via safe, minimal consolidation of list-item variants.

**Key Insight**: The list-item proxy pairs are nearly identical:
- `createListItemStructProxy` and `createListItemNestedStructProxy` differ only by the `nestedPath` parameter
- `createListItemRecordProxy` and `createListItemNestedRecordProxy` differ only by the `nestedPath` parameter

By adding an optional `nestedPath` parameter to the base functions, we can eliminate 2 functions with minimal risk.

**Why not 8 → 3?** The more ambitious consolidation would require:
- New abstractions (`createPropertyProxy`, strategy objects)
- Increased indirection and cognitive overhead
- Higher risk of breaking subtle proxy behaviors

The current duplication is "mechanical" (same structural pattern) not "semantic" (same business logic). Each ~20-line factory is self-contained and readable. A minimal consolidation is more pragmatic.

### Consolidation Map

| Before | After | Change |
|--------|-------|--------|
| `createStructProxy` | `createStructProxy` | Keep as-is |
| `createRecordProxy` | `createRecordProxy` | Keep as-is |
| `createGenericObjectProxy` | `createGenericObjectProxy` | Keep as-is |
| `createNestedGenericObjectProxy` | `createNestedGenericObjectProxy` | Keep as-is (recursive) |
| `createListItemStructProxy` | `createListItemStructProxy` | Add optional `nestedPath` param |
| `createListItemNestedStructProxy` | _(removed)_ | Merged into above |
| `createListItemRecordProxy` | `createListItemRecordProxy` | Add optional `nestedPath` param |
| `createListItemNestedRecordProxy` | _(removed)_ | Merged into above |

### Tasks

1. 🔴 **Merge `createListItemStructProxy` and `createListItemNestedStructProxy`**:
   - Add `nestedPath: string[] = []` parameter to `createListItemStructProxy`
   - Update the property handler to use `[...nestedPath, preamble.prop]`
   - Update all call sites of `createListItemNestedStructProxy` to use the merged function
   - Delete `createListItemNestedStructProxy`

2. 🔴 **Merge `createListItemRecordProxy` and `createListItemNestedRecordProxy`**:
   - Add `nestedPath: string[] = []` parameter to `createListItemRecordProxy`
   - Update the property handler to use `[...nestedPath, preamble.prop]`
   - Update all call sites of `createListItemNestedRecordProxy` to use the merged function
   - Delete `createListItemNestedRecordProxy`

3. 🔴 **Update `createListItemNestedPlainValueRef`** call sites:
   - This function creates nested refs and calls the proxy factories
   - Update it to call the merged functions with the `nestedPath` parameter

4. 🔴 **Run `verify`** — ensure all proxy behavior unchanged

**Resources**: `factory.ts`

**Future Consideration**: If further consolidation is desired, a `createPropertyProxy` helper could be introduced incrementally in a future iteration, but this is not required for the current plan.

---

## Tests Summary

| Test | Location | Validates |
|------|----------|-----------|
| Stale ref throws | `list-ref.test.ts` | Phase 4 - version check works |
| Stale ref allows pre-mutation | `list-ref.test.ts` | Phase 4 - no false positives |
| Validation throws on mismatch | `validation.test.ts` | Phase 5 - validation wiring works |
| Validation skips by default | `validation.test.ts` | Phase 5 - no perf impact |
| `reverseListDelta` correctness | `list-ref-base.test.ts` | Phase 6 - delta reversal is pure & correct |
| List transition before/after | `functional-helpers.test.ts` | Phase 6 - overlay works end-to-end |
| List item nested struct access | `plain-value-ref.test.ts` | Phase 7 - merged proxy works for structs |
| List item nested record access | `plain-value-ref.test.ts` | Phase 7 - merged proxy works for records |
| Existing tests | All | No regressions from refactors |

---

## Changeset

```
@loro-extended/change (minor)

### New Features
- Added stale list ref detection: `StaleRefError` thrown when accessing a PlainValueRef after list mutation
- Added custom error types: `LoroExtendedError`, `PathNavigationError`, `SchemaViolationError`, `ContainerTypeError`
- Added optional runtime validation via `{ validate: true }` option on `createTypedDoc()`, `change()`, and `.set()`
- `getTransition()` now works correctly for list values

### Internal Improvements
- Extracted `MapBasedRefInternals` base class reducing struct/record internals duplication
- Updated existing `validateValue()` to throw structured `SchemaViolationError` instead of plain `Error`
- Added pure `reverseListDelta()` function for list overlay reconstruction (FC/IS compliant)
- Consolidated list-item proxy factories from 4 to 2 by merging direct/nested variants
- Added `packages/change/TECHNICAL.md` with architecture documentation

### Fixes
- Fixed deprecated method comments in `StructRef` to reflect current API
```

---

## Documentation Updates

| Document | Update |
|----------|--------|
| `packages/change/TECHNICAL.md` | Create new file (Phase 3) |
| `packages/change/README.md` | Add section on error types and validation |
| Root `TECHNICAL.md` | Add cross-reference to package TECHNICAL.md |
| Root `TECHNICAL.md` | Update gotcha #11 to mention `StaleRefError` |
| Root `TECHNICAL.md` | Add note about custom error types and validation option |

---

## Implementation Order Rationale

1. **Phase 1** (MapBasedRefInternals) — Reduces code volume, makes later changes easier
2. **Phase 2** (Deprecated comments) — Quick win, improves developer experience
3. **Phase 3** (TECHNICAL.md) — Documents current state before more changes
4. **Phase 4** (Stale ref detection) — High-value safety improvement, uses `StaleRefError` from Phase 5
5. **Phase 5** (Custom errors + validation wiring) — Creates error hierarchy AND wires existing `validateValue()` to `.set()`
6. **Phase 6** (List overlay) — Pure `reverseListDelta` + reuse existing `applyListDelta`
7. **Phase 7** (Proxy consolidation) — Lowest priority, highest risk

**Dependency graph**:
- Phases 1-3: Sequential, no dependencies
- Phase 4: Depends on Phase 5 (for `StaleRefError`), OR do Phase 5 first
- Phase 5: Independent (creates error types, wires validation)
- Phase 6: Independent (FC/IS compliant, reuses existing code)
- Phase 7: Independent, can be parallelized after Phase 1

**Recommended order**: 1 → 2 → 3 → 5 → 4 → 6 → 7 (do Phase 5 before 4 so `StaleRefError` is available)

---

## Resources for Implementation Context

When implementing, include these files in context:

**Phase 1:**
- `packages/change/src/typed-refs/struct-ref-internals.ts`
- `packages/change/src/typed-refs/record-ref-internals.ts`
- `packages/change/src/typed-refs/base.ts`
- `packages/change/src/typed-refs/utils.ts`

**Phase 4:**
- `packages/change/src/typed-refs/list-ref-base.ts`
- `packages/change/src/plain-value-ref/factory.ts`
- `packages/change/src/plain-value-ref/types.ts`

**Phase 5:**
- `packages/change/src/validation.ts` (existing - update to use SchemaViolationError)
- `packages/change/src/errors.ts` (new)
- `packages/change/src/json-patch.ts`
- `packages/change/src/typed-refs/utils.ts`
- `packages/change/src/plain-value-ref/factory.ts`
- `packages/change/src/functional-helpers.ts`
- `packages/change/src/typed-doc.ts`

**Phase 6:**
- `packages/change/src/typed-refs/list-ref-base.ts` (existing `applyListDelta`, add `reverseListDelta`)
- `packages/change/src/plain-value-ref/value-reader.ts`
- `packages/change/src/diff-overlay.ts`

**Phase 7:**
- `packages/change/src/plain-value-ref/factory.ts` (entire file)