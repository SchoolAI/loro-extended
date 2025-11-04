# Refactoring `wantsUpdates`: Remove Cached State, Add `peerWantsUpdates`

## Problem Statement

The current `wantsUpdates` flag is misnamed and conflates two distinct concepts:

1. **Our willingness to share** - Whether we should reveal/announce this document to a channel (based on `canReveal` rule)
2. **Peer's desire to receive** - Whether the peer has explicitly requested this document (via sync-request)

This conflation leads to:
- Conceptual confusion about what the flag means
- Difficulty reasoning about when to send updates vs announcements
- Unclear separation between discovery and subscription
- Caching of derived state that could become stale

## Proposed Solution

### Remove `wantsUpdates` Entirely

The `wantsUpdates` flag represents **our permission to share**, which is derived from the `canReveal` rule. This should be **calculated on-the-fly** rather than stored because:

1. **It's derived state** - Can be computed from available context
2. **Rules can change** - Storing results caches potentially stale values
3. **Current pattern** - Code already calls `canReveal()` on-the-fly in most places
4. **Performance is fine** - `canReveal()` is typically a simple boolean check

### Add `peerWantsUpdates` Flag

This new flag represents **peer's explicit interest** (event-driven state that cannot be derived):
- Set to `true` when peer sends sync-request
- Set to `false` when channel disconnects (or remove channel state)

### Updated Type Definition

```typescript
export type DocChannelState = {
  // Peer's explicit interest in receiving updates
  // Set when peer sends sync-request
  // Determines whether to send sync-response on local changes
  peerWantsUpdates: boolean
  
  loading: LoadingState
}
```

### Decision Logic Pattern

```typescript
// Calculate canReveal on-the-fly when needed
const context = getRuleContext({ channel, docState, model })
if (context instanceof Error || !permissions.canReveal(context)) {
  continue // Not allowed to reveal
}

// Use stored peerWantsUpdates for subscription state
if (state.peerWantsUpdates) {
  // Send sync-response (update)
} else {
  // Send directory-response (announcement)
}
```

## Code Survey Results

### Primary Usage Locations

1. **Type Definition** - `packages/repo/src/types.ts:82-84`
   - Current: `wantsUpdates: boolean`
   - Change to: `canReveal: boolean` + `peerWantsUpdates: boolean`

2. **Helper Function** - `packages/repo/src/synchronizer-program.ts:1086-1100`
   - Current: `setWantsUpdates(docState, channelId, wantsUpdates)`
   - Split into: `setCanReveal()` and `setPeerWantsUpdates()`

3. **Main Logic** - `packages/repo/src/synchronizer-program.ts`
   - 50+ references across the file
   - Key decision points for sending messages

4. **Tests** - Multiple test files
   - 30+ test setup locations
   - Need to update assertions and expectations

## Implementation Consequences

### 1. Type Changes

**File: `packages/repo/src/types.ts`**

```typescript
export type DocChannelState = {
  peerWantsUpdates: boolean   // NEW FLAG (replaces wantsUpdates)
  loading: LoadingState
}

export function createDocChannelState(
  status: Partial<DocChannelState> = {},
): DocChannelState {
  return {
    peerWantsUpdates: false,    // NEW FLAG
    loading: { state: "initial" },
    ...status,
  }
}
```

**Impact:**
- Breaking change to public API
- Simpler than before - one flag instead of two
- All code using `DocChannelState` must update

### 2. Helper Functions

**File: `packages/repo/src/synchronizer-program.ts`**

```typescript
// Replace setWantsUpdates with single function:

function setPeerWantsUpdates(
  docState: DocState,
  channelId: ChannelId,
  peerWantsUpdates: boolean,
): void {
  const status = docState.channelState.get(channelId)
  if (status) {
    status.peerWantsUpdates = peerWantsUpdates
  } else {
    docState.channelState.set(
      channelId,
      createDocChannelState({ peerWantsUpdates }),
    )
  }
}

// Remove setWantsUpdates entirely - no longer needed
```

**Impact:**
- Simpler than original plan - only one helper function
- All calls to `setWantsUpdates()` must be analyzed
- Most will be removed (replaced with on-the-fly `canReveal()` checks)
- Only calls that track peer subscription remain

### 3. Channel Establishment Logic

**Location: `synchronizer-program.ts:530-557` (establish-response handler)**

**Current:**
```typescript
// Set wantsUpdates for all existing documents where canReveal permits
for (const docState of model.documents.values()) {
  const context = getRuleContext({ channel, docState, model })
  if (!(context instanceof Error) && permissions.canReveal(context)) {
    setWantsUpdates(docState, channel.channelId, true)
  }
}
```

