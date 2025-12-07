---
"example-bumper-cars": patch
---

Upgraded bumper-cars example to use new TypedDocHandle and TypedPresence APIs

- Simplified GameLoop constructor from 3 parameters to 1 (TypedDocHandle)
- Replaced `createTypedDoc()` pattern with direct `handle.change(draft => ...)`
- Replaced manual presence callbacks with `handle.presence.all` and `handle.presence.set()`
- Updated server.ts to use `repo.get(docId, docShape, presenceShape)` for type-safe handle
- Reduced ~25 lines of boilerplate code and eliminated manual type casting