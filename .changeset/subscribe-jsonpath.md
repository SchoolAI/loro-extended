---
"@loro-extended/repo": minor
---

Add JSONPath subscription support to `TypedDocHandle.subscribe()`

The `subscribe` method now supports an optional JSONPath pattern as the first argument, enabling efficient subscriptions to specific document paths. The callback automatically receives the query result and a helper function for querying related paths:

```typescript
// Subscribe to all changes (existing behavior)
const unsubscribe = handle.subscribe((event) => {
  console.log("Document changed:", event.by);
});

// Subscribe to JSONPath changes (new)
const unsubscribe = handle.subscribe("$.books[?@.price>10].title", (titles, getPath) => {
  // `titles` is already the result of the subscribed JSONPath query
  console.log("Expensive book titles:", titles);

  // `getPath` makes it easy to query related paths
  const allBooks = getPath("$.books");
});
```

This leverages Loro's new `subscribeJsonpath` feature (loro-crdt 1.10.3) which uses an NFA-based matcher to efficiently filter events at the path-matching level, avoiding the need to re-evaluate queries on every change.

Key characteristics:
- Callback receives `(value: unknown[], getPath: (path: string) => unknown[])` for improved DX
- May produce false positives (extra notifications) but never false negatives
- Supports wildcards (`[*]`), filters (`[?...]`), and recursive descent (`..`)
