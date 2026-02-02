# @loro-extended/lens

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
