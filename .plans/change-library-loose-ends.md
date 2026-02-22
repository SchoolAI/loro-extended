# Plan: Change Library Loose Ends & Inconsistencies

## Background

After recent major changes to `packages/change`, a deep-dive audit revealed several loose ends ranging from a likely data-loss bug to DRY violations and documentation drift. This plan addresses them systematically.

**Key reference files:**
- `TECHNICAL.md` (root) — Architectural documentation, mergeable priority docs
- `packages/change/src/plain-value-ref/value-reader.ts` — Bug location
- `packages/change/src/typed-refs/base.ts` — `DiffOverlay` duplicate, `BaseRefInternals`
- `packages/change/src/diff-overlay.ts` — Canonical `DiffOverlay` + `createDiffOverlay`
- `packages/change/src/typed-refs/utils.ts` — `containerConstructor`, `assignPlainValueToTypedRef`
- `packages/change/src/typed-refs/struct-ref-internals.ts` — Duplicated `getChildTypedRefParams`
- `packages/change/src/typed-refs/record-ref-internals.ts` — Duplicated `getChildTypedRefParams`
- `packages/change/src/typed-refs/doc-ref-internals.ts` — Duplicated `containerGetter`
- `packages/change/src/typed-doc.ts` — Mergeable default, `biome-ignore-all`
- `packages/change/src/conversion.ts` — Extra keys in `convertStructInput`
- `packages/change/src/overlay-recursion.test.ts` — Bogus issue link

## Problem Statement

1. **Bug**: `resolveListValue` uses `??` which silently drops `null` list items, inconsistent with `resolveValue` which uses explicit `!== undefined` checks.
2. **DRY violations**: `DiffOverlay` type defined twice; `containerGetter` mapping hardcoded in 3 places; `getChildTypedRefParams` near-identical in StructRef and RecordRef; suppress-auto-commit pattern copy-pasted 5+ times.
3. **Documentation drift**: TECHNICAL.md mergeable priority order doesn't match code defaults; bogus `issues/XXX` link in tests.
4. **Silent correctness risk**: `convertStructInput` allows extra keys on structs without warning.
5. **Tech debt marker**: `biome-ignore-all` on `typed-doc.ts` suppresses all `any` lint warnings.

## Success Criteria

- `resolveListValue` preserves `null` values identically to `resolveValue` (verified by failing-then-passing test)
- `DiffOverlay` has a single canonical definition with re-exports
- `containerGetter` mapping exists in one place, imported by all consumers
- `getChildTypedRefParams` shared logic extracted; struct and record internals delegate to it
- `withBatchedCommit` helper eliminates all suppress/restore boilerplate
- TECHNICAL.md accurately describes mergeable priority and new-vs-existing distinction
- `convertStructInput` logs a warning (not throws — backward compat) for extra keys in dev
- `biome-ignore-all` removed from `typed-doc.ts`, replaced with targeted inline suppressions
- Bogus `issues/XXX` link removed
- All existing tests pass; new regression test for the null-in-list bug

## The Gap

- `resolveListValue` has no test exercising `null` items in lists
- Shared helpers for `containerGetter`, `getChildTypedRefParams`, and auto-commit suppression don't exist
- TECHNICAL.md's priority description conflates "new doc default" with "legacy doc fallback"

## Transitive Effect Analysis

| Changed Module | Direct Dependents | Transitive Impact |
|---|---|---|
| `value-reader.ts` (`resolveListValue`) | `factory.ts` (PlainValueRef reads) | Any list with nullable value shapes read through PlainValueRef |
| `base.ts` (DiffOverlay removal) | `typed-doc.ts`, `typed-refs/index.ts`, `index.ts` exports | Downstream packages importing `DiffOverlay` from `@loro-extended/change` — must still export from `index.ts` |
| `utils.ts` (new `containerGetter`) | `doc-ref-internals.ts`, `struct-ref-internals.ts`, `record-ref-internals.ts` | No external API change; internal refactor only |
| `base.ts` (`withBatchedCommit`) | `utils.ts` (`assignPlainValueToTypedRef`), `record-ref-internals.ts` | No external API change; behavioral equivalent |
| `struct-ref-internals.ts` / `record-ref-internals.ts` (shared `getChildTypedRefParams`) | Everything that creates struct/record refs | Behavioral equivalent; all existing tests must pass |
| `conversion.ts` (extra key warning) | Used during `convertInputToRef` for list push, record set, etc. | Warning only (no throw), so no breaking change |
| `typed-doc.ts` (biome-ignore removal) | None externally | Internal lint quality only |
| `TECHNICAL.md` | Developers reading docs | Documentation accuracy |

**Key constraint**: All changes are internal refactors or bug fixes. No public API signatures change. The `DiffOverlay` type remains exported from `index.ts` at the same path.

---

## Phase 1: Fix `resolveListValue` null bug ✅

### Tasks

