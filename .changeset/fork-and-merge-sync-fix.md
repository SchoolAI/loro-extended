---
"@loro-extended/change": minor
---

Add `replayDiff()` utility for replaying diffs as local operations.

This enables the fork-and-merge pattern to work with synchronization and undo:
- Changes are replayed as LOCAL events (not import events)
- `subscribeLocalUpdates()` fires for replayed changes
- UndoManager records replayed changes

The `createUpdate()` function in the quiz-challenge example has been updated to use `replayDiff()` instead of `export/import`, fixing the incompatibility between fork-and-merge and the synchronizer.
