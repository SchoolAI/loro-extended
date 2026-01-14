---
"@loro-extended/change": minor
---

Add `forkAt` support for TypedDoc to create typed document forks at specific versions

The `forkAt` method creates a new TypedDoc at a specified version (frontiers), preserving full type safety. Available as both a method on TypedDoc and a functional helper.

```typescript
import { createTypedDoc, forkAt, loro } from "@loro-extended/change";

const doc = createTypedDoc(schema);
doc.title.update("Hello");
const frontiers = loro(doc).doc.frontiers();
doc.title.update("World");

// Method on TypedDoc
const forked = doc.forkAt(frontiers);

// Or functional helper
const forked2 = forkAt(doc, frontiers);

console.log(forked.title.toString()); // "Hello"
console.log(doc.title.toString());    // "World"
```

Key features:
- Returns `TypedDoc<Shape>` with full type safety
- Forked doc is independent (changes don't affect original)
- Forked doc has a different PeerID
- Raw `LoroDoc.forkAt()` still accessible via `loro(doc).doc.forkAt()`
- New `Frontiers` type exported for convenience
