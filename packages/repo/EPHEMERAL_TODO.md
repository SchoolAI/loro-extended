# Ephemeral Store Implementation Todo List

## 1. State & Types
- [ ] Update `packages/repo/src/channel.ts` to add `ChannelMsgEphemeral` type.
  - `type: "channel/ephemeral"`
  - `data: Uint8Array`

## 2. Synchronizer Program (The Logic)
- [ ] Update `packages/repo/src/synchronizer-program.ts`:
  - Add `cmd/apply-ephemeral` to `Command` type.
  - Update `mutatingChannelUpdate` to handle `channel/ephemeral` and return `cmd/apply-ephemeral`.

## 3. Runtime (`synchronizer.ts`)
- [ ] Update `packages/repo/src/synchronizer.ts`:
  - Add `ephemeralStores: Map<DocId, EphemeralStore>` to `Synchronizer` class.
  - Implement `getOrCreateEphemeralStore(docId)` helper.
  - Implement `setEphemeral(docId, key, value)`.
  - Implement `getEphemeral(docId)`.
  - Handle `cmd/apply-ephemeral` in `#executeCommand`.
  - Wire up `subscribeLocalUpdates` to broadcast `channel/ephemeral`.
  - Wire up `subscribe` to emit `ephemeral-change` event.

## 4. DocHandle Integration
- [ ] Update `packages/repo/src/doc-handle.ts`:
  - Add `ephemeral` property to `DocHandle` class.
  - Implement `set(key, value)` for self-centric updates.
  - Implement `get(key)` for self-centric retrieval.
  - Implement `self` getter for full self state.
  - Implement `all` getter for global state.
  - Implement `setRaw(key, value)` escape hatch.
  - Implement `subscribe(cb)`.

## 5. Initial Sync
- [ ] Update `packages/repo/src/synchronizer/handle-sync-request.ts`:
  - When sending `sync-response`, also generate a `cmd/send-message` with `channel/ephemeral` containing `store.encodeAll()`.

## 6. Testing
- [ ] Create a test file `packages/repo/src/ephemeral.test.ts` to verify:
  - Setting and getting local ephemeral state.
  - Syncing ephemeral state between peers.
  - Timeout behavior (mocked if possible).
  - `DocHandle` API convenience methods.