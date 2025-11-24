# Fix useEphemeral Hook and Tests Plan

## CRITICAL ISSUE DISCOVERED

The tests are failing because `synchronizer/ephemeral-local-change` and `synchronizer/heartbeat` messages are not being handled in `synchronizer-program.ts`. This means:

1. When `setSelf()` is called, the local ephemeral store is updated but no event is emitted to React subscribers
2. The heartbeat doesn't broadcast ephemeral state to peers

### Root Cause
- `synchronizer.setEphemeralValues()` dispatches `synchronizer/ephemeral-local-change` but there's no handler
- `synchronizer/heartbeat` is dispatched every 10s but there's no handler
- Without handlers, no commands are returned, so no events are emitted

### Solution
Add handlers in `synchronizer-program.ts` for:
1. `synchronizer/ephemeral-local-change` - emit event + broadcast to peers
2. `synchronizer/heartbeat` - broadcast all ephemeral state to all peers

---

# Fix useEphemeral Hook and Tests Plan

## Overview
Align the `useEphemeral` React hook interface with the refactored `EphemeralInterface` from `doc-handle.ts`. This simplifies the API by removing redundant properties (`peers`, `others`) and exposing the core interface directly.

## Current State Analysis

### EphemeralInterface (doc-handle.ts)
```typescript
type EphemeralInterface = {
  set: (values: ObjectValue) => void
  get: (key: string) => Value
  readonly self: ObjectValue
  readonly all: ObjectValue  // Record<peerId, ObjectValue>
  setRaw: (key: string, value: Value) => void
  subscribe: (cb: (values: ObjectValue) => void) => () => void
}
```

### Current useEphemeral Interface
```typescript
type EphemeralContext<T> = {
  self: T
  peers: Record<string, T>    // ❌ Remove - redundant with 'all'
  others: Record<string, T>   // ❌ Remove - can be computed from 'all'
  setSelf: (value: Partial<T>) => void
}
```

## Changes Required

### 1. Update `useEphemeral.ts` Interface

**File**: `packages/react/src/hooks/use-ephemeral.ts`

#### Change 1.1: Update `EphemeralContext` type
```typescript
// Before
export type EphemeralContext<T> = {
  self: T
  peers: Record<string, T>
  others: Record<string, T>
  setSelf: (value: Partial<T>) => void
}

// After
export type EphemeralContext<T> = {
  self: T
  all: Record<string, T>  // All peers including self, keyed by peerId
  setSelf: (value: Partial<T>) => void
}
```

#### Change 1.2: Update `computeState` function
```typescript
// Before (lines 55-62)
const computeState = () => {
  const peers = handle.ephemeral.all
  const self = peers[handle.peerId] || ({} as T)
  const others = { ...peers }
  delete others[handle.peerId]
  return { self, peers, others, setSelf }
}

// After
const computeState = () => {
  const all = handle.ephemeral.all as Record<string, T>
  const self = handle.ephemeral.self as T
  return { self, all, setSelf }
}
```

#### Change 1.3: Update empty state
```typescript
// Before (lines 39-44)
const emptyState = {
  self: {} as T,
  peers: {},
  others: {},
  setSelf: () => {},
}

// After
const emptyState = {
  self: {} as T,
  all: {},
  setSelf: () => {},
}
```

### 2. Update Tests

**File**: `packages/react/src/hooks/use-ephemeral.test.tsx`

#### Test 1: "should provide self, peers, and others" → "should provide self and all"
```typescript
// Before (lines 7-19)
it("should provide self, peers, and others", async () => {
  const documentId = createTestDocumentId()
  const RepoWrapper = createRepoWrapper()

  const { result } = renderHook(() => useEphemeral(documentId), {
    wrapper: RepoWrapper,
  })

  expect(result.current.self).toEqual({})
  expect(result.current.peers).toEqual({})
  expect(result.current.others).toEqual({})
  expect(typeof result.current.setSelf).toBe("function")
})

// After
it("should provide self and all", async () => {
  const documentId = createTestDocumentId()
  const RepoWrapper = createRepoWrapper()

  const { result } = renderHook(() => useEphemeral(documentId), {
    wrapper: RepoWrapper,
  })

  expect(result.current.self).toEqual({})
  expect(result.current.all).toEqual({})
  expect(typeof result.current.setSelf).toBe("function")
})
```

#### Test 2: Update "should update self state"
```typescript
// Before (lines 21-40)
it("should update self state", async () => {
  const documentId = createTestDocumentId()
  const RepoWrapper = createRepoWrapper()

  const { result } = renderHook(() => useEphemeral(documentId), {
    wrapper: RepoWrapper,
  })

  act(() => {
    result.current.setSelf({ cursor: { x: 10, y: 20 } })
  })

  await waitFor(() => {
    expect(result.current.self).toEqual({ cursor: { x: 10, y: 20 } })
  })
  
  // Peers should also contain self
  // We need to know the peerId to check the key, but we can check values
  expect(Object.values(result.current.peers)).toContainEqual({ cursor: { x: 10, y: 20 } })
})

// After
it("should update self state", async () => {
  const documentId = createTestDocumentId()
  const RepoWrapper = createRepoWrapper()

  const { result } = renderHook(() => useEphemeral(documentId), {
    wrapper: RepoWrapper,
  })

  act(() => {
    result.current.setSelf({ cursor: { x: 10, y: 20 } })
  })

  await waitFor(() => {
    expect(result.current.self).toEqual({ cursor: { x: 10, y: 20 } })
  })
  
  // 'all' should also contain self
  expect(Object.values(result.current.all)).toContainEqual({ cursor: { x: 10, y: 20 } })
})
```

