---
"@loro-extended/repo": minor
---

BridgeAdapter now delivers messages asynchronously via `queueMicrotask()` to better simulate real network adapter behavior.

This change ensures that tests using BridgeAdapter exercise the same async codepaths as production adapters (WebSocket, SSE, etc.), helping catch race conditions and async state management bugs that would otherwise only surface in production.

**Migration**: Tests using BridgeAdapter should use `waitForSync()` or `waitUntilReady()` to await synchronization:

```typescript
// Before (may have worked due to synchronous delivery)
handleA.change(draft => { draft.text.insert(0, "hello") })
expect(handleB.doc.toJSON().text).toBe("hello")

// After (correct async pattern)
handleA.change(draft => { draft.text.insert(0, "hello") })
await handleB.waitForSync()
expect(handleB.doc.toJSON().text).toBe("hello")
```

Most existing tests already follow this pattern and will continue to work without changes.
