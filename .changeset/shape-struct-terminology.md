---
"@loro-extended/change": minor
---

# Shape API: Adopt "struct" terminology for fixed-key objects

This release improves the consistency and Developer Experience (DX) of the `Shape` schema builder by adopting the term "struct" for objects with fixed keys.

## New API

### Container Shapes

- **`Shape.struct({ ... })`** - Creates a struct container shape for objects with fixed keys (uses LoroMap internally)
- **`Shape.map({ ... })`** - **Deprecated**, use `Shape.struct()` instead

### Value Shapes

- **`Shape.plain.struct({ ... })`** - Creates a struct value shape for plain objects with fixed keys
- **`Shape.plain.object({ ... })`** - **Deprecated**, use `Shape.plain.struct()` instead

## Why "struct"?

The term "map" was confusing because it implies dynamic keys (like JavaScript's `Map` or a dictionary). The term "object" is too generic. "Struct" clearly communicates that this is for objects with a fixed, known set of keys - similar to structs in C, Go, Rust, etc.

The term "record" is retained for objects with dynamic keys (like `Record<string, T>` in TypeScript).

## Migration Guide

### Before

```typescript
const schema = Shape.doc({
  user: Shape.map({
    name: Shape.text(),
    age: Shape.counter(),
    metadata: Shape.plain.object({
      createdAt: Shape.plain.string(),
      updatedAt: Shape.plain.string(),
    }),
  }),
})
```

### After

```typescript
const schema = Shape.doc({
  user: Shape.struct({
    name: Shape.text(),
    age: Shape.counter(),
    metadata: Shape.plain.struct({
      createdAt: Shape.plain.string(),
      updatedAt: Shape.plain.string(),
    }),
  }),
})
```

## Backward Compatibility

- **No breaking changes** - Existing code using `Shape.map` and `Shape.plain.object` continues to work
- IDE will show deprecation warnings for old methods
- `MapContainerShape` is now a type alias for `StructContainerShape`
- `ObjectValueShape` is now a type alias for `StructValueShape`

## Type Exports

New types are exported:
- `StructContainerShape` - The container shape type for structs
- `StructValueShape` - The value shape type for plain structs

Deprecated types (still exported for backward compatibility):
- `MapContainerShape` - Use `StructContainerShape` instead
- `ObjectValueShape` - Use `StructValueShape` instead