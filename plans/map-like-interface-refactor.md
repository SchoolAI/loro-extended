# Map-like Interface Refactor Plan

> **⚠️ SUPERSEDED**: This plan has evolved into the [`loro()` API Refactor Plan](./loro-api-refactor.md), which provides a cleaner solution to the namespace collision problem while preserving JavaScript-native behavior on refs.

## Problem Statement

The loro-extended/change API uses property assignment (`doc.settings.darkMode = true`) for StructRef and RecordRef, which creates two problems:

1. **Namespace collision**: Every property name could be user data, so methods like `loroDoc`, `loroContainer`, and `subscribe()` cannot live directly on the ref. This forced the creation of a `$` escape hatch (`ref.$.loroDoc`).

2. **Two-step mutation failure**: Property assignment only works correctly inside `change()` blocks due to JavaScript limitations with proxy propagation:

```typescript
// FAILS outside change():
const item = doc.items.find((i) => i.valuable);
item.property = false; // Lost! No proxy, no tracking
```

## Solution: Hybrid Approach

**Keep property-based navigation, use methods for leaf mutations.**

```typescript
// Navigation via properties (unchanged)
draft.outer.inner;

// Mutation via methods (new)
draft.outer.inner.set("value", 100);
draft.outer.inner.get("value"); // 100
```

This approach:

- Preserves ergonomic property navigation with TypeScript autocomplete
- Only changes leaf mutations where the proxy problem exists
- Enables methods like `loroDoc` to live directly on refs (no namespace collision with `get()`/`set()`)
- Simple codemod: replace `X.property = value` with `X.set('property', value)`

## Background Information

### Current Architecture

The codebase has three layers of complexity to support property assignment:

1. **Proxy Handlers** ([`proxy-handlers.ts`](../packages/change/src/typed-refs/proxy-handlers.ts))

   - `recordProxyHandler` intercepts `record.key = value`
   - `listProxyHandler` intercepts `list[0] = value`

2. **Lazy Property Definition** ([`struct.ts:132-154`](../packages/change/src/typed-refs/struct.ts))

   - `createLazyProperties()` uses `Object.defineProperty` for each schema key
   - Enables `struct.property = value` syntax

3. **Batched Mutation Caching** (multiple files)
   - `batchedMutation` flag enables caching inside `change()` blocks
   - `propertyCache`, `refCache`, `itemCache` track mutations
   - `absorbPlainValues()` writes cached values back to CRDT at end of `change()`

### Escape Hatch

The `$` property ([`base.ts:67-84`](../packages/change/src/typed-refs/base.ts)) provides access to:

- `loroDoc` - the underlying LoroDoc
- `loroContainer` - the underlying Loro container
- `subscribe(cb)` - container-level change subscription

### Existing Map-like Methods

Both StructRef and RecordRef already have Map-like methods:

- `get(key)`, `set(key, value)`, `delete(key)`, `has(key)`, `keys()`, `values()`, `size`

These work correctly everywhere, including outside `change()` blocks.

## The Gap

| Capability               | Property Assignment  | Hybrid (Navigation + Methods) |
| ------------------------ | -------------------- | ----------------------------- |
| Works outside `change()` | ❌ (two-step fails)  | ✅                            |
| Works with autoCommit    | ❌ (limited)         | ✅                            |
| Methods on ref           | ❌ (need `$` escape) | ✅                            |
| Property navigation      | ✅                   | ✅ (preserved)                |
| TypeScript autocomplete  | ✅                   | ✅ (preserved for navigation) |
| Setter complexity        | Required             | Removed                       |
| Cache complexity         | Required             | Simplified                    |

## Success Criteria

### Functional Requirements

1. **Property navigation preserved**

   ```typescript
   doc.outer.inner; // Still works, returns StructRef
   ```

2. **Leaf mutations use `get()`/`set()`**

   ```typescript
   doc.outer.inner.set("value", 100); // Works everywhere
   doc.outer.inner.get("value"); // Returns 100
   ```

3. **Methods live directly on refs** (no `$` escape hatch needed)

   ```typescript
   doc.settings.loroDoc; // Direct access
   doc.settings.subscribe(cb); // Direct subscription
   ```

4. **`change()` remains available** for batching and atomic undo

   ```typescript
   change(doc, (draft) => {
     draft.outer.inner.set("a", 1);
     draft.outer.inner.set("b", 2);
   }); // Single commit, single undo step
   ```

5. **Fully-typed `get()`/`set()` for StructRef**
   ```typescript
   // TypeScript knows 'darkMode' exists and is boolean
   doc.settings.get("darkMode"); // boolean
   doc.settings.set("darkMode", true); // type-checked
   ```

### Non-Functional Requirements

1. **Reduced code complexity** - remove setter logic, simplify caching
2. **Improved TypeScript types** - fully-typed `get()`/`set()` methods
3. **Better error messages** - no more silent failures from proxy issues

## Dependency Analysis

### Direct Dependencies

```
TypedDoc
  └── DocRef
        └── StructRef, RecordRef, ListRef, TextRef, CounterRef, TreeRef
              └── TypedRef (base class)
                    └── RefMetaNamespace ($) [to be removed]
```

### Transitive Dependencies (Breaking Change Risk)

