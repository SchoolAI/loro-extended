---
"@loro-extended/repo": minor
"@loro-extended/hooks-core": minor
"@loro-extended/react": minor
---

feat: Simplified React API with doc-first design

This release simplifies the React API by making the document the primary interface:

**New API:**

```typescript
// Get doc directly (no Handle intermediary)
const doc = useDocument(docId, schema)

// Subscribe to values (returns value directly)
const title = useValue(doc.title)    // string
const snapshot = useValue(doc)       // Infer<D>

// Placeholder access (rare)
const placeholder = usePlaceholder(doc.title)

// Mutate directly
doc.title.insert(0, "Hello")

// Sync/network access (rare)
import { sync } from "@loro-extended/repo"
sync(doc).peerId
await sync(doc).waitForSync()
sync(doc).presence.setSelf({ status: "online" })
```

**Key Changes:**
- `repo.get()` now returns `Doc<D>` directly (TypedDoc with sync capabilities)
- `repo.get()` now caches documents and throws on schema mismatch
- `useDocument(docId, schema)` is the primary React hook
- `useValue(ref)` returns value directly (not wrapped in object)
- `usePlaceholder(ref)` for placeholder access
- `sync(doc)` provides access to peerId, readyStates, waitForSync, ephemeral stores
- `sync` and `hasSync` are now re-exported from `@loro-extended/react`

**Deprecations:**
- `useHandle` — use `useDocument` instead
- `useDoc(handle)` — use `useValue(doc)` for snapshots
- `useRefValue` — use `useValue` instead (returns value directly)
- `Handle` type — still exported but deprecated
- `repo.getHandle()` — use `repo.get()` instead

**Migration:**

```typescript
// Before
const handle = useHandle(docId, schema)
const snapshot = useDoc(handle)
const { value, placeholder } = useRefValue(handle.doc.title)
handle.doc.title.insert(0, "Hello")

// After
const doc = useDocument(docId, schema)
const snapshot = useValue(doc)
const title = useValue(doc.title)
const placeholder = usePlaceholder(doc.title)
doc.title.insert(0, "Hello")
```
