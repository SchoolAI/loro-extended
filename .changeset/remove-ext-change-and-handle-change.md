---
"@loro-extended/change": major
"@loro-extended/repo": major
---

# Breaking: Major API Simplification

This release introduces significant breaking changes to simplify the loro-extended API. The changes consolidate mutation patterns, simplify native Loro access, and remove redundant APIs.

## Summary of Breaking Changes

1. **`Handle.change()` removed** - Use `change(handle.doc, fn)` instead
2. **`loro()` now returns native types directly** - No more `.doc` or `.container` indirection
3. **`ext(ref).change()` removed** - Use `change(ref, fn)` instead
4. **`getLoroDoc()` removed** - Use `loro(doc)` instead
5. **`loro(ref).doc` removed** - Use `ext(ref).doc` instead
6. **`loro(ref).container` removed** - Use `loro(ref)` directly

---

## Breaking Change Details

### 1. `Handle.change()` Removed

The `Handle.change()` method has been removed from `@loro-extended/repo` to narrow its focus as a handle. Use the `change()` functional helper instead.

**Before:**

```typescript
handle.change((draft) => {
  draft.title.insert(0, "Hello");
  draft.count.increment(5);
});
```

**After:**

```typescript
import { change } from "@loro-extended/change";

change(handle.doc, (draft) => {
  draft.title.insert(0, "Hello");
  draft.count.increment(5);
});
```

### 2. `loro()` Returns Native Types Directly

The `loro()` function now returns native Loro types directly, without the `.doc` or `.container` indirection.

**Before:**

```typescript
// For TypedDoc
const loroDoc = loro(doc).doc;
const frontiers = loro(doc).doc.frontiers();
loro(doc).doc.subscribe(callback);
loro(doc).doc.import(bytes);

// For TypedRef
const loroText = loro(textRef).container;
const loroList = loro(listRef).container;
```

**After:**

```typescript
// For TypedDoc - loro() returns LoroDoc directly
const loroDoc = loro(doc);
const frontiers = loro(doc).frontiers();
loro(doc).subscribe(callback);
loro(doc).import(bytes);

// For TypedRef - loro() returns the container directly
const loroText = loro(textRef); // Returns LoroText
const loroList = loro(listRef); // Returns LoroList
```

### 3. `loro(ref).change()` Removed

The `change()` method has been deprecated from the `loro()` namespace for refs. Use the `change()` functional helper instead.

**Before:**

```typescript
loro(ref).change((draft) => {
  // mutations
});
```

**After:**

```typescript
import { change } from "@loro-extended/change";

change(ref, (draft) => {
  // mutations
});
```

### 4. `getLoroDoc()` Removed

The `getLoroDoc()` function has been removed. Use `loro(doc)` directly.

**Before:**

```typescript
import { getLoroDoc } from "@loro-extended/change";

const loroDoc = getLoroDoc(typedDoc);
```

**After:**

```typescript
import { loro } from "@loro-extended/change";

const loroDoc = loro(typedDoc);
```

### 5. Accessing LoroDoc from Refs

To get the underlying `LoroDoc` from a ref, use `ext(ref).doc` instead of `loro(ref).doc`. This belongs on `ext()` because loro's native containers don't point back to their LoroDoc.

**Before:**

```typescript
const loroDoc = loro(textRef).doc;
```

**After:**

```typescript
import { ext } from "@loro-extended/change";

const loroDoc = ext(textRef).doc;
```

---

## Migration Guide

### Step-by-Step Migration

1. **Update imports:**

   ```typescript
   // Add these imports where needed
   import { change, loro, ext } from "@loro-extended/change";
   ```

2. **Replace `handle.change(fn)` with `change(handle.doc, fn)`:**

   ```bash
   # Find all usages
   grep -r "handle\.change(" --include="*.ts" --include="*.tsx"
   ```

3. **Replace `loro(x).doc` with `loro(x)`:**

   ```bash
   # Find all usages
   grep -r "loro(.*).doc" --include="*.ts" --include="*.tsx"
   ```

