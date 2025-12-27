# Repo Architecture Documentation

For comprehensive documentation on the `@loro-extended/repo` architecture, see:

**[Repo Architecture Guide](../../../docs/repo-architecture.md)**

This guide covers:
- System overview and component diagram
- Core components (Repo, DocHandle, Synchronizer, Adapters, Rules)
- Architectural trade-offs and design decisions
- Document lifecycle and data flow
- Synchronization protocol
- Testing strategy

## Quick Reference

The `Repo` class is the central orchestrator:

```typescript
import { Repo } from "@loro-extended/repo";
import { Shape } from "@loro-extended/change";

const DocSchema = Shape.doc({
  title: Shape.text(),
  count: Shape.counter(),
});

const repo = new Repo({
  identity: { name: "user-1", type: "user" },
  adapters: [/* storage and network adapters */],
});

// Get a typed handle
const handle = repo.get("my-doc", DocSchema);

// Mutate the document
handle.change(draft => {
  draft.title.insert(0, "Hello");
  draft.count.increment(1);
});
```

See the source files in this directory for implementation details:
- [`repo.ts`](./repo.ts) - Repo class implementation
- [`handle.ts`](./handle.ts) - Handle class implementation
- [`synchronizer.ts`](./synchronizer.ts) - Synchronization logic
- [`rules.ts`](./rules.ts) - Access control rules
