---
"@loro-extended/change": minor
---

# Schema Migration System

Introduced a schema migration system that allows evolving data structures without breaking changes.

## Features

- **First-Class Migration Methods**: `.key()` and `.migrateFrom()` are available directly on all Shape types.
- **Mapped Schema**: Decouple logical field names from physical storage keys using `.key()`.
- **Migration Definitions**: Define transformations from old schema versions using `.migrateFrom()`.
- **Chained Migrations**: Support for multi-version upgrades (V1 → V2 → V3) with automatic fallback.
- **Eager Migration**: Automatically transforms and writes data to the new format upon access.
- **Garbage Collection**: Clean up legacy data with `doc.gc()`.

## Example

```typescript
const ChatSchema = Shape.doc({
  messages: Shape.list(Shape.text())
    .key("_v2_messages")
    .migrateFrom({
      key: "_v1_messages",
      sourceShape: Shape.list(Shape.text()),
      transform: (v1) => v1
    })
})

// Multi-version migration example:
const TaskSchema = Shape.doc({
  tasks: Shape.list(
    Shape.map({
      title: Shape.plain.string(),
      priority: Shape.plain.object({
        level: Shape.plain.string(),
        urgent: Shape.plain.boolean(),
      })
        .key("priority_v3")
        .migrateFrom({
          key: "priority_v2",
          sourceShape: Shape.plain.string(),
          transform: (v2) => ({
            level: v2,
            urgent: v2 === "high",
          }),
        })
        .migrateFrom({
          key: "priority",
          sourceShape: Shape.plain.number(),
          transform: (v1) => ({
            level: v1 >= 4 ? "high" : v1 >= 2 ? "medium" : "low",
            urgent: v1 === 5,
          }),
        }),
    })
  ),
})
```