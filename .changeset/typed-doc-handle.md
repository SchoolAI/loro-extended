---
"@loro-extended/change": minor
"@loro-extended/repo": minor
"@loro-extended/hooks-core": patch
"@loro-extended/adapter-websocket": patch
---

Add strongly typed `TypedDocHandle` from `Repo.get()`

## New Features

### TypedDocHandle

`Repo.get()` now supports typed document and presence schemas:

```typescript
import { Shape } from "@loro-extended/change";

const DocSchema = Shape.doc({
  title: Shape.text(),
  count: Shape.counter(),
});

const PresenceSchema = Shape.plain.object({
  cursor: Shape.plain.object({ x: Shape.plain.number(), y: Shape.plain.number() }),
  name: Shape.plain.string().placeholder("Anonymous"),
});

// Get a typed handle with doc and presence schemas
const handle = repo.get("my-doc", DocSchema, PresenceSchema);

// Type-safe document mutations
handle.doc.change(draft => {
  draft.title.insert(0, "Hello");
  draft.count.increment(1);
});

// Type-safe presence with placeholder defaults
handle.presence.set({ cursor: { x: 100, y: 200 } });
console.log(handle.presence.self.name); // "Anonymous" (from placeholder)
```

### API Changes

- **`repo.get(docId, docShape, presenceShape)`** - Returns `TypedDocHandle<D, P>` with typed `doc` and `presence`
- **`repo.get(docId, docShape)`** - Returns `TypedDocHandle<D, ValueShape>` with typed `doc`
- **`repo.get(docId)`** - Returns `UntypedDocHandle` (backward compatible)
- **`repo.getUntyped(docId)`** - Explicit method to get `UntypedDocHandle`

### TypedPresence moved to @loro-extended/change

`TypedPresence` is now exported from `@loro-extended/change` and works with any `PresenceInterface`:

```typescript
import { TypedPresence, Shape } from "@loro-extended/change";

const typedPresence = new TypedPresence(PresenceSchema, handle.presence);
```

### Breaking Changes

- `DocHandle` renamed to `UntypedDocHandle` (alias provided for backward compatibility)
- `handle.untypedPresence` renamed to `handle.presence`
- `TypedPresence` moved from `@loro-extended/repo` to `@loro-extended/change`

### Backward Compatibility

- `DocHandle` is re-exported as an alias for `UntypedDocHandle`
- `repo.get(docId)` without schemas returns `UntypedDocHandle` as before
- `TypedPresence` is re-exported from `@loro-extended/repo` for compatibility