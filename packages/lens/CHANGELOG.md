# @loro-extended/lens

## 1.0.0-beta.0

### Major Changes

- 39fa800: feat(change): Add ChangeOptions support to change() function

  The `change()` function now accepts an optional `ChangeOptions` parameter for all target types:

  - `change(doc, fn, options?)` - TypedDoc with optional commit message
  - `change(ref, fn, options?)` - TypedRef with optional commit message
  - `change(lens, fn, options?)` - Lens with optional commit message (via EXT_SYMBOL detection)

  **BREAKING CHANGE in @loro-extended/lens**: The `lens.change()` method has been removed. Use the unified `change(lens, fn, options?)` API instead.

  Migration:

  ```typescript
  // Before
  lens.change((d) => d.counter.increment(1), { commitMessage: "inc" });

  // After - Option A: import from lens package
  import { createLens, change } from "@loro-extended/lens";
  change(lens, (d) => d.counter.increment(1), { commitMessage: "inc" });

  // After - Option B: import from change package
  import { createLens } from "@loro-extended/lens";
  import { change } from "@loro-extended/change";
  change(lens, (d) => d.counter.increment(1), { commitMessage: "inc" });
  ```

  This unifies the API so that `change()` works consistently with docs, refs, and lenses.

  Exports from @loro-extended/change:

  - `ChangeOptions` interface
  - `serializeCommitMessage()` helper function

  Re-exports from @loro-extended/lens (for convenience):

  - `change` function
  - `ChangeOptions` interface

### Minor Changes

- 4b2bd29: Simplified lens architecture with re-entrancy support and debug logging

  - Fixed: Calling `change(lens, ...)` inside subscription callbacks no longer causes double-propagation
  - Added: `debug` option for logging internal operations (e.g., `{ debug: console.log }`)
  - Changed: Replaced 4-state processing machine with queue-based change processing
  - Changed: Fresh frontier capture eliminates stale state bugs
  - Removed: `syncFrontiers()` and `lastKnownWorldviewFrontiers` (no longer needed)
  - Reduced: Code from ~470 lines to ~460 lines
  - API addition: `DebugFn` type exported for custom loggers

### Patch Changes

- Updated dependencies [3a1cbed]
- Updated dependencies [39fa800]
- Updated dependencies [50c0083]
- Updated dependencies [f90c7f7]
- Updated dependencies [32b9abb]
- Updated dependencies [50c0083]
- Updated dependencies [29853c3]
- Updated dependencies [d9570ea]
  - @loro-extended/change@6.0.0-beta.0

## 0.2.0

### Minor Changes

- a00b155: Initial release of @loro-extended/lens

  Provides a composable primitive for bidirectional filtered synchronization between a source TypedDoc (world) and a projected doc (worldview).

  Key features:

  - Commit-level filtering for incoming changes
  - State-based propagation (applyDiff) for outgoing changes
  - Causal consistency maintained during filtering
  - Composable - lenses can chain
  - Works with any TypedDoc source

  API:

  - `createLens(source, options?)` - Create a lens from a TypedDoc
  - Built-in filters: `filterNone`, `filterAll`, `filterByPeers`, `filterByMessage`
  - Filter combinators: `composeFilters`, `anyFilter`, `notFilter`

### Patch Changes

- Updated dependencies [e1588f2]
  - @loro-extended/change@5.4.1
