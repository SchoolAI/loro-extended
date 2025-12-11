---
"@loro-extended/hooks-core": major
"@loro-extended/react": major
"@loro-extended/hono": major
---

## Breaking Change: New Handle-First Hooks API

This release introduces a completely new hooks API that provides better separation of concerns, improved type safety, and more predictable behavior.

### New API

```typescript
// Get a stable handle (never re-renders)
const handle = useHandle(docId, docSchema)
// or with presence
const handle = useHandle(docId, docSchema, presenceSchema)

// Subscribe to document changes (reactive)
const doc = useDoc(handle)
// or with selector for fine-grained updates
const title = useDoc(handle, d => d.title)

// Subscribe to presence changes (reactive)
const { self, peers } = usePresence(handle)

// Mutate via handle
handle.change(d => { d.title = "new" })
handle.presence.set({ cursor: { x: 10, y: 20 } })
```

### Migration Guide

**Before:**
```typescript
const [doc, changeDoc, handle] = useDocument(docId, schema)
changeDoc(d => { d.title = "new" })

const { peers, self, setSelf } = usePresence(docId, PresenceSchema)
setSelf({ cursor: { x: 10, y: 20 } })
```

**After:**
```typescript
const handle = useHandle(docId, schema, PresenceSchema)
const doc = useDoc(handle)
const { self, peers } = usePresence(handle)

handle.change(d => { d.title = "new" })
handle.presence.set({ cursor: { x: 10, y: 20 } })
```

### Removed APIs

The following hooks have been removed:
- `useDocument` - Use `useHandle` + `useDoc` instead
- `useUntypedDocument` - Use `repo.get(docId)` for untyped access
- `useUntypedPresence` - Use `useHandle` with a presence schema
- `useDocHandleState`, `useDocChanger`, `useTypedDocState`, `useTypedDocChanger`, `useRawLoroDoc`, `useUntypedDocChanger`

### Benefits

1. **Stable handle reference** - `useHandle` returns a stable reference that never changes, preventing unnecessary re-renders
2. **Separation of concerns** - Document access and mutations are clearly separated
3. **Fine-grained reactivity** - Use selectors with `useDoc` to only re-render when specific data changes
4. **Unified presence** - Presence is now tied to the handle, making it easier to manage
5. **Better TypeScript support** - Improved type inference throughout