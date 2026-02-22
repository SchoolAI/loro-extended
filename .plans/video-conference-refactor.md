# Plan: Video Conference Example Refactoring

## Learnings

### Visibility Permission Semantics

**Visibility controls DISCOVERY, not DATA TRANSFER.** It determines whether a peer can learn that a document exists, NOT whether they can receive data once subscribed.

| Where Visibility IS Checked | Effect of `false` |
|----------------------------|-------------------|
| Initial sync list on connection | Document omitted |
| Announcing new docs to non-subscribed peers | No announcement |
| `directory-request` response | Document omitted |

| Where Visibility is NOT Checked (Bypass) | Behavior |
|------------------------------------------|----------|
| Receiving `sync-request` | Always subscribes peer, returns data |
| Sending updates to subscribed peers | Visibility bypassed |
| Relaying ephemeral/presence | Uses subscriptions only |

**Key insight**: Once a peer subscribes via sync-request, they receive all updates regardless of visibility. The existing e2e tests confirm this: "should sync a document on direct request even if not announced" passes with `visibility: () => false`.

### Implications for the Original Bug

The original hypothesis ("visibility blocks relay") was partially incorrect. With `visibility: false`:
- Ephemeral relay still works (uses subscriptions only)
- Document updates to subscribed peers still work (visibility bypass)
- What's affected: initial sync list and announcements to non-subscribed peers

The actual issue may be **timing-related**: if Client A sends presence before Client B has subscribed (sync-request not yet processed), the ephemeral is only relayed to subscribed peers (none at that moment). The heartbeat (10s) eventually re-broadcasts, but initial presence may be missed.

Changing to `visibility: true` is still the right fix because:
1. It allows the server to include documents in the initial sync list
2. It enables proactive announcements, reducing timing edge cases
3. It's the expected default for a hub-and-spoke relay server

---

## Background

The `examples/video-conference` example demonstrates loro-extended's real-time collaboration features using WebRTC for video/audio and CRDT-synced state for room management and signaling. A deep-dive audit revealed several issues:

1. **Visibility Issue**: Server visibility permission returns `false` for all network peers, preventing proactive document announcements (though sync-requests and subscribed updates still work)
2. **FC/IS Violations**: Complex state transitions mixed with side effects in React hooks
3. **God Component**: `video-conference-app.tsx` (270 lines) orchestrates ~15 hooks with interleaved concerns
4. **Code Duplication**: Presence conversion logic repeated; adapter class embedded in hook file
5. **Type Safety Issues**: Multiple `as any` casts, loose `SignalData` type with index signature

**Key reference files:**
- `TECHNICAL.md` (root) — Adapter architecture, permissions model, testing patterns
- `packages/repo/TECHNICAL.md` — `sync()` API, ephemeral stores, `Doc<D, E>` phantom types
- `examples/video-conference/src/server/server.ts` — Broken visibility permission
- `examples/video-conference/src/client/video-conference-app.tsx` — God component
- `examples/video-conference/src/client/use-webrtc-mesh.ts` — FC/IS violations
- `examples/video-conference/src/client/hooks/use-peer-manager.ts` — Embedded adapter class

## Problem Statement

1. **Clients can't see each other**: The server's `visibility` permission returns `false` for network peers. While this doesn't block sync-requests or ephemeral relay to subscribed peers, it prevents proactive announcements and may cause timing-related issues during initial connection.

2. **Untestable business logic**: Peer lifecycle decisions (who to connect to, when to create/destroy peers) are computed inside `useEffect` bodies, making them impossible to unit test without rendering hooks.

3. **Maintenance burden**: The main app component has too many responsibilities. Changes to presence handling risk breaking WebRTC; changes to UI risk breaking sync logic.

4. **Type safety gaps**: `SignalData` accepts `[key: string]: any`, and multiple `as any` casts hide potential runtime errors.

## Success Criteria

- Two browser clients joining the same room see each other's video
- Peer action computation (`computePeerActions`) is a pure function with unit tests
- `SimplePeerDataChannelWrapper` is in its own file with independent tests
- `video-conference-app.tsx` is under 150 lines, delegating to focused hooks
- No `as any` casts; `SignalData` uses `unknown` at boundaries with proper type guards
- All existing tests pass; new tests cover the refactored pure functions

## The Gap

- Server visibility returns `false` unconditionally for network peers — should return `true` for hub-and-spoke relay pattern
- `computePeerActions` doesn't exist — peer lifecycle logic is inline in `useEffect`
- `SimplePeerDataChannelWrapper` is embedded in `use-peer-manager.ts` — not independently testable
- `useRoom` hook doesn't exist — room + signaling + presence logic scattered in app component
- Type guards for `SignalData` don't exist — raw `as any` casts used instead

