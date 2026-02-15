# Migration Guide: v5.x to v6.x

This guide covers all breaking changes when upgrading from loro-extended v5.x to v6.x.

## Overview

The v6 release is a major API simplification that:

- Replaces the `Handle` class with a simpler `Doc<D>` + `sync()` pattern
- Consolidates mutation through the `change()` function
- Simplifies `loro()` to return native Loro types directly
- Defaults documents to `mergeable: true` storage mode

---

## Quick Reference

| v5 (deprecated)              | v6 (current)                            |
| ---------------------------- | --------------------------------------- |
| `repo.getHandle(id, schema)` | `repo.get(id, schema)`                  |
| `handle.doc.field`           | `doc.field`                             |
| `handle.waitForSync()`       | `sync(doc).waitForSync()`               |
| `handle.presence`            | `sync(doc).presence`                    |
| `useHandle(id, schema)`      | `useDocument(id, schema)`               |
| `useDoc(handle)`             | `useValue(doc)`                         |
| `useRefValue(ref)`           | `useValue(ref)` + `usePlaceholder(ref)` |
| `Shape.map({...})`           | `Shape.struct({...})`                   |
| `Shape.plain.object({...})`  | `Shape.plain.struct({...})`             |
| `loro(doc).doc`              | `loro(doc)`                             |
| `loro(ref).container`        | `loro(ref)`                             |
| `handle.change(fn)`          | `change(doc, fn)`                       |
| `lens.change(fn)`            | `change(lens, fn)`                      |

---

## 1. Handle → Doc Migration

The `Handle` class has been removed. Documents are now accessed directly via `repo.get()`.

### Before (v5)

```typescript
import { Repo } from "@loro-extended/repo"

const repo = new Repo({ adapters: [...] })
const handle = repo.getHandle("my-doc", DocSchema, { presence: PresenceSchema })

// Access document
handle.doc.title.insert(0, "Hello")

// Wait for sync
await handle.waitForSync()

// Access presence
handle.presence.setSelf({ status: "online" })

// Get snapshot
const snapshot = handle.doc.toJSON()
```

### After (v6)

```typescript
import { Repo, sync } from "@loro-extended/repo"

const repo = new Repo({ adapters: [...] })
const doc = repo.get("my-doc", DocSchema, { presence: PresenceSchema })

// Access document directly (no .doc needed)
doc.title.insert(0, "Hello")

// Wait for sync via sync()
await sync(doc).waitForSync()

// Access presence via sync()
sync(doc).presence.setSelf({ status: "online" })

// Get snapshot
const snapshot = doc.toJSON()
```

### Key Differences

| Aspect          | v5 Handle              | v6 Doc + sync()           |
| --------------- | ---------------------- | ------------------------- |
| Document access | `handle.doc.field`     | `doc.field`               |
| Sync operations | `handle.waitForSync()` | `sync(doc).waitForSync()` |
| Presence        | `handle.presence`      | `sync(doc).presence`      |
| Ready states    | `handle.readyStates`   | `sync(doc).readyStates`   |
| Peer ID         | `handle.peerId`        | `sync(doc).peerId`        |
| Raw LoroDoc     | `handle.loroDoc`       | `sync(doc).loroDoc`       |

---

## 2. React Hooks Migration

All handle-based hooks have been replaced with doc-first equivalents.

### Before (v5)

```tsx
import {
  useHandle,
  useDoc,
  useRefValue,
  useEphemeral,
} from "@loro-extended/react";

function MyComponent() {
  const handle = useHandle("my-doc", DocSchema, { presence: PresenceSchema });
  const snapshot = useDoc(handle);
  const { value, placeholder } = useRefValue(handle.doc.title);
  const { self, peers } = useEphemeral(handle.presence);

  const handleClick = () => {
    handle.doc.title.insert(0, "Hello");
  };

  return <div>{value || placeholder}</div>;
}
```

### After (v6)

```tsx
import {
  useDocument,
  useValue,
  usePlaceholder,
  useEphemeral,
  sync,
} from "@loro-extended/react";

function MyComponent() {
  const doc = useDocument("my-doc", DocSchema, { presence: PresenceSchema });
  const snapshot = useValue(doc);
  const title = useValue(doc.title);
  const placeholder = usePlaceholder(doc.title);
  const { self, peers } = useEphemeral(sync(doc).presence);

  const handleClick = () => {
    doc.title.insert(0, "Hello");
  };

  return <div>{title || placeholder}</div>;
}
```