4. **Replace `loro(ref).container` with `loro(ref)`:**

   ```bash
   # Find all usages
   grep -r "loro(.*).container" --include="*.ts" --include="*.tsx"
   ```

5. **Replace `getLoroDoc(x)` with `loro(x)`:**

   ```bash
   # Find all usages
   grep -r "getLoroDoc(" --include="*.ts" --include="*.tsx"
   ```

6. **Replace `loro(ref).doc` with `ext(ref).doc`:**

   ```bash
   # For refs (not docs), use ext() to access the LoroDoc
   # Before: loro(textRef).doc
   # After: ext(textRef).doc
   ```

### Common Patterns

| Old Pattern                   | New Pattern               |
| ----------------------------- | ------------------------- |
| `handle.change(fn)`           | `change(handle.doc, fn)`  |
| `loro(doc).doc`               | `loro(doc)`               |
| `loro(doc).doc.frontiers()`   | `loro(doc).frontiers()`   |
| `loro(doc).doc.subscribe(cb)` | `loro(doc).subscribe(cb)` |
| `loro(doc).doc.import(bytes)` | `loro(doc).import(bytes)` |
| `loro(doc).doc.export(opts)`  | `loro(doc).export(opts)`  |
| `loro(ref).container`         | `loro(ref)`               |
| `loro(ref).doc`               | `ext(ref).doc`            |
| `getLoroDoc(doc)`             | `loro(doc)`               |
| `ext(ref).change(fn)`         | `change(ref, fn)`         |

---

## Recommended API

### Mutations

The `change(doc, fn)` functional helper is the canonical way to mutate documents:

```typescript
import { change } from "@loro-extended/change";

// Mutate a TypedDoc
change(doc, (draft) => {
  draft.title.insert(0, "Hello");
  draft.count.increment(5);
  draft.items.push("new item");
});

// Mutate via a Handle
change(handle.doc, (draft) => {
  draft.title.insert(0, "Hello");
});
```

Note: `ext(doc).change(fn)` is also available for method-chaining scenarios, but `change(doc, fn)` is preferred.

### Native Loro Access

Use `loro()` to access native Loro types:

```typescript
import { loro } from "@loro-extended/change";

// Get LoroDoc from TypedDoc
const loroDoc = loro(doc);
const frontiers = loro(doc).frontiers();
const version = loro(doc).version();

// Get native containers from refs
const loroText: LoroText = loro(doc.title);
const loroList: LoroList = loro(doc.items);
const loroCounter: LoroCounter = loro(doc.count);
```

### Extended Features

Use `ext()` for loro-extended-specific features:

```typescript
import { ext } from "@loro-extended/change";

// Document-level features
ext(doc).fork(); // Fork the TypedDoc
ext(doc).forkAt(frontiers); // Fork TypedDoc at specific version
ext(doc).shallowForkAt(frontiers); // Shallow fork of TypedDoc
ext(doc).initialize(); // Initialize metadata
ext(doc).applyPatch(patch); // Apply JSON patch
ext(doc).docShape; // Get the schema
ext(doc).rawValue; // Get raw JSON value, no overlay or diff
ext(doc).mergeable; // Check mergeable flag
ext(doc).subscribe(callback); // Subscribe to changes

// Ref-level features
ext(ref).doc; // Get LoroDoc from any ref
ext(ref).subscribe(callback); // Subscribe to ref changes
ext(listRef).pushContainer(c); // Push container to list
ext(listRef).insertContainer(i, c); // Insert container at index
ext(mapRef).setContainer(key, c); // Set container on map
```

---

## Rationale

These changes simplify the API by:

1. **Consolidating mutation patterns** - One canonical way to mutate: `change(doc, fn)`
2. **Removing indirection** - `loro()` returns native types directly, no `.doc` or `.container`
3. **Clear separation** - `loro()` for native Loro access, `ext()` for loro-extended features
4. **Reducing cognitive load** - Fewer ways to do the same thing

The previous API had multiple ways to mutate documents (`handle.change()`, `ext(doc).change()`, `change(doc, fn)`) and required extra property access to get native types (`loro(doc).doc`). The new API is more consistent and easier to learn.
