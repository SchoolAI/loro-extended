# Plan: Simplify Change API by Removing TYPED_DOC_CHANGE_SYMBOL

## Background

The recent "Extended Function API Follow-up" implementation removed `ext(doc).change()` and `Handle.change()` to consolidate mutation to a single `change(doc, fn)` helper. However, this required introducing a new `TYPED_DOC_CHANGE_SYMBOL` to allow the functional helper to access the internal change method on TypedDoc.

This created symbol proliferation:
- `LORO_SYMBOL` - for `loro()` access
- `EXT_SYMBOL` - for `ext()` access
- `TYPED_DOC_CHANGE_SYMBOL` - for internal change access (new)

## Problem Statement

The `TYPED_DOC_CHANGE_SYMBOL` adds complexity without clear benefit. It's a backdoor that bypasses the public API and exists solely to support the `change()` functional helper. A simpler approach is to re-introduce `ext(doc).change()` as the underlying implementation, while keeping `change(doc, fn)` as the recommended API in documentation and examples.

## Success Criteria

1. ✅ `TYPED_DOC_CHANGE_SYMBOL` is removed
2. ✅ `ext(doc).change()` is re-introduced (low-key, not prominently documented)
3. ✅ `change(doc, fn)` functional helper continues to work (delegates to `ext(doc).change()`)
4. ✅ `Handle.change()` remains removed (use `change(handle.doc, fn)`)
5. ✅ All existing tests pass
6. ✅ No new symbols introduced

---

## The Gap

### Current State

```typescript
// functional-helpers.ts
const changeMethod = (target as any)[TYPED_DOC_CHANGE_SYMBOL]
if (changeMethod) {
  return changeMethod(fn)
}
```

### Target State

```typescript
// functional-helpers.ts
const extNs = (target as any)[EXT_SYMBOL]
if (extNs && "change" in extNs) {
  return extNs.change(fn)
}
```

---

## Phases and Tasks

### Phase 1: Re-introduce `ext(doc).change()` ✅

- ✅ Update `packages/change/src/ext.ts`:
  - Add `change` method back to `ExtDocRef` interface
  
- ✅ Update `packages/change/src/typed-doc.ts`:
  - Add `change` method to the ext namespace object
  - Method should delegate to `internal.change(fn)` and return the proxy

### Phase 2: Update `change()` Functional Helper ✅

- ✅ Update `packages/change/src/functional-helpers.ts`:
  - Replace `TYPED_DOC_CHANGE_SYMBOL` check with `EXT_SYMBOL` check
  - Call `extNs.change(fn)` instead of `changeMethod(fn)`
  - Remove `TYPED_DOC_CHANGE_SYMBOL` import

### Phase 3: Remove `TYPED_DOC_CHANGE_SYMBOL` ✅

- ✅ Update `packages/change/src/typed-refs/base.ts`:
  - Remove `TYPED_DOC_CHANGE_SYMBOL` export
  
- ✅ Update `packages/change/src/typed-doc.ts`:
  - Remove `TYPED_DOC_CHANGE_SYMBOL` import
  - Remove the proxy handler case for `TYPED_DOC_CHANGE_SYMBOL`

### Phase 4: Update Changeset ✅

- ✅ Update `.changeset/remove-ext-change-and-handle-change.md`:
  - Remove mention of `ext(doc).change()` being removed
  - Keep `Handle.change()` removal documented
  - Note that `change(doc, fn)` is the recommended API

---

## Unit and Integration Tests

No new tests needed. The existing tests in:
- `packages/change/src/ext.test.ts` - already tests `ext()` API surface
- `packages/change/src/functional-helpers.test.ts` - already tests `change()` helper
- `packages/change/src/loro.test.ts` - already tests `change()` helper

All tests should continue to pass since the public API (`change(doc, fn)`) remains unchanged.

---

## Transitive Effect Analysis

### Direct Dependencies

```
change() functional helper
└── ext(doc).change() (re-introduced)
    └── TypedDocInternal.change()
```

### Affected Packages

1. **`@loro-extended/change`**: Internal implementation change only
2. **No other packages affected**: The public API (`change(doc, fn)`) remains unchanged

### Risk Assessment

**Low risk** - This is a simplification that:
- Removes a symbol
- Re-uses existing infrastructure (`ext()`)
- Doesn't change any public API behavior

---

## Changeset Update

The existing changeset should be updated to reflect that `ext(doc).change()` is still available (but not prominently documented):

```markdown
---
"@loro-extended/change": major
"@loro-extended/repo": major
---

# Breaking: Remove `Handle.change()`

## Breaking Changes

### `Handle.change()` removed

Use `change(handle.doc, fn)` instead:

Before:
```typescript
handle.change((draft) => {
  draft.title.insert(0, "Hello");
});
```

After:
```typescript
import { change } from "@loro-extended/change";

change(handle.doc, (draft) => {
  draft.title.insert(0, "Hello");
});
```

## Recommended API

The `change(doc, fn)` functional helper is the recommended way to mutate documents:

```typescript
import { change } from "@loro-extended/change";

change(doc, (draft) => {
  draft.title.insert(0, "Hello");
  draft.count.increment(5);
});
```

## Migration Guide

1. Replace `handle.change(fn)` with `change(handle.doc, fn)`
2. Ensure `change` is imported from `@loro-extended/change`
```

---

## Summary

This plan simplifies the implementation by removing `TYPED_DOC_CHANGE_SYMBOL` and re-using the existing `ext()` infrastructure. The `change(doc, fn)` functional helper remains the recommended API, but `ext(doc).change()` is available for users who prefer the method-chaining style. This reduces complexity without changing the public API behavior.
