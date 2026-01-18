---
"@loro-extended/hooks-core": patch
---

Fix textarea desync after undo/redo operations in useCollaborativeText

The subscription handler in `useCollaborativeText` was incorrectly filtering out undo/redo events because they have `event.by === "local"`. This caused the textarea to not update when the user performed undo/redo operations via the UndoManager, resulting in a desync between the textarea content and the underlying CRDT.

**Root cause:** The condition `if (event.by === "local" || isLocalChangeRef.current) return` filtered out ALL events with `event.by === "local"`, including undo/redo events which also have this value.

**Fix:** Remove the `event.by === "local"` check and rely solely on `isLocalChangeRef.current` to determine if an event should be skipped. The `isLocalChangeRef` is only true during our `beforeinput` handler, so it correctly distinguishes between:
- User typing (should skip - we already updated the textarea)
- Undo/redo operations (should NOT skip - need to update textarea)
- Remote changes (should NOT skip - need to update textarea)
