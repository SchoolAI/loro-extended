---
"@loro-extended/hooks-core": minor
---

Add functional updater support to `setSelf` in usePresence hooks

The `setSelf` function returned by `usePresence` and `useUntypedPresence` hooks now accepts either a direct value or a function that receives the current presence state and returns the new partial state, similar to React's `useState` pattern.

**Before (still works):**
```typescript
const { setSelf } = usePresence(docId, PresenceSchema)
setSelf({ cursor: { x: 10, y: 20 } })
```

**New functional updater pattern:**
```typescript
const { setSelf } = usePresence(docId, PresenceSchema)

// Increment x based on current value
setSelf(current => ({
  cursor: { x: current.cursor.x + 1, y: current.cursor.y }
}))
```

This is useful when you need to update presence based on the current state, such as incrementing counters or toggling values.