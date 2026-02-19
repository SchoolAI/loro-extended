---
"@loro-extended/hooks-core": minor
"@loro-extended/react": minor
"@loro-extended/hono": minor
---

Add `useDocIdFromHash` hook for syncing document ID with URL hash

This hook enables shareable URLs where the hash contains the document ID (e.g., `https://app.example.com/#doc-abc123`).

Features:
- Uses `useSyncExternalStore` for concurrent mode safety
- SSR-safe with server snapshot support
- Automatically writes hash on mount if empty
- Caches generated default ID across renders

Also exports pure utility functions `parseHash()` and `getDocIdFromHash()` for testing and custom implementations.

```typescript
import { useDocIdFromHash, useDocument } from "@loro-extended/react"
import { generateUUID } from "@loro-extended/repo"

function App() {
  const docId = useDocIdFromHash(() => generateUUID())
  const doc = useDocument(docId, MySchema)
  // ...
}
```
