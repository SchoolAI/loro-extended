# Storage Wants Updates: Separating Intent from State

## Problem Statement

### The Bug

A flaky test in `packages/repo/src/e2e.test.ts` (line 370-426) fails intermittently:

```typescript
it("should reconstruct document from updates alone (no snapshot)", async () => {
  // repo1 creates document and saves to storage1
  const storage1 = new InMemoryStorageAdapter();
  const repo1 = new Repo({ adapters: [storage1] });
  const handle1 = repo1.get("updates-only-doc");
  handle1.change((doc) => {
    /* make changes */
  });
  await vi.runAllTimersAsync();

  // Verify data was saved
  const savedChunks = await storage1.loadRange(["updates-only-doc"]);
  expect(savedChunks.length).toBeGreaterThan(0); // ✓ Passes

  // repo2 created with storage2 (sharing same data)
  const storage2 = new InMemoryStorageAdapter(storage1.getStorage());
  const repo2 = new Repo({ adapters: [storage2] });
  const handle2 = repo2.get("updates-only-doc");
  await handle2.waitForStorage();

  // Document should have content
  expect(handle2.doc.getMap("doc").get("step")).toBe(2); // ✗ Fails: undefined
});
```

**What happens:**

1. `repo2.get(documentId)` sends sync-request to `storage2`
2. `storage2` doesn't have the document in memory yet, responds "unavailable"
3. Synchronizer sets `awareness = "no-doc"` for the storage channel
4. Future updates from `repo2` are NOT sent to `storage2` (because `awareness !== "has-doc"`)
5. Document is never persisted from `repo2`
6. `waitForStorage()` times out or returns empty document

### The Root Cause

The `awareness` property in `DocChannelState` conflates two orthogonal concerns:

```typescript
export type DocChannelState = {
  awareness: "unknown" | "has-doc" | "no-doc"; // Doing too many jobs!
  loading: LoadingState;
};
```

**What `awareness` tries to answer:**

1. "Should I send updates to this channel?" (routing decision)
2. "Does the channel currently have the document?" (state tracking)
3. "Have I queried this channel yet?" (initialization tracking)

**The problem:** When storage responds "unavailable", we must choose:

- Set `awareness = "no-doc"` → Accurate state, but breaks update routing
- Set `awareness = "has-doc"` → Enables updates, but lies about state

**There is no correct answer because the question is malformed.**

### Why Storage Exposes This

Network peers hide this bug because:

- They typically have documents before we ask (via directory-response)
- If they don't have a document, we usually don't want to send it (permissions)

Storage exposes the bug because:

