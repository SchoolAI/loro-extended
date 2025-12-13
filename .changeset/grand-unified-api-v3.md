---
"@loro-extended/change": minor
"@loro-extended/hooks-core": minor
"@loro-extended/repo": minor
"@loro-extended/react": minor
---

# Grand Unified API v3: Proxy-based TypedDoc with $ namespace

This release transforms the `@loro-extended/change` API to provide a cleaner, more intuitive interface for working with typed Loro documents.

## Breaking Changes

### New Proxy-based API

TypedDoc is now a Proxy that allows direct access to schema properties:

```typescript
// Before (old API)
doc.value.title.insert(0, "Hello")
doc.value.count.increment(5)
doc.batch(draft => { ... })
doc.loroDoc

// After (new API)
doc.title.insert(0, "Hello")
doc.count.increment(5)
batch(doc, draft => { ... })
getLoroDoc(doc)
```

### Meta-operations via `$` namespace

All internal meta-operations can be accessed via the `$` property:

- `doc.$.batch(fn)` - Batch multiple mutations into a single transaction
- `doc.$.change(fn)` - Deprecated alias for `batch()`
- `doc.$.rawValue` - Get raw CRDT state without placeholders
- `doc.$.loroDoc` - Access underlying LoroDoc

### Direct Schema Access

Schema properties are accessed directly on the doc object:

```typescript
// Direct mutations - commit immediately
doc.title.insert(0, "Hello")
doc.count.increment(5)
doc.users.set("alice", { name: "Alice" })

// Check existence
doc.users.has("alice")  // true
"alice" in doc.users    // true (via Proxy has trap)
```

## Migration Guide

1. Replace `doc.value.` with `doc.`:
   - `doc.value.title` → `doc.title`
   - `doc.value.count` → `doc.count`

2. Replace `doc.` meta-operations with `batch()` and `getLoroDoc()` (preferred), or if needed, you can reach into internal properties:
   - `doc.batch()` → `doc.$.batch()`
   - `doc.change()` → `doc.$.change()` (deprecated, use `$.batch()`)
   - `doc.rawValue` → `doc.$.rawValue`
   - `doc.loroDoc` → `doc.$.loroDoc`

## Other Changes

- Updated `TypedDocHandle` to use new API internally
- Updated `useDoc` hook types to use `Infer<D>` instead of `DeepReadonly<Infer<D>>`