**New:**
```typescript
// No need to set anything during establishment!
// canReveal will be checked on-the-fly when needed
// peerWantsUpdates will be set when peer sends sync-request
```

**Impact:**
- **MAJOR SIMPLIFICATION**: Remove this entire loop
- No state to initialize during establishment
- Everything is calculated or event-driven

### 4. Local Document Changes

**Location: `synchronizer-program.ts:272-363` (local-doc-change handler)**

**Current Logic:**
```typescript
// Send updates to all channels with "wantsUpdates"
for (const [channelId, state] of docState.channelState.entries()) {
  if (state.wantsUpdates) {
    // Send sync-response
  }
}
```

**New Logic:**
```typescript
for (const [channelId, state] of docState.channelState.entries()) {
  const channel = model.channels.get(channelId)
  if (!channel || !isEstablished(channel)) continue
  
  // Calculate canReveal on-the-fly
  const context = getRuleContext({ channel, docState, model })
  if (context instanceof Error || !permissions.canReveal(context)) {
    continue // Not allowed to reveal
  }
  
  const peerState = model.peers.get(channel.peerId)
  const peerAwareness = peerState?.documentAwareness.get(docId)
  
  // Decision based on peer subscription state:
  
  if (state.peerWantsUpdates) {
    // Peer has explicitly requested - send update
    commands.push({
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [channelId],
        message: {
          type: "channel/sync-response",
          docId,
          hopCount: 0,
          transmission: { type: "update", data },
        },
      },
    })
  } else if (!peerAwareness || peerAwareness.awareness === "unknown") {
    // Peer doesn't know about this doc yet - send announcement
    commands.push({
      type: "cmd/send-message",
      envelope: {
        toChannelIds: [channelId],
        message: {
          type: "channel/directory-response",
          docIds: [docId],
        },
      },
    })
  }
  // If peerAwareness === "no-doc", don't send anything
}
```

**Impact:**
- **MAJOR BEHAVIOR CHANGE**: Now sends directory-response instead of sync-response for unknown documents
- Implements the pull-based discovery model
- `canReveal` checked on-the-fly (not stored)
- Requires peer awareness tracking to be accurate

### 5. Sync Request Handler

**Location: `synchronizer-program.ts:683-738` (sync-request handler)**

**Current:**
```typescript
// Peer is requesting this doc, so they want updates
setWantsUpdates(docState, fromChannelId, true)
```

**New:**
```typescript
// Peer is requesting this doc - they want updates
setPeerWantsUpdates(docState, fromChannelId, true)
```

**Impact:**
- Simpler: only one flag to set
- Explicitly tracks peer's subscription
- No need to set canReveal (calculated on-the-fly)

### 6. Directory Response Handler

**Location: `synchronizer-program.ts:921-983` (directory-response handler)**

**Current:**
```typescript
// Peer revealed they have this doc, so they want updates
setWantsUpdates(docState, fromChannelId, true)
```

**New:**
```typescript
// Peer revealed they have this doc
// Note: peerWantsUpdates NOT set yet - they haven't requested
// They'll send sync-request next if interested
// No state to set here!
```

**Impact:**
- **REMOVE the setWantsUpdates call entirely**
- More accurate: directory-response doesn't mean they want updates yet
- They must send sync-request to subscribe

### 7. Sync Response Handler (unavailable case)

**Location: `synchronizer-program.ts:841-857`**

**Current Comment:**
```typescript
// IMPORTANT: Don't change wantsUpdates!
// - For storage: wantsUpdates stays true, so it receives future updates
// - For network: wantsUpdates was set by canReveal during establishment
```

**New:**
```typescript
// IMPORTANT: Don't change peerWantsUpdates!
// - peerWantsUpdates stays true (they requested, just don't have it yet)
// This ensures future updates will be sent when document is created
```

**Impact:**
- Simpler comment (only one flag to worry about)
- Behavior unchanged

### 8. Local Document Ensure

**Location: `synchronizer-program.ts:206-269` (local-doc-ensure handler)**

**Current:**
```typescript
// Set wantsUpdates for all established channels where canReveal permits
for (const channel of model.channels.values()) {
  if (isEstablished(channel)) {
    const context = getRuleContext({ channel, docState, model })
    if (!(context instanceof Error) && permissions.canReveal(context)) {
      setWantsUpdates(docState, channel.channelId, true)
    }
  }
}

// Send sync-request to all established channels to load the document
for (const channel of model.channels.values()) {
  if (isEstablished(channel)) {
    const channelState = docState.channelState.get(channel.channelId)
    if (channelState && channelState.wantsUpdates) {
      // Send sync-request
    }
  }
}
```