#### Test 3: "should handle partial updates" - No changes needed
This test already works correctly as it only tests `self` and `setSelf`.

#### Test 4: "should support selectors" - No changes needed
This test already works correctly as it only accesses `self`.

### 3. Optional: Add New Test for Multi-Peer Scenarios

Add a test to verify the `all` property works correctly with multiple peers:

```typescript
it("should track multiple peers in all", async () => {
  // This would require setting up a bridge between two repos
  // Similar to packages/repo/src/ephemeral.test.ts
  // We can add this test if needed for comprehensive coverage
})
```

## Implementation Steps

1. ✅ **Analyze** - Understand the changes in `doc-handle.ts` ephemeral interface
2. ✅ **Plan** - Create this detailed plan document
3. **Implement** - Make the changes:
   - Update `EphemeralContext` type in `use-ephemeral.ts`
   - Update `computeState` function
   - Update empty state object
   - Update test descriptions and assertions
4. **Test** - Run tests to verify:
   ```bash
   pnpm --filter @loro-extended/react -- test run src/hooks/use-ephemeral.test.tsx
   ```
5. **Verify** - Check that the chat example still works if it uses `useEphemeral`

## Benefits of This Approach

1. **Simpler API**: Removes redundant `peers` and `others` properties
2. **Aligned with Core**: React hook interface matches `EphemeralInterface`
3. **More Flexible**: Users can compute `others` themselves if needed: `Object.entries(all).filter(([id]) => id !== myPeerId)`
4. **Less Computation**: No need to compute `others` on every state change
5. **Clearer Semantics**: `all` clearly indicates "all peers including self"

## Migration Guide for Users

If any code is using the old interface:

```typescript
// Before
const { self, peers, others } = useEphemeral(docId)

// After
const { self, all } = useEphemeral(docId)
// If you need 'others', compute it:
// const others = Object.fromEntries(
//   Object.entries(all).filter(([peerId]) => peerId !== myPeerId)
// )
```

## Additional Changes Required

### 4. Add Command Type for Emitting Ephemeral Change Event

**File**: `packages/repo/src/synchronizer-program.ts`

Add new command type after line 192:
```typescript
  | {
      type: "cmd/emit-ephemeral-change"
      docId: DocId
    }
```

### 5. Add Handler for `synchronizer/ephemeral-local-change`

**File**: `packages/repo/src/synchronizer-program.ts`

Add case in switch statement (around line 290):
```typescript
      case "synchronizer/ephemeral-local-change": {
        // Get all established channels for this document
        const channelIds: ChannelId[] = []
        for (const [channelId, channel] of model.channels) {
          if (isEstablished(channel)) {
            const peerState = model.peers.get(channel.peerId)
            if (peerState?.subscriptions.has(msg.docId)) {
              channelIds.push(channelId)
            }
          }
        }

        return {
          type: "cmd/batch",
          commands: [
            {
              type: "cmd/emit-ephemeral-change",
              docId: msg.docId,
            },
            {
              type: "cmd/broadcast-ephemeral",
              docId: msg.docId,
              toChannelIds: channelIds,
            },
          ],
        }
      }
```

### 6. Add Handler for `synchronizer/heartbeat`

**File**: `packages/repo/src/synchronizer-program.ts`

Add case in switch statement (around line 273):
```typescript
      case "synchronizer/heartbeat": {
        // Broadcast all ephemeral state for all documents to all peers
        const commands: Command[] = []
        
        for (const docId of model.documents.keys()) {
          const channelIds: ChannelId[] = []
          for (const [channelId, channel] of model.channels) {
            if (isEstablished(channel)) {
              const peerState = model.peers.get(channel.peerId)
              if (peerState?.subscriptions.has(docId)) {
                channelIds.push(channelId)
              }
            }
          }
          
          if (channelIds.length > 0) {
            commands.push({
              type: "cmd/broadcast-ephemeral",
              docId,
              toChannelIds: channelIds,
            })
          }
        }
        
        return commands.length > 0
          ? { type: "cmd/batch", commands }
          : undefined
      }
```

### 7. Add Command Executor for `cmd/emit-ephemeral-change`

**File**: `packages/repo/src/synchronizer.ts`

Add case in `#executeCommand` switch statement (around line 420):
```typescript
      case "cmd/emit-ephemeral-change": {
        this.emitter.emit("ephemeral-change", { docId: command.docId })
        break
      }
```

## Files to Modify

1. ✅ `packages/react/src/hooks/use-ephemeral.ts` - Update interface and implementation (DONE)
2. ✅ `packages/react/src/hooks/use-ephemeral.test.tsx` - Update tests (DONE)
3. ✅ `examples/chat/src/client/App.tsx` - Update to use `all` instead of `peers` (DONE)
4. `packages/repo/src/synchronizer-program.ts` - Add handlers for ephemeral messages
5. `packages/repo/src/synchronizer.ts` - Add command executor for emit-ephemeral-change

### Chat Example Changes

**File**: `examples/chat/src/client/App.tsx`

Line 35 currently uses:
```typescript
const { peers, setSelf } = useEphemeral(docId)
```

Line 42 uses:
```typescript
const memberCount = Object.values(peers).filter((p: any) => p?.type === "user").length
```

**Changes needed**:
```typescript
// Line 35: Change from 'peers' to 'all'
const { all, setSelf } = useEphemeral(docId)

// Line 42: Change from 'peers' to 'all'
const memberCount = Object.values(all).filter((p: any) => p?.type === "user").length
```

## Success Criteria

- ✅ All tests in `use-ephemeral.test.tsx` pass
- ✅ TypeScript compilation succeeds
- ✅ Interface is simpler and aligned with `EphemeralInterface`
- ✅ Chat example still works (if it uses ephemeral)