### Hook Mapping

| v5 Hook                         | v6 Hook                                 | Notes                                |
| ------------------------------- | --------------------------------------- | ------------------------------------ |
| `useHandle(id, schema)`         | `useDocument(id, schema)`               | Returns `Doc<D>` directly            |
| `useDoc(handle)`                | `useValue(doc)`                         | Works with doc or any ref            |
| `useRefValue(ref)`              | `useValue(ref)` + `usePlaceholder(ref)` | Value and placeholder are separate   |
| `useEphemeral(handle.presence)` | `useEphemeral(sync(doc).presence)`      | Access via `sync()`                  |
| `usePresence(handle)`           | `useEphemeral(sync(doc).presence)`      | `usePresence` was already deprecated |

---

## 3. Schema Changes

`Shape.map()` has been renamed to `Shape.struct()` for clarity (it creates a LoroMap with fixed keys, not a dynamic map).

### Before (v5)

```typescript
import { Shape } from "@loro-extended/change";

const DocSchema = Shape.doc({
  user: Shape.map({
    name: Shape.text(),
    age: Shape.counter(),
  }),
});

const PresenceSchema = Shape.plain.object({
  cursor: Shape.plain.object({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
});
```

### After (v6)

```typescript
import { Shape } from "@loro-extended/change";

const DocSchema = Shape.doc({
  user: Shape.struct({
    name: Shape.text(),
    age: Shape.counter(),
  }),
});

const PresenceSchema = Shape.plain.struct({
  cursor: Shape.plain.struct({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
});
```

### Type Mapping

| v5 Type             | v6 Type                |
| ------------------- | ---------------------- |
| `MapContainerShape` | `StructContainerShape` |
| `ObjectValueShape`  | `StructValueShape`     |

---

## 4. `loro()` API Simplification

The `loro()` function now returns native Loro types directly, without indirection.

### Before (v5)

```typescript
import { loro } from "@loro-extended/change";

// For TypedDoc - had to access .doc
const loroDoc = loro(doc).doc;
const frontiers = loro(doc).doc.frontiers();
loro(doc).doc.subscribe(callback);
loro(doc).doc.import(bytes);

// For TypedRef - had to access .container
const loroText = loro(textRef).container;
const loroList = loro(listRef).container;

// Access LoroDoc from ref
const docFromRef = loro(textRef).doc;
```

### After (v6)

```typescript
import { loro, ext } from "@loro-extended/change";

// For TypedDoc - returns LoroDoc directly
const loroDoc = loro(doc);
const frontiers = loro(doc).frontiers();
loro(doc).subscribe(callback);
loro(doc).import(bytes);

// For TypedRef - returns container directly
const loroText = loro(textRef); // Returns LoroText
const loroList = loro(listRef); // Returns LoroList

// Access LoroDoc from ref - use ext()
const docFromRef = ext(textRef).doc;
```

### Function Mapping

| v5 Pattern                    | v6 Pattern                |
| ----------------------------- | ------------------------- |
| `loro(doc).doc`               | `loro(doc)`               |
| `loro(doc).doc.frontiers()`   | `loro(doc).frontiers()`   |
| `loro(doc).doc.subscribe(cb)` | `loro(doc).subscribe(cb)` |
| `loro(doc).doc.import(bytes)` | `loro(doc).import(bytes)` |
| `loro(doc).doc.export(opts)`  | `loro(doc).export(opts)`  |
| `loro(ref).container`         | `loro(ref)`               |
| `loro(ref).doc`               | `ext(ref).doc`            |
| `getLoroDoc(doc)`             | `loro(doc)`               |

---

## 5. `change()` Consolidation

All mutation methods have been consolidated into the `change()` function.

### Before (v5)

```typescript
// Handle mutation
handle.change((draft) => {
  draft.title.insert(0, "Hello");
});

// Lens mutation
lens.change(
  (draft) => {
    draft.count.increment(1);
  },
  { commitMessage: "increment" }
);

// Ref mutation via ext()
ext(textRef).change((draft) => {
  draft.insert(0, "Hello");
});
```

### After (v6)

```typescript
import { change } from "@loro-extended/change";

// Doc mutation
change(doc, (draft) => {
  draft.title.insert(0, "Hello");
});

// Lens mutation
change(
  lens,
  (draft) => {
    draft.count.increment(1);
  },
  { commitMessage: "increment" }
);

// Ref mutation
change(textRef, (draft) => {
  draft.insert(0, "Hello");
});
```

