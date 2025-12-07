---
"@loro-extended/repo": minor
"@loro-extended/hooks-core": minor
"@loro-extended/react": minor
---

Remove `emptyState` parameter from TypedPresence and usePresence. Instead, use `.placeholder()` annotations on your schema to define default values.

### Breaking Change

The `emptyState` parameter has been removed from:
- `TypedPresence` constructor
- `DocHandle.presence()` method
- `usePresence` hook

### Migration

Before:
```typescript
const PresenceSchema = Shape.plain.object({
  name: Shape.plain.string(),
  cursor: Shape.plain.object({
    x: Shape.plain.number(),
    y: Shape.plain.number(),
  }),
})

const EmptyPresence = {
  name: "Anonymous",
  cursor: { x: 0, y: 0 },
}

// Usage
const presence = handle.presence(PresenceSchema, EmptyPresence)
const { self } = usePresence(docId, PresenceSchema, EmptyPresence)
```

After:
```typescript
const PresenceSchema = Shape.plain.object({
  name: Shape.plain.string().placeholder("Anonymous"),
  cursor: Shape.plain.object({
    x: Shape.plain.number(),  // default 0
    y: Shape.plain.number(),  // default 0
  }),
})

// Usage - no emptyState needed!
const presence = handle.presence(PresenceSchema)
const { self } = usePresence(docId, PresenceSchema)
```

Placeholder values are automatically derived from the schema. Use `.placeholder()` on individual shapes to customize default values. Shapes without explicit `.placeholder()` use sensible defaults:
- `Shape.plain.string()` → `""`
- `Shape.plain.number()` → `0`
- `Shape.plain.boolean()` → `false`
- `Shape.plain.object({...})` → recursively derived from nested shapes
- `Shape.plain.record(...)` → `{}`
- `Shape.plain.array(...)` → `[]`