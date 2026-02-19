# Plan: Elevate `useDocIdFromHash` to hooks-core

## Background

Multiple demo applications in the loro-extended monorepo implement a pattern for syncing document IDs with the URL hash. This enables shareable links where the hash contains the document ID (e.g., `https://app.example.com/#doc-abc123`).

Currently, three apps have independent implementations:
- **chat**: Robust implementation using `useSyncExternalStore`, SSR-safe, with lazy default generation
- **todo-sse**: Simpler `useState` + `useEffect` implementation
- **video-conference**: Copy of todo-sse's implementation (renamed to `useRoomIdFromHash`)
- **prosemirror-collab**: Inline function with page reload on hash change

The chat implementation is the most robust and follows the Functional Core / Imperative Shell pattern.

## Existing Implementation

**This is a migration task, not new development.** The chat app already has a complete, well-tested implementation at `examples/chat/src/client/use-doc-id-from-hash.ts` with tests at `examples/chat/src/client/use-doc-id-from-hash.test.ts`.

The existing code includes:
- Pure functions: `parseHash()`, `getDocIdFromHash()`
- Hook: `useDocIdFromHash(generateDefaultDocId: () => DocId)`
- Uses `useSyncExternalStore` for concurrent mode safety
- SSR-safe with `getServerSnapshot`
- Writes hash on mount if empty
- Caches generated default in a ref

The work is primarily:
1. Moving/adapting this code into hooks-core's factory pattern
2. Exporting from react/hono packages
3. Deleting duplicated code from example apps

## Problem Statement

Code duplication across example apps leads to:
1. Inconsistent implementations (some SSR-safe, some not)
2. Maintenance burden when fixing bugs or improving the pattern
3. Missed opportunity to provide a standard utility for common use cases

## Success Criteria

1. `useDocIdFromHash` is available from `@loro-extended/react` (and `@loro-extended/hono`)
2. Example apps are updated to use the shared hook, deleting local implementations
3. Pure utility functions (`parseHash`, `getDocIdFromHash`) are exported for testing/reuse
4. Existing tests pass; new tests cover the hook behavior
5. Documentation is updated

## The Gap

- `createHooks` in hooks-core does not include `useDocIdFromHash`
- The `FrameworkHooks` type's `useSyncExternalStore` lacks optional `getServerSnapshot` parameter for SSR
- Example apps have duplicated, divergent implementations

## Phases and Tasks

### Phase 1: Update FrameworkHooks Type ✅

- ✅ Update `useSyncExternalStore` signature in `FrameworkHooks` to include optional `getServerSnapshot`:
  ```typescript
  useSyncExternalStore: <Snapshot>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
    getServerSnapshot?: () => Snapshot,
  ) => Snapshot
  ```

### Phase 2: Add useDocIdFromHash to createHooks ✅

- ✅ Move pure functions from `examples/chat/src/client/use-doc-id-from-hash.ts` to `create-hooks.ts`:
  - `parseHash(hash: string): string` - strips leading `#`
  - `getDocIdFromHash(hash: string, defaultDocId: DocId): DocId` - returns docId or default
- ✅ Adapt `useDocIdFromHash` hook from chat example into `createHooks` factory:
  - Replace direct React imports with `framework` parameter hooks
  - Keep same behavior: lazy generation, `useSyncExternalStore`, hash write on mount
- ✅ Export `useDocIdFromHash` from `createHooks` return object
- ✅ Export pure functions from `hooks-core/src/index.ts` for testing/reuse

### Phase 3: Update @loro-extended/react ✅

- ✅ Export `useDocIdFromHash` from `hooks-core.ts`
- ✅ Export `useDocIdFromHash` from `index.ts`
- ✅ Export `parseHash` and `getDocIdFromHash` utilities from `index.ts`

### Phase 4: Update @loro-extended/hono ✅

- ✅ Export `useDocIdFromHash` from hono package (mirrors react package pattern)

### Phase 5: Update Example Apps ✅