1. **Tests** - 268+ usages of `change()` and property assignment patterns

   - Tests using `draft.property = value` need migration to `draft.set('property', value)`
   - Tests using `doc.property` for reading can stay (navigation preserved)

2. **Examples** - `hono-counter`, `todo-sse`, `todo-websocket`

   - Need to update leaf mutations to use `set()`

3. **External Consumers** - any code using property assignment for mutation

   - Breaking change requires major version bump

4. **TreeNodeRef** ([`tree-node.ts`](../packages/change/src/typed-refs/tree-node.ts))

   - Uses StructRef for `.data` property
   - Will inherit `get()`/`set()` interface automatically

5. **JSON Patch** ([`json-patch.ts`](../packages/change/src/typed-refs/../json-patch.ts))

   - Uses property assignment internally
   - Needs update to use `set()`

6. **Conversion utilities** ([`conversion.ts`](../packages/change/src/conversion.ts))

   - Creates containers from plain values
   - No changes needed (doesn't use property assignment)

7. **Overlay system** ([`overlay.ts`](../packages/change/src/overlay.ts))
   - Merges placeholders with CRDT values
   - No changes needed (read-only)

## Implementation Phases

**Note**: This is an internal-only change. No deprecation period needed - all changes in one release.

### Phase 1: Add Direct Methods to Refs

- [ ] Add `loroDoc`, `loroContainer`, `subscribe()` directly to TypedRef base class
- [ ] Remove `$` escape hatch from TypedRef
- [ ] Update `getLoroDoc()` and `getLoroContainer()` functional helpers

### Phase 2: Add Fully-Typed `get()`/`set()` Methods to StructRef

- [ ] `get<K extends keyof Shapes>(key: K): Shapes[K]['_mutable']`
- [ ] `set<K extends keyof Shapes>(key: K, value: Shapes[K]['_plain']): void`
- [ ] Ensure TypeScript inference works correctly with autocomplete

### Phase 3: Modify StructRef Property Access

- [ ] Keep property getters in `createLazyProperties()` (for navigation)
- [ ] Remove property setters from `createLazyProperties()`
- [ ] Remove `propertyCache` for value shapes (container refs still cached)
- [ ] Simplify `absorbPlainValues()` - only needed for nested container refs

### Phase 4: Modify RecordRef Property Access

- [ ] Keep `recordProxyHandler` get trap (for navigation to nested containers)
- [ ] Remove `recordProxyHandler` set trap
- [ ] Remove `refCache` for value shapes (container refs still cached)
- [ ] Keep `get()`, `set()`, `delete()`, `has()`, `keys()` methods

### Phase 5: Keep ListRef Index Access

- [ ] Keep `listProxyHandler` for index access (`list[0]`) - convenient for both read and write
- [ ] Simplify `itemCache` - only needed for container refs, not value caching

### Phase 6: Update Internal Code

- [ ] Update JSON Patch to use `set()` instead of property assignment
- [ ] Update all tests: `draft.property = value` → `draft.set('property', value)`
- [ ] Update examples

### Phase 7: Simplify TypedDoc

- [ ] Move `$.change()` to `doc.change()` directly
- [ ] Move `$.loroDoc` to `doc.loroDoc` directly
- [ ] Simplify TypedDoc proxy (only needs to add `change()`, `loroDoc`, `toJSON()`)

## Files to Modify

| File                           | Changes                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `typed-refs/base.ts`           | Add `loroDoc`, `loroContainer`, `subscribe()` directly; remove `$`               |
| `typed-refs/struct.ts`         | Add typed `get()`/`set()`; remove setters from lazy properties; simplify caching |
| `typed-refs/record.ts`         | Remove set trap; simplify caching                                                |
| `typed-refs/list-base.ts`      | Simplify caching (keep index access)                                             |
| `typed-refs/proxy-handlers.ts` | Remove set traps from `recordProxyHandler`                                       |
| `typed-refs/utils.ts`          | Keep proxy wrapping (for navigation)                                             |
| `typed-doc.ts`                 | Move `change()`, `loroDoc` to main object; simplify proxy                        |
| `functional-helpers.ts`        | Update `getLoroDoc()`, `getLoroContainer()` to not use `$`                       |
| `json-patch.ts`                | Use `set()` instead of assignment                                                |
| All `*.test.ts` files          | Migrate leaf mutations to `set()` syntax                                         |
| Examples                       | Migrate leaf mutations to `set()` syntax                                         |

## Codemod Pattern

The migration is straightforward:

```typescript
// Before
draft.outer.inner.value = 100;

// After
draft.outer.inner.set("value", 100);
```

Pattern: Replace `X.property = value` with `X.set('property', value)` where `X` is a StructRef or RecordRef.

For reads that need the new API:

```typescript
// Before (still works for navigation)
draft.outer.inner.value;

// After (explicit get)
draft.outer.inner.get("value");
```

## Risks and Mitigations

| Risk                          | Mitigation                                                |
| ----------------------------- | --------------------------------------------------------- |
| Breaking change for consumers | Internal-only, major version bump                         |
| Large test migration          | Simple regex-based codemod                                |
| Performance regression        | Benchmark before/after; expect improvement (less caching) |
| Missing edge cases            | Comprehensive test coverage already exists                |
| TypeScript complexity         | Test type inference thoroughly                            |