1. **Write a failing test** in `packages/change/src/plain-value-ref/plain-value-ref.test.ts` (or a new co-located test file if more appropriate) that stores `null` in a list via a nullable value shape, reads it back through `resolveListValue`, and asserts it returns `null` (not the container fallback). ✅

   > **Note**: The test passes both before and after the fix because `getListOverlayValue` currently always returns `undefined` (list overlay is a TODO stub). The bug is **latent** — it will manifest when list overlay support is implemented. The test documents the expected contract and the fix aligns with `resolveValue`'s defensive pattern.

2. **Fix `resolveListValue`** in `value-reader.ts` to use explicit `!== undefined` checks matching `resolveValue`'s pattern. The function body becomes:

   ```
   const overlay = getListOverlayValue(internals, index)
   if (overlay !== undefined) return overlay as T
   return getListContainerValue(internals, index) as T | undefined
   ```
   ✅

3. **Run tests** via `pnpm turbo run verify --filter=@loro-extended/change -- logic` and confirm the new test passes and no regressions. ✅ (909/909 passed)

**Resources**: `packages/change/src/plain-value-ref/value-reader.ts`, existing tests in `packages/change/src/plain-value-ref/plain-value-ref.test.ts`

---

## Phase 2: Consolidate `DiffOverlay` to single source ✅

### Tasks

1. **Remove** the `DiffOverlay` type from `typed-refs/base.ts`. ✅

2. **Add import** of `DiffOverlay` from `../diff-overlay.js` in `typed-refs/base.ts` and re-export it so that `typed-refs/index.ts` still exports `DiffOverlay`. ✅

3. **Update** `typed-doc.ts` to import `DiffOverlay` from `./diff-overlay.js` instead of `./typed-refs/base.js`. ✅

4. **Verify** `index.ts` still exports `DiffOverlay` from both `./diff-overlay.js` (direct) and `./typed-refs/index.js` (re-export) — confirm these resolve to the same type. If both paths are exported, remove one to avoid confusion — prefer exporting only from `./diff-overlay.js` in the main `index.ts`, and keep `typed-refs/index.ts` re-export for internal use only. ✅

   > `index.ts` exports `DiffOverlay` only from `./typed-refs/index.js` (which re-exports from `base.js`, which re-exports from `diff-overlay.js`). `createDiffOverlay` is exported directly from `./diff-overlay.js`. No duplicate type export in the public API — clean.

5. **Run `verify`** — types and logic. ✅ (types passed, 909/909 tests passed, format passed 112 files)

**Resources**: `packages/change/src/diff-overlay.ts`, `packages/change/src/typed-refs/base.ts`, `packages/change/src/typed-refs/index.ts`, `packages/change/src/typed-doc.ts`, `packages/change/src/index.ts`

---

## Phase 3: Extract shared `containerGetter` mapping ✅

### Tasks

1. **Add** `containerGetter` as an exported const in `typed-refs/utils.ts`, alongside the existing `containerConstructor`. Use the `satisfies Record<string, keyof LoroDoc>` constraint from `doc-ref-internals.ts`. ✅

2. **Replace** the inline `containerGetter` objects in `struct-ref-internals.ts` and `record-ref-internals.ts` with imports from `./utils.js`. ✅

3. **Replace** the module-level `containerGetter` in `doc-ref-internals.ts` with an import from `./utils.js`. Remove the local `ContainerGetterKey` type and use `keyof typeof containerGetter` from utils. ✅

4. **Run `verify`**. ✅ (format 112 files, types passed, 909/909 tests passed)

**Resources**: `packages/change/src/typed-refs/utils.ts`, `packages/change/src/typed-refs/doc-ref-internals.ts`, `packages/change/src/typed-refs/struct-ref-internals.ts`, `packages/change/src/typed-refs/record-ref-internals.ts`

---

## Phase 4: Extract shared `getChildTypedRefParams` for map-backed refs ✅

The shared logic covers: `hasContainerConstructor` guard → mergeable path (null marker + root container getter) → non-mergeable path (`getOrCreateContainer`). The only varying input is how `placeholder` is resolved.

### Tasks

1. **Create a helper function** `buildChildTypedRefParams` in `typed-refs/utils.ts` that accepts `{ internals: BaseRefInternals<any>, key: string, shape: ContainerShape, placeholder: unknown }` and returns `TypedRefParams<ContainerShape>`. This contains the shared body (hasContainerConstructor check, mergeable branch with null marker + containerGetter, non-mergeable branch with containerConstructor + getOrCreateContainer). ✅

2. **Refactor `StructRefInternals.getChildTypedRefParams`** to compute placeholder as `(this.getPlaceholder() as any)?.[key]` then delegate to `buildChildTypedRefParams`. ✅

3. **Refactor `RecordRefInternals.getChildTypedRefParams`** to compute placeholder with the existing derive-fallback logic, then delegate to `buildChildTypedRefParams`. ✅

4. **Run `verify`** — all mergeable and non-mergeable tests must pass. ✅ (format 112 files, types passed, 909/909 tests passed)

**Resources**: `packages/change/src/typed-refs/struct-ref-internals.ts`, `packages/change/src/typed-refs/record-ref-internals.ts`, `packages/change/src/typed-refs/utils.ts`

---

## Phase 5: Extract `withBatchedCommit` helper 🔴

### Tasks