- ✅ **chat**: Delete `use-doc-id-from-hash.ts`, import from `@loro-extended/react`
- ✅ **chat**: Move/adapt tests to hooks-core or keep as integration tests
- ✅ **todo-sse**: Delete `use-doc-id-from-hash.ts`, import from `@loro-extended/react`
- ✅ **video-conference**: Delete `use-room-id-from-hash.ts`, import `useDocIdFromHash` from `@loro-extended/react`
- ⛔ **prosemirror-collab**: Refactor to use `useDocIdFromHash` instead of inline function (optional - lower priority, deferred)

### Phase 6: Documentation and Changeset ✅

- ✅ Create changeset for hooks-core and react packages
- ✅ Update hooks-core README with `useDocIdFromHash` documentation
- ✅ Update react package README if applicable (not needed, hooks-core README is comprehensive)

## Tests

### Unit Tests (hooks-core)

Move tests from `examples/chat/src/client/use-doc-id-from-hash.test.ts` to `packages/hooks-core/src/tests/use-doc-id-from-hash.test.ts`:

1. **Pure function tests** (already written in chat example):
   - `parseHash` removes leading `#`
   - `parseHash` handles empty string and edge cases
   - `getDocIdFromHash` returns hash value when present
   - `getDocIdFromHash` returns default when hash is empty

2. **Hook behavior tests** (adapt from chat example's scenario tests):
   - Returns default docId when hash is empty
   - Returns hash value when hash is present
   - Caches generated default across renders
   - Reacts to `hashchange` events
   - Writes hash on mount when empty

### Integration Tests

The example apps serve as integration tests. After migration, verify:
- Chat app works with shared URLs
- Todo-sse app works with shared URLs
- Video-conference app works with shared URLs

## Transitive Effect Analysis

### Direct Dependencies
- `@loro-extended/hooks-core` → updated with new hook
- `@loro-extended/react` → re-exports new hook
- `@loro-extended/hono` → re-exports new hook

### Transitive Effects
- **Example apps** (chat, todo-sse, video-conference) depend on `@loro-extended/react`
  - After update: can delete local implementations, import from react package
  - No breaking changes - this is additive
- **Downstream consumers** of `@loro-extended/react`
  - No breaking changes - new export is additive
  - `FrameworkHooks` type change is backward compatible (optional parameter)

### Type Compatibility
- The `useSyncExternalStore` signature change adds an optional third parameter
- Existing code passing React's `useSyncExternalStore` will continue to work
- React's signature: `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot?)`

## Resources for Implementation

### Files to Read
- `packages/hooks-core/src/create-hooks.ts` - where to add the hook
- `packages/hooks-core/src/types.ts` - FrameworkHooks type to update
- `packages/hooks-core/src/index.ts` - exports to add
- `packages/react/src/hooks-core.ts` - React bindings to update
- `packages/react/src/index.ts` - React exports to update
- `examples/chat/src/client/use-doc-id-from-hash.ts` - reference implementation
- `examples/chat/src/client/use-doc-id-from-hash.test.ts` - tests to migrate

### Test Helpers
- `packages/hooks-core/src/test-utils.tsx` - existing test utilities
- `packages/hooks-core/src/test-setup.ts` - test setup

### Key Signatures

```typescript
// Pure functions
export function parseHash(hash: string): string
export function getDocIdFromHash(hash: string, defaultDocId: DocId): DocId

// Hook
export function useDocIdFromHash(generateDefaultDocId: () => DocId): DocId
```

## Changeset

Create changeset with:
- `@loro-extended/hooks-core`: minor (new feature)
- `@loro-extended/react`: minor (new export)
- `@loro-extended/hono`: minor (new export)

## README Updates

Update `packages/hooks-core/README.md` to document:
- `useDocIdFromHash` hook usage
- `parseHash` and `getDocIdFromHash` utility functions
- Example usage pattern with `useDocument`

## TECHNICAL.md Updates

No architectural changes required. The implementation follows existing patterns in hooks-core.