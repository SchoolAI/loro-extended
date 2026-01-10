---
"@loro-extended/change": minor
---

**BREAKING**: `nodes()` now excludes deleted nodes by default

Previously, `tree.nodes()` returned all nodes including deleted tombstones, which caused "container is deleted" errors when users tried to access `.data` on deleted nodes.

Now `nodes()` filters out deleted nodes by default. To include deleted nodes, use `nodes({ includeDeleted: true })`.

```typescript
// Default: excludes deleted nodes (prevents "container is deleted" errors)
const liveNodes = tree.nodes()

// Opt-in: include deleted nodes for advanced CRDT operations
const allNodes = tree.nodes({ includeDeleted: true })
```

This aligns `nodes()` behavior with `roots()` and `children()`, which already exclude deleted nodes.
