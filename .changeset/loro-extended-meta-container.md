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
- `loro(doc).mergeable` exposes the effective mergeable value
- Handle now exposes `isMergeable` getter (delegates to TypedDoc)
- New `skipInitialize` option to defer metadata writing
- New `doc.initialize()` method for manual metadata initialization

Usage:
```typescript
const schema = Shape.doc({
  players: Shape.record(Shape.struct({ score: Shape.plain.number() })),
}, { mergeable: true })

// Auto-initialize (default) - writes metadata immediately
const doc = createTypedDoc(schema)

// Skip initialization for advanced use cases
const doc2 = createTypedDoc(schema, { skipInitialize: true })
// Later, when ready:
doc2.initialize()

// Access effective mergeable value
loro(doc).mergeable // true
```