**New:**
```typescript
// Send sync-request to all channels where canReveal permits
for (const channel of model.channels.values()) {
  if (isEstablished(channel)) {
    const context = getRuleContext({ channel, docState, model })
    if (!(context instanceof Error) && permissions.canReveal(context)) {
      // Send sync-request
      // Note: This will trigger setPeerWantsUpdates when they respond
      commands.push({
        type: "cmd/send-message",
        envelope: {
          toChannelIds: [channel.channelId],
          message: {
            type: "channel/sync-request",
            docs: [{ docId, requesterDocVersion: docState.doc.version() }],
          },
        },
      })
    }
  }
}
```

**Impact:**
- **MAJOR SIMPLIFICATION**: Remove first loop entirely
- Calculate canReveal on-the-fly when sending sync-request
- No state initialization needed

## Test Updates Required

### Test Files to Update

1. **`synchronizer-program.test.ts`** - 20+ locations
2. **`synchronizer.test.ts`** - 15+ locations
3. **`storage-adapter.test.ts`** - May have indirect dependencies

### Test Update Pattern

**Before:**
```typescript
docState.channelState.set(channel.channelId, {
  wantsUpdates: true,
  loading: { state: "initial" },
})
```

**After:**
```typescript
docState.channelState.set(channel.channelId, {
  peerWantsUpdates: true,  // or false, depending on test scenario
  loading: { state: "initial" },
})
```

**Assertion Updates:**
```typescript
// Before
expect(channelState?.wantsUpdates).toBe(true)

// After
expect(channelState?.peerWantsUpdates).toBe(true)
```

**Note:** Many tests may no longer need to set channel state at all, since `canReveal` is calculated on-the-fly.

## Migration Strategy

### Phase 1: Add New Flag (Non-Breaking)

1. Add `peerWantsUpdates` to `DocChannelState` with default `false`
2. Keep `wantsUpdates` temporarily (deprecated)
3. Update logic to use `peerWantsUpdates` for subscription tracking
4. Calculate `canReveal` on-the-fly instead of using `wantsUpdates`
5. Add tests for new behavior

### Phase 2: Remove Old Flag (Breaking)

1. Remove `wantsUpdates` from `DocChannelState`
2. Remove `setWantsUpdates()` helper function
3. Update all references to calculate `canReveal` on-the-fly
4. Update all tests
5. Update documentation

### Phase 3: Implement Pull-Based Discovery

1. Update `local-doc-change` handler to use new logic
2. Send directory-response for announcements (when `canReveal=true` but `peerWantsUpdates=false`)
3. Send sync-response only when both `canReveal=true` AND `peerWantsUpdates=true`
4. Add integration tests

## Risk Assessment

### High Risk Areas

1. **Local document changes** - Major behavior change from push to pull
2. **Test coverage** - 50+ test locations need updates
3. **Backward compatibility** - Breaking change to `DocChannelState`

### Medium Risk Areas

1. **Peer awareness tracking** - Must be accurate for new logic
2. **Edge cases** - Reconnection, concurrent updates, etc.
3. **On-the-fly calculation** - `canReveal()` called more frequently

### Low Risk Areas

1. **Helper functions** - Simpler than original plan (only one function)
2. **Type definitions** - Compile-time safety, simpler type
3. **Documentation** - Already updated
4. **Performance** - `canReveal()` is typically very fast

## Success Criteria

1. ✅ All tests pass with new flag structure
2. ✅ Pull-based discovery works for new documents
3. ✅ Real-time updates work for subscribed documents
4. ✅ Storage adapters continue to work (eager behavior)
5. ✅ No regression in existing functionality
6. ✅ Code is more readable and maintainable
7. ✅ `canReveal` calculated on-the-fly (no stale cache)
8. ✅ Simpler state management (one flag instead of two)

## Open Questions

1. **Backward compatibility**: Do we need a migration path for existing state?
2. **Storage behavior**: Should storage adapters handle directory-response explicitly?
3. **Performance**: Is on-the-fly `canReveal()` calculation acceptable? (Likely yes - it's typically very fast)
4. **Peer awareness**: Should we initialize awareness state during establishment?
5. **Edge cases**: What happens if `canReveal` changes while peer is subscribed?

## Next Steps

1. Create feature branch
2. Implement Phase 1 (add `peerWantsUpdates`)
3. Write tests for new behavior
4. Implement Phase 2 (rename `wantsUpdates`)
5. Update all tests
6. Implement Phase 3 (pull-based discovery)
7. Integration testing
8. Documentation updates
9. Code review
10. Merge to main

## Related Documents

- [discovery-and-sync-architecture.md](../docs/discovery-and-sync-architecture.md) - Architecture overview
- [synchronizer-program.ts](../packages/repo/src/synchronizer-program.ts) - Main implementation
- [types.ts](../packages/repo/src/types.ts) - Type definitions