# Ephemeral Store React API Plan

We want to provide a simple, reactive API for developers to use the Ephemeral Store in React components.

## Goals

1.  **Reactive**: Components should re-render when ephemeral state changes (local or remote).
2.  **Simple**: Easy to set local state and read peer state.
3.  **Typed**: Support TypeScript generics for presence shape.

## Proposed API

### `useEphemeral`

The primary hook for interacting with ephemeral state.

```typescript
function useEphemeral<T = any>(docId: DocId): {
  self: T; // My current presence state
  setSelf: (value: Partial<T>) => void; // Update my presence (merges with existing)
  peers: Record<string, T>; // All peers (including self)
  others: Record<string, T>; // All peers (excluding self)
}
```

**Behavior:**
- `self`: Returns the current peer's ephemeral state. Defaults to `{}`.
- `setSelf`: Updates the current peer's state. It performs a shallow merge with the existing state.
- `peers`: Returns a map of all peers' state (including self).
- `others`: Returns a map of all *other* peers' state (excluding self).

## Implementation Details

1.  **`useDocHandle`**: Reuse the existing hook to get the `DocHandle`.
2.  **`useSyncExternalStore`**: Use this to subscribe to `handle.ephemeral.subscribe`.
3.  **State Management**:
    - The `DocHandle` already holds the state in `ephemeral.all`.
    - We just need to trigger re-renders when it changes.

## Todo List

- [ ] Create `packages/react/src/hooks/use-ephemeral.ts`.
- [ ] Implement `useEphemeral` hook.
- [ ] Export `useEphemeral` from `packages/react/src/index.ts`.