## Transitive Effect Analysis

| Changed Module | Direct Dependents | Transitive Impact |
|---|---|---|
| `server.ts` (visibility permission) | Server only | Enables proactive announcements; reduces timing edge cases during initial connection |
| `use-webrtc-mesh.ts` (extract `computePeerActions`) | `video-conference-app.tsx` | No API change; behavioral equivalent |
| `use-peer-manager.ts` (extract wrapper class) | `use-webrtc-mesh.ts` | Import path change only |
| New `use-room.ts` | `video-conference-app.tsx` | App component becomes simpler; no external API change |
| `shared/types.ts` (tighten `SignalData`) | `use-signal-channel.ts`, `use-peer-manager.ts`, `webrtc-protocol.ts` | Type errors may surface in places using `as any`; fix incrementally |

**Key constraint**: All changes are internal to the example. No changes to `@loro-extended/*` packages.

---

## Phase 1: Fix Server Visibility Permission ✅

Enable proactive document announcements for the hub-and-spoke relay pattern.

### Tasks

1. ✅ **Update `server.ts` visibility permission** to return `true` for network peers. The server should relay documents to any subscribed peer:

   ```typescript
   permissions: {
     visibility(_doc, peer) {
       if (peer.channelKind === "storage") return true
       // Network peers can see documents they've subscribed to
       // (subscription is tracked automatically via sync-request)
       return true
     },
   },
   ```

2. 🔴 **Manual integration test**: Start dev server, open two browser tabs to the same room URL, verify both clients see each other's video.

3. ✅ **Add TECHNICAL.md** documenting the architecture, visibility model, signaling flow, and FC/IS patterns.

**Resources**: `examples/video-conference/src/server/server.ts`, `TECHNICAL.md` (Permissions section)

---

## Phase 2: Extract `SimplePeerDataChannelWrapper` Adapter 🔴

Move the 100+ line adapter class out of the hook file for independent testing.

### Tasks

1. 🔴 **Create `src/client/adapters/simple-peer-data-channel.ts`** containing only `SimplePeerDataChannelWrapper`.

2. 🔴 **Update `use-peer-manager.ts`** to import from `../adapters/simple-peer-data-channel.js`.

3. 🔴 **Create `src/client/adapters/simple-peer-data-channel.test.ts`** testing:
   - Event forwarding (`connect` → `open`, `close` → `close`, etc.)
   - `send()` delegates to peer
   - `readyState` reflects peer connection state

4. 🔴 **Run verify**: `pnpm turbo run verify --filter=example-video-conference`

**Resources**: `examples/video-conference/src/client/hooks/use-peer-manager.ts`

---

## Phase 3: Extract Pure `computePeerActions` Function 🔴

Apply FC/IS principle to peer lifecycle management.

### Tasks

1. 🔴 **Create `src/client/domain/peer-actions.ts`** with pure function:

   ```typescript
   export type PeerActions = {
     toCreate: PeerID[]
     toDestroy: PeerID[]
   }

   export function computePeerActions(
     currentPeers: ReadonlySet<PeerID>,
     targetPeers: ReadonlySet<PeerID>,
     signalCreatedPeers: ReadonlySet<PeerID>,
     myPeerId: PeerID,
     hasLocalStream: boolean,
   ): PeerActions
   ```

2. 🔴 **Create `src/client/domain/peer-actions.test.ts`** with unit tests:
   - Returns empty when no changes needed
   - Creates peer when we're initiator and have stream
   - Does not create when we're not initiator (waits for signal)
   - Does not create without local stream
   - Destroys peer when removed from target
   - Does not destroy signal-created peers

3. 🔴 **Refactor `use-webrtc-mesh.ts`** to use `computePeerActions` in the effect:

   ```typescript
   useEffect(() => {
     const { toCreate, toDestroy } = computePeerActions(
       currentPeerIdsRef.current,
       new Set(participantPeerIds.filter(id => id !== myPeerId)),
       signalCreatedPeersRef.current,
       myPeerId,
       !!localStream,
     )
     for (const peerId of toCreate) { createPeer(peerId); currentPeerIdsRef.current.add(peerId) }
     for (const peerId of toDestroy) { destroyPeer(peerId); currentPeerIdsRef.current.delete(peerId) }
   }, [participantPeerIds, myPeerId, localStream, createPeer, destroyPeer])
   ```

4. 🔴 **Run verify**.

**Resources**: `examples/video-conference/src/client/use-webrtc-mesh.ts`, `examples/video-conference/src/shared/webrtc-protocol.ts` (`shouldInitiate`)

---

## Phase 4: Create `useRoom` Hook 🔴