- It starts empty (doesn't have the document)
- But it MUST receive updates (for persistence)

**Storage is the only channel type that routinely needs "send updates = true" while "has document = false".**

## The Core Insight

We need to separate **intent** from **state**:

- **Intent**: "Should this channel receive updates?" (policy decision, relatively stable)
- **State**: "What's the current sync status?" (transient, changes with each sync)

These are orthogonal concerns that should never have been conflated.

Furthermore, **we already have state tracking** - it's called `LoadingState`:

- `loading.state === "found"` → Channel has the document
- `loading.state === "not-found"` → Channel doesn't have the document
- `loading.state === "initial"` → Haven't asked yet

**We don't need a third property to track "has document" - `loading` already does that!**

## Solution: Replace `awareness` with `wantsUpdates`

### New `DocChannelState` Structure

```typescript
export type DocChannelState = {
  wantsUpdates: boolean; // Intent: should this channel receive updates?
  loading: LoadingState; // State: what's the current sync status?
};
```

**That's it.** Remove `awareness` entirely - it's redundant.

### Semantics

**`wantsUpdates`**: Determined by `canReveal(context)` permission

- `true`: Send document updates to this channel
- `false`: Don't send updates (e.g., private document, peer not authorized)
- Set once during channel establishment, rarely changes

**When does `wantsUpdates` change?**

- **Channel establishment** - Set based on `canReveal(context)` when channel becomes established
- **Document creation** - Set for new documents when they're created on an established channel
- **Permission changes** - Could change if `canReveal` logic changes (e.g., document becomes private)

**Key insight:** `wantsUpdates` is **relatively stable** - it's a policy decision, not transient state. It only changes when permissions or rules change, not during normal sync operations.

**Timing constraint:** We can only evaluate `canReveal` **after channel establishment** because `RuleContext` requires `peerName`, which comes from `peerState` that's only created during establishment. The current code already handles this correctly by only calling `canReveal` for `isEstablished(channel)` channels.

**`loading`**: Tracks sync request/response lifecycle (unchanged)

- `"initial"`: No sync request sent yet
- `"requesting"`: Sync request sent, awaiting response
- `"found"`: Channel responded with document data
- `"not-found"`: Channel responded that it doesn't have the document
- `"error"`: An error occurred
- Changes with every sync request/response

### How This Fixes the Bug

**Storage channel lifecycle:**

```
1. Channel established:
   wantsUpdates = canReveal(context)  // true for storage
   loading = "initial"

2. Sync-request sent:
   loading = "requesting"

3. Storage responds "unavailable" (doesn't have doc yet):
   loading = "not-found"
   wantsUpdates = UNCHANGED (still true!)

4. Local document change occurs:
   → Check: wantsUpdates === true? YES
   → Send update to storage
   → Storage saves the update

5. Next sync-request:
   loading = "requesting"

6. Storage responds with data:
   loading = "found"
   wantsUpdates = UNCHANGED (still true)

7. waitForStorage() resolves:
   → Checks: loading.state === "found"? YES
   → Document is ready
```

**The key:** `wantsUpdates` stays `true` even when `loading.state === "not-found"`, so updates continue flowing to storage.

## Implementation Plan

### Phase 1: Update Type Definitions

**File**: `packages/repo/src/types.ts`

1. **Update `DocChannelState`** (line 79):

   ```typescript
   export type DocChannelState = {
     wantsUpdates: boolean;
     loading: LoadingState;
   };
   ```

2. **Update `createDocChannelState()`** (line 84):

   ```typescript
   export function createDocChannelState(
     status: Partial<DocChannelState> = {}
   ): DocChannelState {
     return {
       wantsUpdates: false,
       loading: { state: "initial" },
       ...status,
     };
   }
   ```

3. **Add `channelKind` to `RuleContext`** (line 4):

   ```typescript
   export type RuleContext = {
     doc: LoroDoc;
     docId: DocId;
     peerName: string;
     channelId: ChannelId;
     channelKind: ChannelKind; // NEW: enables rules to distinguish storage vs network
   };
   ```

4. **Update comment on `DocChannelState`** (line 62-78):
   ```typescript
   /**
    * DocChannelState tracks the relationship between a document and a channel.
    *
    * `wantsUpdates`: Whether this channel should receive document updates.
    *   - Determined by canReveal(context) permission
    *   - Set during channel establishment
    *   - Rarely changes (only if permissions change)
    *
    * `loading`: The current sync request/response state.
    *   - Tracks whether we've requested the document from this channel
    *   - Tracks whether the channel has responded and what it said
    *   - Changes with every sync request/response cycle
    *
    * These are orthogonal concerns:
    *   - A channel can want updates even if it doesn't have the document yet (storage)
    *   - A channel can have the document but not want updates (after canReveal becomes false)
    */
   ```

### Phase 2: Update Synchronizer Program

**File**: `packages/repo/src/synchronizer-program.ts`

#### 2.1 Replace `setAwarenessState()` with `setWantsUpdates()`

**Old function** (line 1114):

```typescript
function setAwarenessState(
  docState: DocState,
  channelId: ChannelId,
  awareness: AwarenessState
): undefined;
```

**New function**:

```typescript
function setWantsUpdates(
  docState: DocState,
  channelId: ChannelId,
  wantsUpdates: boolean
): undefined {
  const status = docState.channelState.get(channelId);

  if (status) {
    status.wantsUpdates = wantsUpdates;
  } else {
    docState.channelState.set(
      channelId,
      createDocChannelState({ wantsUpdates })
    );
  }
}
```

#### 2.2 Update `getRuleContext()` to include `channelKind`

**Location**: Line 1083

**Add to return object**:

```typescript
return {
  peerName: peerState.identity.name,
  channelId: channel.channelId,
  doc: docState.doc,
  docId: docState.docId,
  channelKind: channel.kind, // NEW
};
```

#### 2.3 Update all locations that check `awareness`

**Pattern to find**: `state.awareness === "has-doc"` or `channelState.awareness`

**Locations and changes:**

1. **Line 251** - Sending sync-requests during doc-ensure:

   ```typescript
   // OLD
   if (channelState && channelState.awareness === "has-doc") {

   // NEW
   if (channelState && channelState.wantsUpdates) {
   ```

2. **Line 338** - Sending updates during local-doc-change:

   ```typescript
   // OLD
   if (state.awareness === "has-doc") {

   // NEW
   if (state.wantsUpdates) {
   ```

3. **Lines 223, 235, 324, 544** - Setting awareness during channel establishment:

   ```typescript
   // OLD
   setAwarenessState(docState, channel.channelId, "unknown");
   // ... check permissions ...
   setAwarenessState(docState, channel.channelId, "has-doc");

   // NEW
   const context = getRuleContext({ channel, docState, model });
   if (!(context instanceof Error) && permissions.canReveal(context)) {
     setWantsUpdates(docState, channel.channelId, true);
   } else {
     setWantsUpdates(docState, channel.channelId, false);
   }
   ```

#### 2.4 Update sync-response handlers

**Line 775** - "up-to-date" case:

```typescript
case "up-to-date": {
  // Channel has the document and it's up to date
  // No need to change wantsUpdates - it was set during establishment

  // Update peer awareness for reconnection optimization
  setPeerDocumentAwareness(
    peerState,
    channelMessage.docId,
    "has-doc",
    channelMessage.transmission.version,
  )

  return setLoadingStateWithCommand(
    model,
    channelMessage.docId,
    fromChannelId,
    { state: "found", version: channelMessage.transmission.version },
  )
}
```

**Line 803** - "snapshot"/"update" case:

```typescript
case "snapshot":
case "update": {
  // Check permissions
  const context = getRuleContext({ channel, docState, model })
  if (context instanceof Error) {
    return { type: "cmd/log", message: `can't check canUpdate: ${context.message}` }
  }
  if (!permissions.canUpdate(context)) {
    return { type: "cmd/log", message: `rejecting update from ${context.peerName}` }
  }

  // Apply the update
  docState.doc.import(channelMessage.transmission.data)

  // Update peer awareness for reconnection optimization
  const newVersion = docState.doc.version()
  setPeerDocumentAwareness(peerState, channelMessage.docId, "has-doc", newVersion)

  // No need to change wantsUpdates - it was set during establishment

  return setLoadingStateWithCommand(
    model,
    channelMessage.docId,
    fromChannelId,
    { state: "found", version: newVersion },
  )
}
```

**Line 860** - "unavailable" case (THE KEY FIX):

```typescript
case "unavailable": {
  // Channel doesn't have the document (yet, for storage)
  // IMPORTANT: Don't change wantsUpdates!
  // - For storage: wantsUpdates stays true, so it receives future updates
  // - For network: wantsUpdates was set by canReveal during establishment

  // Update peer awareness for reconnection optimization
  setPeerDocumentAwareness(peerState, channelMessage.docId, "no-doc")

  return setLoadingStateWithCommand(
    model,
    channelMessage.docId,
    fromChannelId,
    { state: "not-found" },
  )
}
```

#### 2.5 Update sync-request handler

**Line 724** - Setting awareness when receiving sync-request:

```typescript
// OLD
commands.push(setAwarenessState(docState, fromChannelId, "has-doc"));

