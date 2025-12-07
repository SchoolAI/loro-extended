# Plan: Deprecate `all` in favor of `peers` on PresenceInterface

## Overview

Deprecate the `all` property on `PresenceInterface` in favor of a new `peers` property. The key differences:

- **`peers`**: Returns `Map<string, ObjectValue>` - does NOT include self
- **`all`** (deprecated): Returns `Record<string, ObjectValue>` - includes self (synthesized from `peers` + `self`)

## Files to Modify

### 1. `packages/change/src/presence-interface.ts`
**Changes:**
- Add new `peers` property: `readonly peers: Map<string, ObjectValue>`
- Add JSDoc `@deprecated` to `all` property
- Update `all` documentation to note it's synthesized from `peers` + `self`

```typescript
export interface PresenceInterface {
  // ... existing properties ...

  /**
   * The current peer's presence state.
   */
  readonly self: ObjectValue

  /**
   * Other peers' presence states, keyed by peer ID.
   * Does NOT include self.
   */
  readonly peers: Map<string, ObjectValue>

  /**
   * All peers' presence states, keyed by peer ID.
   * @deprecated Use `peers` and `self` separately. This property is synthesized
   * from `peers` and `self` for backward compatibility.
   */
  readonly all: Record<string, ObjectValue>

  // ... rest of interface ...
}
```

---

### 2. `packages/change/src/typed-presence.ts`
**Changes:**
- Add new `peers` getter that returns `Map<string, Infer<S>>`
- Add JSDoc `@deprecated` to `all` getter
- Update `subscribe` callback type to include `peers`

```typescript
export class TypedPresence<S extends ContainerShape | ValueShape> {
  /**
   * Get other peers' presence states with placeholder values merged in.
   * Does NOT include self.
   */
  get peers(): Map<string, Infer<S>> {
    const result = new Map<string, Infer<S>>()
    for (const [peerId, value] of this.presence.peers) {
      result.set(peerId, mergeValue(this.shape, value, this.placeholder) as Infer<S>)
    }
    return result
  }

  /**
   * Get all peers' presence states with placeholder values merged in.
   * @deprecated Use `peers` and `self` separately.
   */
  get all(): Record<string, Infer<S>> {
    // existing implementation
  }

  subscribe(
    cb: (state: { 
      self: Infer<S>
      peers: Map<string, Infer<S>>
      /** @deprecated Use `peers` and `self` separately */
      all: Record<string, Infer<S>> 
    }) => void,
  ): () => void {
    cb({ self: this.self, peers: this.peers, all: this.all })
    return this.presence.subscribe(() => {
      cb({ self: this.self, peers: this.peers, all: this.all })
    })
  }
}
```

---

### 3. `packages/repo/src/untyped-doc-handle.ts`
**Changes:**
- Update `initializePresenceInterface()` to implement `peers` as the primary source
- Synthesize `all` from `peers` + `self`

```typescript
initializePresenceInterface(): PresenceInterface {
  const docId = this.docId
  const synchronizer = this.synchronizer
  const myPeerId = this.synchronizer.identity.peerId

  return {
    // ... existing set, get, self, setRaw ...

    get peers() {
      // Return all peers EXCEPT self as a Map
      const allStates = synchronizer.getAllEphemeralStates(docId)
      const result = new Map<string, ObjectValue>()
      for (const [peerId, value] of Object.entries(allStates)) {
        if (peerId !== myPeerId) {
          result.set(peerId, value)
        }
      }
      return result
    },

    get all() {
      // Synthesize from peers + self for backward compatibility
      return synchronizer.getAllEphemeralStates(docId)
    },

    // ... subscribe ...
  }
}
```

---

### 4. `packages/hooks-core/src/index.ts`
**Changes:**
- Update `PresenceContext` type to include `peers`
- Update both `useUntypedPresence` and `usePresence` to compute and return `peers`

```typescript
type PresenceContext<T> = {
  self: T
  peers: Map<string, T>
  /** @deprecated Use `peers` and `self` separately */
  all: Record<string, T>
  setSelf: (value: Partial<T>) => void
}
```

Update `computeState` in both hooks:
```typescript
const computeState = () => {
  const allRecord = handle.presence.all as Record<string, T>
  const peersMap = handle.presence.peers as Map<string, T>
  const self = handle.presence.self as T
  return { self, peers: peersMap, all: allRecord, setSelf }
}
```

---

## Test Files to Update

These tests use `.all` and should be updated to also test `.peers`:

1. **`packages/repo/src/untyped-doc-handle.test.ts`** (line 75)
   - Add test for `handle.presence.peers`
   - Verify `peers` is a Map
   - Verify `peers` does not include self

2. **`packages/repo/src/typed-presence.test.ts`** (line 55)
   - Add test for `presence.peers`
   - Verify typed `peers` Map

3. **`packages/repo/src/ephemeral.test.ts`** (lines 68, 84, 122, 164, 175)
   - Update tests to use `peers.get(peerId)` alongside existing `all[peerId]`

4. **`packages/repo/src/tests/ephemeral-hub-spoke.test.ts`** (lines 105, 137, 140, 169, 181-182, 239)
   - Update tests to verify `peers` Map behavior

5. **`packages/repo/src/tests/ephemeral-presence-before-connect.test.ts`** (lines 98, 109, 171, 177, 213)
   - Update tests to use `peers`

6. **`packages/repo/src/tests/ephemeral-timing.test.ts`** (lines 95, 99, 128, 131, 159, 185, 211-212, 284, 292)
   - Update tests to use `peers`

---

## Example Usage (bumper-cars)

**`examples/bumper-cars/src/server/server.ts`** (line 72)

Current:
```typescript
return arenaHandle.untypedPresence.all as Record<string, GamePresence>
```

Can migrate to:
```typescript
// Convert Map to Record if needed for existing code
const peers = arenaHandle.untypedPresence.peers
const result: Record<string, GamePresence> = {}
for (const [id, presence] of peers) {
  result[id] = presence as GamePresence
}
return result
```

Or use Map directly if the consuming code can be updated.

---

## Migration Path for Consumers

1. **Immediate**: Code using `all` continues to work unchanged
2. **Recommended**: Migrate to `peers` + `self` pattern:

```typescript
// Before
const allPresence = handle.presence.all
for (const peerId of Object.keys(allPresence)) {
  // process allPresence[peerId]
}

// After
const { self, peers } = handle.presence
// Process self separately if needed
for (const [peerId, presence] of peers) {
  // process presence
}
```

---

## Todo List

- [ ] Update `PresenceInterface` in `packages/change/src/presence-interface.ts`
- [ ] Update `TypedPresence` in `packages/change/src/typed-presence.ts`
- [ ] Update `initializePresenceInterface` in `packages/repo/src/untyped-doc-handle.ts`
- [ ] Update `PresenceContext` and hooks in `packages/hooks-core/src/index.ts`
- [ ] Add tests for `peers` property in `packages/repo/src/untyped-doc-handle.test.ts`
- [ ] Add tests for `peers` property in `packages/repo/src/typed-presence.test.ts`
- [ ] Update ephemeral tests to also verify `peers` behavior
- [ ] Create changeset documenting the deprecation