### Note on Direct Mutation

You can still mutate directly on refs without `change()`:

```typescript
// These are equivalent
doc.title.insert(0, "Hello");
change(doc, (d) => d.title.insert(0, "Hello"));

// Use change() when you need:
// - Batched mutations in a single commit
// - Commit messages
// - Draft-style mutation patterns
```

---

## 6. Subscriptions Migration

The `ext(doc).subscribe()`, `ext(ref).subscribe()`, and `sync(doc).subscribe()` methods have been removed. Use the `subscribe()` functional helper instead.

### Before (v5)

```typescript
import { ext } from "@loro-extended/change";
import { sync } from "@loro-extended/repo";

// Document-level subscription
ext(doc).subscribe(callback);
sync(doc).subscribe(callback);

// Ref-level subscription
ext(textRef).subscribe(callback);
ext(listRef).subscribe(callback);
```

### After (v6)

```typescript
import { subscribe, loro } from "@loro-extended/change";

// Document-level subscription
subscribe(doc, callback);

// Ref-level subscription
subscribe(textRef, callback);
subscribe(listRef, callback);

// Path-selector subscription (new!)
subscribe(doc, p => p.config.theme, (theme) => {
  console.log("Theme changed to:", theme);
});

// Native Loro subscription (escape hatch)
loro(doc).subscribe(callback);
loro(textRef).subscribe(callback);
```

### Subscription Mapping

| v5 Pattern                   | v6 Pattern                        |
| ---------------------------- | --------------------------------- |
| `ext(doc).subscribe(cb)`     | `subscribe(doc, cb)`              |
| `sync(doc).subscribe(cb)`    | `subscribe(doc, cb)`              |
| `ext(ref).subscribe(cb)`     | `subscribe(ref, cb)`              |
| `loro(doc).doc.subscribe(cb)`| `loro(doc).subscribe(cb)`         |

### New: Path-Selector Subscriptions

v6 introduces type-safe path subscriptions:

```typescript
import { subscribe } from "@loro-extended/change";

// Subscribe to a specific path with type inference
const unsubscribe = subscribe(doc, p => p.settings.theme, (theme) => {
  // theme is correctly typed based on your schema
  document.body.className = theme;
});

// Subscribe to wildcard paths
subscribe(doc, p => p.users.$each.name, (names) => {
  // names is an array of all user names
  console.log("User names:", names);
});
```

---

## 7. Mergeable Storage Default

Documents now default to `mergeable: true` storage mode.

### What Changed

| Aspect            | v5 Default            | v6 Default       |
| ----------------- | --------------------- | ---------------- |
| `mergeable`       | `false`               | `true`           |
| Container storage | Hierarchical (nested) | Flattened (root) |
| Container IDs     | Peer-dependent        | Deterministic    |

### Impact

**Benefits of `mergeable: true`:**

- Concurrent container creation at the same schema path merges correctly
- Works correctly with `applyDiff` (e.g., Lens propagation)
- Deterministic container IDs across peers

**Migration considerations:**

1. **New documents**: No action needed, they'll use the new default
2. **Existing documents**: They maintain their storage mode based on metadata
3. **Explicit opt-out**: If you need the old behavior:

```typescript
const schema = Shape.doc(
  {
    // ...
  },
  { mergeable: false }
);
```

### Limitations with `mergeable: true`

Lists of containers are **not** flattened (they always use hierarchical storage):

```typescript
// This works fine - lists are hierarchical regardless of mergeable
Shape.doc({
  items: Shape.list(Shape.struct({ name: Shape.text() })),
});

// For concurrent creation with records, use record instead of list:
Shape.doc(
  {
    items: Shape.record(Shape.struct({ name: Shape.text() })),
  },
  { mergeable: true }
);
```

---

## 8. Type Aliases (Deprecated but Not Removed)

These type aliases are deprecated but still work:

| Deprecated          | Replacement           |
| ------------------- | --------------------- |
| `Draft<T>`          | `Mutable<T>`          |
| `InferDraftType<T>` | `InferMutableType<T>` |

These are harmless one-line aliases kept for backward compatibility.

---

## 9. Lens API Changes

### Before (v5)

```typescript
import { createLens } from "@loro-extended/lens";

const lens = createLens(worldDoc, { filter: myFilter });

// Mutation via method
lens.change(
  (draft) => {
    draft.count.increment(1);
  },
  { commitMessage: "increment" }
);
```

### After (v6)