// NEW
// Peer is requesting this doc, so they want updates
setWantsUpdates(docState, fromChannelId, true);
```

#### 2.6 Update directory-response handler

**Line 980** - Setting awareness for discovered documents:

```typescript
// OLD
setAwarenessState(docState, fromChannelId, "has-doc");

// NEW
// Peer revealed they have this doc, so they want updates
setWantsUpdates(docState, fromChannelId, true);
```

### Phase 3: Update Storage Adapter

**File**: `packages/repo/src/storage/storage-adapter.ts`

**Line 169** - Already sends "unavailable" when no data:

```typescript
if (chunks.length === 0) {
  // Document not found in storage yet
  // Send "unavailable" to indicate we don't have the data
  // The synchronizer will keep wantsUpdates=true for storage channels
  // so future updates will still be sent to us for persistence
  this.logger.debug("document not found in storage", { docId });
  this.replyUnavailable(docId);
  continue;
}
```

**No changes needed!** The storage adapter already does the right thing.

### Phase 4: Update Tests

**File**: `packages/repo/src/e2e.test.ts`

**Line 417-425** - The failing test should now work:

```typescript
const handle2 = repo2.get(documentId);

// Wait for storage to load the document
await handle2.waitForStorage();

// The document should be ready and have the expected content
const root2 = handle2.doc.getMap("doc");
expect(root2.get("step")).toBe(2);
expect(root2.get("data")).toBe("hello world");
```

**Why it works now:**

1. `repo2.get(documentId)` creates document and sends sync-request to storage
2. Storage responds "unavailable" → `loading.state = "not-found"`, but `wantsUpdates = true`
3. `waitForStorage()` waits for `loading.state === "found"`
4. When `repo1` saves data, storage receives it (because `wantsUpdates === true`)
5. Storage saves the data
6. Next sync-request from `repo2` gets the data
7. `loading.state = "found"`, `waitForStorage()` resolves
8. Document has content ✓

### Phase 5: Update Documentation

1. **`packages/repo/src/types.ts`** - Update `DocChannelState` comment (done in Phase 1)

2. **`packages/repo/src/rules.ts`** - Update `RuleContext` comment:

   ```typescript
   export type RuleContext = {
     doc: LoroDoc;
     docId: DocId;
     peerName: string;
     channelId: ChannelId;
     channelKind: ChannelKind; // "storage" | "network" | "other"
   };
   ```

   Add example:

   ```typescript
   // Example: Storage always gets updates, network peers only for public docs
   const permissions = {
     canReveal: (context) => {
       if (context.channelKind === "storage") {
         return true; // Storage always receives updates for persistence
       }
       return context.docId.startsWith("public-"); // Network peers only for public docs
     },
   };
   ```

3. **`packages/repo/README.md`** - Add section on permissions with `channelKind`

## Migration Strategy

### Backward Compatibility

This is a **breaking change** to the internal `DocChannelState` structure. However:

1. `DocChannelState` is not exported from the public API
2. Only internal synchronizer code accesses it
3. No user-facing API changes
4. Tests may need updates if they inspect internal state

### Semantic Mapping

Old `awareness` states map to new structure as follows:

| Old `awareness` | New `wantsUpdates` | Check `loading` for "has doc"   |
| --------------- | ------------------ | ------------------------------- |
| `"unknown"`     | `false`            | `loading.state === "initial"`   |
| `"has-doc"`     | `true`             | `loading.state === "found"`     |
| `"no-doc"`      | `false`            | `loading.state === "not-found"` |

**Key insight**: The mapping isn't 1:1 because `awareness` was conflating multiple concerns. The new structure separates them cleanly.

## Benefits

1. **Fixes Storage Bug**: Storage receives updates even when it doesn't have the document yet
2. **Simpler Mental Model**: Intent (`wantsUpdates`) vs State (`loading`) is clearer than tri-state `awareness`
3. **Less Redundancy**: Removed duplicate tracking of "has document" (was in both `awareness` and `loading`)
4. **Better DevX**: Developers can control storage vs network behavior via `channelKind` in rules
5. **Type Safety**: Boolean for `wantsUpdates` is simpler than tri-state enum
6. **Fewer Edge Cases**: No need to handle "what if awareness and loading disagree?"

## Testing Strategy

1. **Unit Tests**: Test `wantsUpdates` logic for both storage and network channels
2. **Integration Tests**: Verify the storage persistence bug is fixed
3. **Flakiness Tests**: Run the failing test 100 times to ensure stability
4. **Permission Tests**: Verify `canReveal` with `channelKind` works correctly
5. **Regression Tests**: Ensure existing tests still pass

## Risks and Mitigations

### Risk: Breaking Internal APIs

- **Mitigation**: Comprehensive test coverage, careful review of all `awareness` usage

### Risk: Missed Edge Cases

- **Mitigation**: Thorough code review, look for any logic that depends on `awareness` state

### Risk: Performance Impact

- **Mitigation**: Boolean check is faster than tri-state enum check

## Key Architectural Lessons

1. **Separate Intent from State**: Policy decisions (should send?) vs transient state (has doc?)
2. **Avoid Redundancy**: If two properties track the same thing, you probably only need one
3. **Flaky Tests Indicate Design Problems**: The race condition exposed an architectural flaw
4. **Edge Cases Reveal Abstractions**: Storage's unique needs showed that `awareness` was wrong
5. **Simplicity Wins**: Removing `awareness` entirely is simpler than adding more properties
