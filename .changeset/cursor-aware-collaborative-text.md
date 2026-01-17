---
"@loro-extended/hooks-core": minor
---

**useCollaborativeText**: Fixed cursor position during remote changes using delta-based adjustment. Previously, the hook used a naive length-difference algorithm that assumed all changes happened at the end of the text, causing cursor jumps when remote edits occurred before the cursor. Now it uses the actual delta operations from Loro events to accurately adjust cursor positions.

**useUndoManager**: Added optional `getCursors`/`setCursors` callbacks for cursor restoration during undo/redo operations. When provided, cursor positions are captured before each undo step is pushed and restored when the step is popped, using Loro's stable Cursor API.

New exports:
- `CursorPosition` type for cursor position information
- `adjustCursorFromDelta()` utility for delta-based cursor adjustment
- `adjustSelectionFromDelta()` utility for selection range adjustment
