---
"@loro-extended/change": minor
"@loro-extended/lens": major
---

feat(change): Add ChangeOptions support to change() function

The `change()` function now accepts an optional `ChangeOptions` parameter for all target types:

- `change(doc, fn, options?)` - TypedDoc with optional commit message
- `change(ref, fn, options?)` - TypedRef with optional commit message
- `change(lens, fn, options?)` - Lens with optional commit message (via EXT_SYMBOL detection)

**BREAKING CHANGE in @loro-extended/lens**: The `lens.change()` method has been removed. Use the unified `change(lens, fn, options?)` API instead.

Migration:

```typescript
// Before
lens.change(d => d.counter.increment(1), { commitMessage: "inc" })

// After - Option A: import from lens package
import { createLens, change } from "@loro-extended/lens"
change(lens, d => d.counter.increment(1), { commitMessage: "inc" })

// After - Option B: import from change package
import { createLens } from "@loro-extended/lens"
import { change } from "@loro-extended/change"
change(lens, d => d.counter.increment(1), { commitMessage: "inc" })
```

This unifies the API so that `change()` works consistently with docs, refs, and lenses.

Exports from @loro-extended/change:
- `ChangeOptions` interface
- `serializeCommitMessage()` helper function

Re-exports from @loro-extended/lens (for convenience):
- `change` function
- `ChangeOptions` interface