1. **Add `withBatchedCommit`** method to `BaseRefInternals` in `base.ts`. Signature: `withBatchedCommit(fn: () => void): void`. It encapsulates the suppress/restore/commitIfAuto pattern. 🔴

2. **Replace** the 5 call sites with `this.withBatchedCommit(() => { ... })` or `internals.withBatchedCommit(() => { ... })`:
   - `assignPlainValueToTypedRef` in `utils.ts` (struct/record branch and list branch) 🔴
   - `RecordRefInternals.replace()` 🔴
   - `RecordRefInternals.merge()` 🔴
   - `RecordRefInternals.clear()` 🔴

3. **Run `verify`**. 🔴

**Resources**: `packages/change/src/typed-refs/base.ts`, `packages/change/src/typed-refs/utils.ts`, `packages/change/src/typed-refs/record-ref-internals.ts`

---

## Phase 6: Fix TECHNICAL.md mergeable documentation 🔴

### Tasks

1. **Rewrite** the "Priority Order" and "Backward Compatibility" paragraphs in the "Document Metadata and Reserved Keys" section of `TECHNICAL.md` to clearly distinguish:
   - **New documents** (no metadata): `options.mergeable` > `schema.mergeable` > `true` (default)
   - **Existing documents** (has metadata): metadata.mergeable takes precedence; schema/options ignored
   - **Legacy documents** (no metadata, pre-loro-extended): treated as `mergeable: false` only if `skipInitialize: true` is used; otherwise auto-initialized with the new-document default
   🔴

2. **Add a warning note** about passing `{ doc: existingLoroDoc }` without `skipInitialize: true` — the doc will be auto-initialized with `mergeable: true` if it lacks metadata. Recommend always passing `skipInitialize: true` when wrapping an existing LoroDoc. 🔴

**Resources**: `TECHNICAL.md`, `packages/change/src/typed-doc.ts` (constructor logic for reference)

---

## Phase 7: Smaller cleanups 🔴

### Tasks

1. **`convertStructInput` extra key warning**: Add a `console.warn` in the extra-keys loop in `conversion.ts` when `process.env.NODE_ENV !== 'production'` (or equivalent check). Message: `"convertStructInput: key "${k}" is not in the struct schema and will be ignored by typed access"`. This preserves backward compatibility while surfacing typos during development. 🔴

2. **Remove `biome-ignore-all`** from `typed-doc.ts` line 1. Add targeted `// biome-ignore lint/suspicious/noExplicitAny: <reason>` comments on specific lines that genuinely need `any` (e.g., proxy handler casts, placeholder casts). Inspect each `any` usage and replace with proper types where feasible. 🔴

3. **Fix bogus issue link**: In `overlay-recursion.test.ts` ~L258, remove the `@see https://github.com/loro-dev/loro-extended/issues/XXX` line. 🔴

4. **Run full `verify`**: `pnpm turbo run verify --filter=@loro-extended/change`. 🔴

**Resources**: `packages/change/src/conversion.ts`, `packages/change/src/typed-doc.ts`, `packages/change/src/overlay-recursion.test.ts`

---

## Tests

| Test | Location | What it validates |
|---|---|---|
| `resolveListValue` null preservation | `plain-value-ref/plain-value-ref.test.ts` (or new sibling) | Store `null` in list with nullable shape, read via PlainValueRef, assert `null` returned |
| Existing mergeable tests | `mergeable-flattened.test.ts`, `flattened-containers.test.ts` | No regressions from `containerGetter` extraction or `getChildTypedRefParams` refactor |
| Existing change tests | `change.test.ts` | No regressions from `withBatchedCommit` extraction |
| Existing overlay tests | `overlay-recursion.test.ts`, `diff-overlay.test.ts` | No regressions from `DiffOverlay` consolidation |
| Type compilation | `verify -- types` | `DiffOverlay` re-export resolves correctly; no new type errors from `biome-ignore-all` removal |

No new integration tests needed — all changes are internal refactors or bug fixes verified by existing test suites.

---

## Changeset

A patch changeset is appropriate for `@loro-extended/change`:

> **@loro-extended/change** (patch)
>
> - Fixed `resolveListValue` dropping `null` values in lists with nullable shapes
> - Consolidated `DiffOverlay` type to single canonical definition
> - Extracted shared `containerGetter` mapping and `buildChildTypedRefParams` helper to reduce duplication
> - Added `withBatchedCommit` helper to `BaseRefInternals` replacing 5 copy-pasted suppress/restore patterns
> - Improved struct conversion warning for extra keys not in schema
> - Fixed TECHNICAL.md documentation for mergeable priority order
> - Removed blanket `biome-ignore-all` from `typed-doc.ts`

---

## Documentation Updates

| Document | Update |
|---|---|
| `TECHNICAL.md` | Rewrite mergeable priority section (Phase 6) |
| `TECHNICAL.md` | Add note about `withBatchedCommit` pattern in "Batch Assignment and Subscription Timing" section |
| `TECHNICAL.md` | Add note about `containerGetter` and `buildChildTypedRefParams` in "Key Internal Methods" table |
| `README.md` | No changes needed — all fixes are internal |