```typescript
import { createLens, change } from "@loro-extended/lens";
// OR: import { change } from "@loro-extended/change"

const lens = createLens(worldDoc, { filter: myFilter });

// Mutation via function
change(
  lens,
  (draft) => {
    draft.count.increment(1);
  },
  { commitMessage: "increment" }
);
```

### Removed Lens APIs

- `lens.change()` - Use `change(lens, fn)` instead
- `lens.syncFrontiers()` - No longer needed
- `lens.lastKnownWorldviewFrontiers` - No longer needed

---

## Migration Checklist

Use this checklist to track your migration:

### Imports

- [ ] Update imports from `@loro-extended/repo` (add `sync`)
- [ ] Update imports from `@loro-extended/react` (replace hooks)
- [ ] Update imports from `@loro-extended/change` (add `ext` if needed)

### Repo Usage

- [ ] Replace `repo.getHandle()` with `repo.get()`
- [ ] Replace `handle.doc.field` with `doc.field`
- [ ] Replace `handle.waitForSync()` with `sync(doc).waitForSync()`
- [ ] Replace `handle.presence` with `sync(doc).presence`
- [ ] Replace `handle.readyStates` with `sync(doc).readyStates`

### React Hooks

- [ ] Replace `useHandle()` with `useDocument()`
- [ ] Replace `useDoc(handle)` with `useValue(doc)`
- [ ] Replace `useRefValue(ref)` with `useValue(ref)` + `usePlaceholder(ref)`
- [ ] Update `useEphemeral()` calls to use `sync(doc).presence`

### Schemas

- [ ] Replace `Shape.map()` with `Shape.struct()`
- [ ] Replace `Shape.plain.object()` with `Shape.plain.struct()`
- [ ] Update type references from `MapContainerShape` to `StructContainerShape`
- [ ] Update type references from `ObjectValueShape` to `StructValueShape`

### loro() Usage

- [ ] Replace `loro(doc).doc` with `loro(doc)`
- [ ] Replace `loro(ref).container` with `loro(ref)`
- [ ] Replace `loro(ref).doc` with `ext(ref).doc`
- [ ] Replace `getLoroDoc()` with `loro()`

### Mutations

- [ ] Replace `handle.change(fn)` with `change(doc, fn)`
- [ ] Replace `lens.change(fn)` with `change(lens, fn)`
- [ ] Replace `ext(ref).change(fn)` with `change(ref, fn)`

### Subscriptions

- [ ] Replace `ext(doc).subscribe(cb)` with `subscribe(doc, cb)`
- [ ] Replace `sync(doc).subscribe(cb)` with `subscribe(doc, cb)`
- [ ] Replace `ext(ref).subscribe(cb)` with `subscribe(ref, cb)`

### Testing

- [ ] Run full test suite
- [ ] Verify existing documents load correctly
- [ ] Test sync functionality with `sync(doc)`
- [ ] Test presence functionality

---

## Automated Migration

You can use these shell commands to find code that needs updating:

```bash
# Find Handle usage
grep -r "getHandle\|useHandle\|useDoc\|useRefValue" --include="*.ts" --include="*.tsx"

# Find Shape.map usage
grep -r "Shape\.map\|Shape\.plain\.object" --include="*.ts" --include="*.tsx"

# Find loro() with .doc or .container
grep -r "loro(.*)\.\(doc\|container\)" --include="*.ts" --include="*.tsx"

# Find handle.change or lens.change
grep -r "\.\(handle\|lens\)\.change\|handle\.change\|lens\.change" --include="*.ts" --include="*.tsx"

# Find ext().subscribe or sync().subscribe
grep -r "ext(.*).subscribe\|sync(.*).subscribe" --include="*.ts" --include="*.tsx"
```

---

## Getting Help

If you encounter issues during migration:

1. Check the [package READMEs](../packages/) for detailed API documentation
2. Look at the [examples](../examples/) for working code using the new API
3. Review [TECHNICAL.md](../packages/repo/TECHNICAL.md) for architectural details

---

## Changelog

For the complete list of changes, see the individual package changelogs:

- [@loro-extended/repo CHANGELOG](../packages/repo/CHANGELOG.md)
- [@loro-extended/react CHANGELOG](../packages/react/CHANGELOG.md)
- [@loro-extended/hooks-core CHANGELOG](../packages/hooks-core/CHANGELOG.md)
- [@loro-extended/change CHANGELOG](../packages/change/CHANGELOG.md)
- [@loro-extended/lens CHANGELOG](../packages/lens/CHANGELOG.md)
