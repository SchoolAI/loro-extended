---
"@loro-extended/repo": patch
---

Add `subscribe` convenience method to `TypedDocHandle` for subscribing to document changes.

The method provides a type-safe way to listen for all changes on the document:

```typescript
const handle = repo.get(docId, docSchema)

const unsubscribe = handle.subscribe((event) => {
  // event is a LoroEventBatch containing:
  // - by: "local" | "import" | "checkout"
  // - origin: optional string identifying the change source
  // - currentTarget: container ID (undefined for root doc)
  // - events: array of LoroEvent objects with diffs
  // - from/to: frontiers before/after the change
  console.log("Document changed:", event.by)
})

// Later: unsubscribe()
```

The return type `() => void` is consistent with `TypedPresence.subscribe` and other subscription patterns in the codebase.