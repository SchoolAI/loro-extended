---
"@loro-extended/change": minor
"@loro-extended/repo": minor
"@loro-extended/hooks-core": minor
---

Add `peers` property to PresenceInterface, deprecate `all`;

**Breaking Change (soft deprecation):**

The `all` property on `PresenceInterface` is now deprecated in favor of the new `peers` property.

**Key differences:**

- `peers`: Returns `Map<string, ObjectValue>` - does NOT include self
- `all` (deprecated): Returns `Record<string, ObjectValue>` - includes self

**Migration:**

```typescript
// Before
const allPresence = handle.presence.all;
for (const peerId of Object.keys(allPresence)) {
  // process allPresence[peerId]
}

// After
const { self, peers } = handle.presence;
// Process self separately if needed
for (const [peerId, presence] of peers) {
  // process presence (Map iteration)
}
```

**Changes:**

- `PresenceInterface.peers`: New `Map<string, ObjectValue>` property (excludes self)
- `PresenceInterface.all`: Deprecated, still works for backward compatibility
- `TypedPresence.peers`: New `Map<string, Infer<S>>` property (excludes self)
- `TypedPresence.all`: Deprecated
- `TypedPresence.subscribe`: Callback now receives `{ self, peers, all }` (peers is new)
- `usePresence` / `useUntypedPresence` hooks: Now return `peers` alongside `all`
