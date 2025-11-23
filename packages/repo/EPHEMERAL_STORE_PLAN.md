# Ephemeral Store Implementation Plan (Final Simplified)

This plan implements `EphemeralStore` integration using a reactive, event-driven approach where the **Runtime (`Synchronizer`)** manages the stores, and the **SynchronizerProgram** handles message routing.

## Core Concept

`EphemeralStore` is a side-effectful object (WASM, callbacks). It lives in the Runtime. The Program coordinates messages but delegates store operations to the Runtime.

We treat the `EphemeralStore` primarily as a map of `PeerID -> PeerState`.
- **Standard Usage**: Keys are `PeerID`s. Values are objects containing that peer's ephemeral state (cursor, selection, presence, etc.).
- **Escape Hatch**: Users can set arbitrary top-level keys if needed, but the default API focuses on "my peer's state".

## 1. State & Types

**`packages/repo/src/channel.ts`**
- Add `ChannelMsgEphemeral` type (`type: "channel/ephemeral"`, `data: Uint8Array`).

## 2. Synchronizer Program (The Logic)

**New Commands:**
```typescript
| { type: "cmd/apply-ephemeral"; docId: DocId; data: Uint8Array }
```

**Update Logic:**
- Handle `channel/ephemeral` (in `mutatingChannelUpdate`):
    - Return `cmd/apply-ephemeral`.

## 3. Runtime (`synchronizer.ts`)

- **State**: Add `ephemeralStores: Map<DocId, EphemeralStore>`.
- **Helper**: `getOrCreateEphemeralStore(docId)`:
    - Creates store if missing.
    - Wires `subscribeLocalUpdates` -> Broadcast `channel/ephemeral` to subscribed peers.
    - Wires `subscribe` -> Emit `ephemeral-change` event.
- **`setEphemeral(docId, key, value)`**:
    - Get store.
    - Call `store.set(key, value)`.
    - (Broadcast happens automatically via subscription).
- **`getEphemeral(docId)`**:
    - Get store.
    - Return `store.getAllStates()`.
- **`cmd/apply-ephemeral`**:
    - Get store.
    - Call `store.apply(data)`.

## 4. DocHandle Integration

**`packages/repo/src/doc-handle.ts`**
- `ephemeral` property:
    - **`set(key: string, value: any)`**:
        - Updates the state for the *current peer*.
        - Logic:
            ```typescript
            const myPeerId = this.synchronizer.identity.peerId;
            const store = this.synchronizer.getEphemeral(this.docId);
            const currentSelfState = store[myPeerId] || {};
            const newSelfState = { ...currentSelfState, [key]: value };
            this.synchronizer.setEphemeral(this.docId, myPeerId, newSelfState);
            ```
    - **`get(key: string)`**:
        - Returns the value for the *current peer* for the given key.
        - Logic:
            ```typescript
            const myPeerId = this.synchronizer.identity.peerId;
            const store = this.synchronizer.getEphemeral(this.docId);
            return store[myPeerId]?.[key];
            ```
    - **`self` (getter)**:
        - Returns the full state object for the *current peer*.
        - Logic:
            ```typescript
            const myPeerId = this.synchronizer.identity.peerId;
            return this.synchronizer.getEphemeral(this.docId)[myPeerId] || {};
            ```
    - **`all` (getter)**:
        - Returns the entire ephemeral state (all peers).
        - Logic:
            ```typescript
            return this.synchronizer.getEphemeral(this.docId);
            ```
    - **`setRaw(key: string, value: any)`**:
        - Escape hatch to set a top-level key on the EphemeralStore directly.
        - Calls `synchronizer.setEphemeral(this.docId, key, value)`.
    - **`subscribe(cb)`**:
        - Listens to `synchronizer.on("ephemeral-change")`.

## 5. Initial Sync

**`packages/repo/src/synchronizer/handle-sync-request.ts`**
- When sending `sync-response`, also generate a `cmd/send-message` with `channel/ephemeral` containing `store.encodeAll()`.
- This ensures new peers receive the full presence state immediately.

## 6. Cleanup

- We rely on `EphemeralStore`'s internal timeout mechanism.
- When a timeout occurs, `subscribe` fires with `by: "timeout"`.
- This triggers `emit-ephemeral-change` (via the Runtime wiring).
- The UI receives the update and reflects the removal of the timed-out peer.
