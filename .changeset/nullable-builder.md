---
"@loro-extended/change": minor
---

Add `.nullable()` builder method to value shape types for convenient nullable type definitions.

Supported types:
- `Shape.plain.string().nullable()` - `string | null`
- `Shape.plain.number().nullable()` - `number | null`
- `Shape.plain.boolean().nullable()` - `boolean | null`
- `Shape.plain.array(...).nullable()` - `T[] | null`
- `Shape.plain.record(...).nullable()` - `Record<string, T> | null`
- `Shape.plain.struct(...).nullable()` - `{ ... } | null`

**Before (verbose):**
```typescript
email: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]).placeholder(null)
```

**After (concise):**
```typescript
email: Shape.plain.string().nullable()
```

The `.nullable()` method creates a union of `null` and the original type with `null` as the default placeholder. You can chain `.placeholder()` after `.nullable()` to customize the default value:

```typescript
name: Shape.plain.string().nullable().placeholder("Anonymous")