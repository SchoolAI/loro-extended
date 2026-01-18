---
"@loro-extended/hooks-core": minor
"@loro-extended/react": minor
---

Add automatic cursor restoration and namespace-based undo

- Cursor restoration now works automatically when using `useCollaborativeText` with `useUndoManager`
- Cursor position is stored with container ID in `onPush`, restored to correct element in `onPop`
- Add namespace support to scope undo/redo to specific groups of fields
- Namespaces use `LoroDoc.setNextCommitOrigin()` and `UndoManager.excludeOriginPrefixes`
- Add `cursorRestoration` config option to `RepoProvider` (default: true)

### New API

```tsx
// Namespace-based undo
const { undo: undoHeader } = useUndoManager(handle, "header")
const { undo: undoBody } = useUndoManager(handle, "body")

// Assign fields to namespaces
<CollaborativeInput textRef={titleRef} undoNamespace="header" />
<CollaborativeTextarea textRef={descriptionRef} undoNamespace="body" />
```

### How It Works

1. When `undoNamespace="header"` is set, changes call `doc.setNextCommitOrigin("loro-extended:ns:header")` before commit
2. The "header" UndoManager has `excludeOriginPrefixes: ["loro-extended:ns:body", ...]` to ignore other namespaces
3. Cursor position is stored with the container ID of the focused element
4. On undo, the cursor is restored to the element matching the stored container ID

### Migration

Apps using manual cursor tracking via `getCursors`/`setCursors` can remove that code - it's now automatic. To opt-out:

```tsx
<RepoProvider config={{ cursorRestoration: false }}>
```
