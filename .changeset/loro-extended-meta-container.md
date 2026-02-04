---
"@loro-extended/change": minor
"@loro-extended/repo": minor
---

Add schema-level mergeable configuration and document metadata

- `Shape.doc()` now accepts an options parameter with `mergeable?: boolean`
- Document metadata is stored in `_loro_extended_meta_` root container
- Metadata includes `mergeable` flag for peer agreement
- `toJSON()` excludes all `_loro_extended*` prefixed keys from output
- Reserved prefix `_loro_extended` for future internal use
- Warnings logged when metadata doesn't match schema expectations
- `loro(doc).mergeable` exposes the effective mergeable value
- Handle now exposes `isMergeable` getter (delegates to TypedDoc)

Usage:
```typescript
const schema = Shape.doc({
  players: Shape.record(Shape.struct({ score: Shape.plain.number() })),
}, { mergeable: true })

const doc = createTypedDoc(schema)
// Metadata automatically written: { mergeable: true }

// Access effective mergeable value
loro(doc).mergeable // true
```
