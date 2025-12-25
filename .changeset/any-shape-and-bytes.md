---
"@loro-extended/change": minor
"@loro-extended/repo": minor
---

Add `Shape.any()`, `Shape.plain.any()`, and `Shape.plain.bytes()` for graceful untyped integration

This release adds escape hatches for integrating with external libraries that manage their own document structure (like loro-prosemirror):

### @loro-extended/change

- **`Shape.any()`** - Container escape hatch that represents "any LoroContainer". Use at document root level when you want typed presence but untyped document content.
- **`Shape.plain.any()`** - Value escape hatch that represents "any Loro Value". Use in presence schemas for flexible metadata.
- **`Shape.plain.bytes()`** - Alias for `Shape.plain.uint8Array()` for better discoverability when working with binary data like cursor positions.
- **`Shape.plain.uint8Array().nullable()`** - Added `.nullable()` support for binary data.

### @loro-extended/repo

- **`repo.get(docId, Shape.any(), presenceShape)`** - New overload that returns an `UntypedWithPresenceHandle` when `Shape.any()` is passed directly as the document shape. This provides raw `LoroDoc` access with typed presence.
- **`UntypedWithPresenceHandle`** - New handle type for documents where the structure is untyped but presence is typed.

### Example usage

```typescript
// Option 1: Shape.any() directly (entire document is untyped)
const handle = repo.get(docId, Shape.any(), CursorPresenceSchema)
handle.doc // Raw LoroDoc
handle.presence.set({ ... }) // Typed presence

// Option 2: Shape.any() in a container (one container is untyped)
const ProseMirrorDocShape = Shape.doc({
  doc: Shape.any(), // loro-prosemirror manages this
})
const handle = repo.get(docId, ProseMirrorDocShape, CursorPresenceSchema)
handle.doc.toJSON() // { doc: unknown }
handle.presence.set({ ... }) // Typed presence

// Fully typed presence with binary cursor data
const CursorPresenceSchema = Shape.plain.struct({
  anchor: Shape.plain.bytes().nullable(),
  focus: Shape.plain.bytes().nullable(),
  user: Shape.plain.struct({
    name: Shape.plain.string(),
    color: Shape.plain.string(),
  }).nullable(),
})

// Presence is fully typed, Uint8Array works directly (no base64 encoding needed!)
handle.presence.set({
  anchor: cursor.encode(), // Uint8Array directly
  focus: null,
  user: { name: "Alice", color: "#ff0000" },
})
```
