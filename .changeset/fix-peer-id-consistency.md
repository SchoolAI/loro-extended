---
"@loro-extended/repo": patch
---

Fix LoroDoc PeerID to match Repo identity

Previously, each LoroDoc created by the Repo had a random PeerID instead of the Repo's `identity.peerId`. This caused issues with:

1. **UndoManager behavior** - While the UndoManager still worked correctly (each LoroDoc had its own unique PeerID), the PeerID didn't match the Repo's identity, making debugging difficult.

2. **Change attribution** - Changes in the oplog were attributed to random PeerIDs instead of the Repo's identity.

3. **External tools** - Tools that rely on PeerID matching the Repo's identity would not work correctly.

Now, `createDocState` requires a `peerId` parameter, and all handlers pass `model.identity.peerId` when creating documents. This ensures that:

- `handle.loroDoc.peerId` matches `repo.identity.peerId`
- All documents created by the same Repo have the same PeerID
- UndoManager correctly identifies local vs remote changes
- Changes are properly attributed in the oplog
