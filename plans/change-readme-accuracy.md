# Plan: Fix `@loro-extended/change` README Accuracy

## Background

The `@loro-extended/change` package has a three-function API architecture:

- **`loro()`** — Returns native Loro types directly (LoroDoc, LoroText, LoroList, etc.)
- **`ext()`** — Returns loro-extended feature namespaces (fork, subscribe, change, doc, etc.)
- **`change()`** — Standalone functional helper for batched mutations

The README was written during an earlier API iteration and contains numerous inaccuracies that don't match the current implementation. These errors would cause users to write non-functional code.

## Problem Statement

The README contains **5 critical errors** (code that won't compile or will throw at runtime), **2 significant inaccuracies** (misleading API surface descriptions), and **several omissions** of important features. The most pervasive error is `doc.change(fn)` which appears ~15 times throughout the README but does not exist on the `TypedDoc` proxy.

## Success Criteria

1. Every code example in the README compiles and runs correctly against the actual API
2. The `loro()` / `ext()` / `change()` three-function architecture is accurately described
3. The `createTypedDoc` signature matches the actual options-based API
4. All referenced exports (`Infer`, `createTypedDoc`, `change`, `loro`, `ext`) match `index.ts`
5. No references to non-existent exports (`getLoroDoc`, `InferPlainType`)
6. Undocumented features (commit messages, mergeable docs, `ext()`) are at least mentioned
7. Existing tests continue to pass (`pnpm turbo run verify --filter=@loro-extended/change`)

## The Gap

### Critical Errors (code won't work)

| # | README Claim | Actual API | Occurrences |
|---|---|---|---|
| 1 | `doc.change((draft) => {...})` | `change(doc, draft => {...})` or `ext(doc).change(draft => {...})` | ~15 places |
| 2 | `loro(ref).doc`, `loro(ref).container`, `loro(ref).subscribe(cb)` | `loro()` returns native type directly; `.doc` and `.subscribe` are on `ext(ref)` | §"The loro() Escape Hatch", API tables |
| 3 | `import { getLoroDoc } from "@loro-extended/change"` | Not exported. Use `loro(doc)` instead | §"Integration with Existing Loro Code" |
| 4 | `import { InferPlainType } from "@loro-extended/change"` | Not exported. Use `Infer<T>` instead | §"Type Safety" |
| 5 | `createTypedDoc(schema, existingLoroDoc)` | `createTypedDoc(schema, { doc: existingLoroDoc })` | §"API Reference", §"Integration" |

### Significant Inaccuracies

| # | Issue | Details |
|---|---|---|
| 6 | API surface tables for `loro()` are wrong | Tables list `subscribe`, `doc`, `container` under `loro()` — these are on `ext()` or are the native type itself |
| 7 | "Loro Compatible" tagline says `loro(doc).doc` | Should say `loro(doc)` returns a `LoroDoc` directly |

### Syntax Errors in Code Examples

| # | Location | Issue |
|---|---|---|
| 8 | Line 504 | `draft.articles.[0]?.title` — extra dot before `[0]` |
| 9 | Line 433 | Missing closing quote: `placeholder("Anonymous)` |

### Omissions

| # | Feature | Status |
|---|---|---|
| 10 | `ext()` function | Major API function, barely mentioned |
| 11 | `ChangeOptions` / `commitMessage` | Implemented but undocumented |
| 12 | Mergeable documents (`{ mergeable: true }`) | Implemented but undocumented |
| 13 | `CreateTypedDocOptions` full interface | Only `doc` param shown, not `overlay`, `mergeable`, `skipInitialize` |

## Transitive Effect Analysis

- **`packages/repo`** — [`handle.ts`](packages/repo/src/handle.ts:388) has a comment referencing `getLoroDoc()`. This is a comment only, not code, but should be updated for consistency.
- **`packages/change` tests** — [`functional-helpers.test.ts`](packages/change/src/functional-helpers.test.ts:182) has a test section titled `"loro(ref).doc"` but the test body correctly uses `ext(ref).doc`. The test name is misleading but the test itself is correct — no code change needed, but the describe label should be fixed.
- **Examples** — Example apps in `examples/` may use patterns from the README. These should be checked but are out of scope for this plan (they have their own READMEs).
- **`packages/change/src/shape.ts`** — Line 579 has a backwards deprecation comment: "Use `Shape.struct` instead. `Shape.struct` will be removed in a future version." Should say `Shape.map` will be removed.

## Phases and Tasks

### Phase 1: Fix Critical API Errors in README ✅

- [x] ✅ Replace all `doc.change((draft) => {...})` with `change(doc, draft => {...})` throughout the README (~15 occurrences)
- [x] ✅ Rewrite "The `loro()` Escape Hatch" section to accurately describe that `loro()` returns native Loro types directly
- [x] ✅ Add a new "The `ext()` Function" section documenting the `ext()` API (fork, forkAt, shallowForkAt, subscribe, doc, change, applyPatch, docShape, rawValue, mergeable)
- [x] ✅ Rewrite all API surface tables (ListRef, StructRef, RecordRef, TextRef, CounterRef, TypedDoc) to correctly split between direct access, `loro()`, and `ext()`
- [x] ✅ Fix "Integration with Existing Loro Code" section: remove `getLoroDoc`, use `loro(typedDoc)` instead
- [x] ✅ Fix "Type Safety" section: replace `InferPlainType` with `Infer`
- [x] ✅ Fix `createTypedDoc` signature documentation to show options object: `createTypedDoc(schema, { doc: existingLoroDoc })`
- [x] ✅ Fix "Why Use change?" tagline: `loro(doc).doc` → `loro(doc)` returns a LoroDoc directly
- [x] ✅ Fix "Subscribing to Ref Changes" section: `loro(textRef).subscribe(...)` → show that `loro(textRef)` returns `LoroText` and you call `.subscribe()` on it natively (which is correct), but clarify the distinction

### Phase 2: Fix Syntax Errors and Minor Issues ✅

- [x] ✅ Fix `draft.articles.[0]` → `draft.articles[0]` (line 504)
- [x] ✅ Fix missing closing quote `placeholder("Anonymous)` → `placeholder("Anonymous")` (line 433)
- [x] ✅ Fix "When to Use" table to show correct syntax consistently: `change(doc, d => {...})` and `change(ref, d => {...})`

### Phase 3: Document Omitted Features ✅

- [x] ✅ Add `ChangeOptions` / `commitMessage` documentation (brief section showing string and object commit messages)
- [x] ✅ Document `CreateTypedDocOptions` full interface (`doc`, `mergeable`, `skipInitialize`)
- [x] ✅ Add brief mention of mergeable documents with `Shape.doc({...}, { mergeable: true })`

### Phase 4: Fix Transitive Issues ✅

- [x] ✅ Fix test describe label in [`functional-helpers.test.ts`](packages/change/src/functional-helpers.test.ts:182): `"loro(ref).doc"` → `"ext(ref).doc"`
- [x] ✅ Fix comment in [`packages/repo/src/handle.ts`](packages/repo/src/handle.ts:388): `getLoroDoc()` → `loro(doc)`
- [x] ✅ Fix backwards deprecation comment in [`shape.ts`](packages/change/src/shape.ts:579): should say `Shape.map` will be removed, not `Shape.struct`
- [x] ✅ Fix JSDoc comment in [`typed-doc.ts`](packages/change/src/typed-doc.ts:372): `loro(doc).doc` → `loro(doc)` returns LoroDoc directly

### Phase 5: Verify ✅

- [x] ✅ Run `pnpm turbo run verify --filter=@loro-extended/change` — 747/747 tests pass
- [x] ✅ Run `pnpm turbo run verify --filter=@loro-extended/repo` — 709/709 tests pass
- [x] ✅ Spot-check that every code example in the README would compile against the actual exports from `index.ts`
