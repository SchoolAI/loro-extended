---
"@loro-extended/change": minor
---

Add flattened root container storage for mergeable documents

When `mergeable: true` is set on a TypedDoc, all containers are stored at the
document root with path-based names (e.g., `data-nested-items`). This ensures
container IDs are deterministic and survive `applyDiff`, enabling proper merging
of concurrent container creation.

**Usage:**
```typescript
const doc = createTypedDoc(schema, { mergeable: true });
```

**Path encoding:**
- Path separator: `-` (hyphen)
- Escape character: `\` (backslash)
- Literal hyphen: `\-`
- Literal backslash: `\\`

**Limitations:**
- Lists of containers (`Shape.list(Shape.struct({...}))`) are NOT supported with `mergeable: true`
- Use `Shape.record(Shape.struct({...}))` with string keys instead

This is a breaking change for existing mergeable documents. Non-mergeable
documents are unaffected.