Consolidate room document + signaling document + presence logic into one focused hook.

### Tasks

1. 🔴 **Create `src/client/hooks/use-room.ts`** encapsulating:
   - Room document with `RoomSchema` and `UserEphemeralDeclarations`
   - Signaling document with `SignalingDocSchema` and `SignalingEphemeralDeclarations`
   - Presence conversion (eliminate duplicate loops)
   - `joinRoom`, `leaveRoom`, `removeParticipant` callbacks
   - Return type: `UseRoomReturn` with all needed state and actions

2. 🔴 **Export types** from `hooks/index.ts`.

3. 🔴 **Refactor `video-conference-app.tsx`** to use `useRoom(roomId, displayName)` instead of inline document/presence logic. Target: under 150 lines.

4. 🔴 **Run verify**.

**Resources**: `examples/video-conference/src/client/video-conference-app.tsx`, `examples/video-conference/src/shared/types.ts`

---

## Phase 5: Tighten `SignalData` Types 🔴

Improve type safety at the signaling boundary.

### Tasks

1. 🔴 **Update `SignalData` in `shared/types.ts`**:

   ```typescript
   export type SignalData =
     | { type: "offer"; sdp: string; targetInstanceId?: string }
     | { type: "answer"; sdp: string; targetInstanceId?: string }
     | { type: "candidate"; candidate: RTCIceCandidateInit; targetInstanceId?: string }
   ```

2. 🔴 **Create type guard** `isSignalData(value: unknown): value is SignalData` in `shared/types.ts`.

3. 🔴 **Update `use-signal-channel.ts`** to validate incoming signals with the type guard instead of `as any`.

4. 🔴 **Update `use-peer-manager.ts`** to use discriminated union properly (remove `signal as any`).

5. 🔴 **Run verify** — fix any type errors surfaced by stricter types.

**Resources**: `examples/video-conference/src/shared/types.ts`, `examples/video-conference/src/client/hooks/use-signal-channel.ts`

---

## Phase 6: Cleanup and Documentation 🔴

### Tasks

1. 🔴 **Remove debug `console.log` statements** from `video-conference-app.tsx` (the `biome-ignore` lines).

2. 🔴 **Memoize presence conversion** in `useRoom` using `useMemo` to avoid recomputing on every render.

3. ✅ **TECHNICAL.md already created** in Phase 1 — documents architecture, visibility model, signaling flow, and FC/IS patterns.

4. 🔴 **Update `examples/video-conference/README.md`** if any usage changes (unlikely).

5. 🔴 **Run full verify**.

**Resources**: `examples/video-conference/README.md`

---

## Tests

| Test | Location | What it validates |
|---|---|---|
| `computePeerActions` unit tests | `domain/peer-actions.test.ts` | Pure function behavior for all edge cases |
| `SimplePeerDataChannelWrapper` tests | `adapters/simple-peer-data-channel.test.ts` | Adapter event forwarding and state |
| Existing `use-webrtc-mesh.test.ts` | `client/use-webrtc-mesh.test.ts` | No regressions from refactor |
| Existing `use-participant-cleanup.test.ts` | `hooks/use-participant-cleanup.test.ts` | No regressions |
| Manual integration test | Browser | Two clients see each other (Phase 1 fix verified) |

---

## Changeset

No changeset needed — changes are internal to the example, not published packages.

---

## Documentation Updates

| Document | Update |
|---|---|
| `examples/video-conference/TECHNICAL.md` | ✅ **Created** — Architecture, visibility model, FC/IS patterns |
| `examples/video-conference/README.md` | Review for accuracy; likely no changes |
| Root `TECHNICAL.md` | No changes needed |

---

## Resources for Implementation Context

When implementing each phase, include these files in context:

**Phase 1 (Server Fix)**:
- `examples/video-conference/src/server/server.ts`
- `TECHNICAL.md` §Permissions and Document Architecture

**Phase 2 (Adapter Extraction)**:
- `examples/video-conference/src/client/hooks/use-peer-manager.ts`

**Phase 3 (Pure Function)**:
- `examples/video-conference/src/client/use-webrtc-mesh.ts`
- `examples/video-conference/src/shared/webrtc-protocol.ts`

**Phase 4 (useRoom Hook)**:
- `examples/video-conference/src/client/video-conference-app.tsx`
- `examples/video-conference/src/shared/types.ts`
- `packages/repo/TECHNICAL.md` (sync() API, ephemeral stores)

**Phase 5 (Type Safety)**:
- `examples/video-conference/src/shared/types.ts`
- `examples/video-conference/src/client/hooks/use-signal-channel.ts`
- `examples/video-conference/src/client/hooks/use-peer-manager.ts`
