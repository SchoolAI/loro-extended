---
"@loro-extended/hooks-core": patch
---

fix(useDoc): properly detect checkout changes by including frontiers in version key

The `useDoc` hook now correctly re-renders when the document is checked out to a historical state. Previously, the version key only used `opCount`, which doesn't change during checkout operations. Now the version key includes both `opCount` and `frontiers`, ensuring the hook detects checkout changes.

This enables time travel debugging features like the History Panel in the quiz-challenge example.
