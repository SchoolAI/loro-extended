We've made a significant change to DocHandle--the doc (LoroDoc) is no longer available after an async wait. Instead, it is always available. Now, however, our @/packages/repo/src/synchronizer.ts and corresponding @/packages/repo/src/synchronizer-program.ts have built-in assumptions that we need to analyze around this change. There are likely some messages, commands, etc. that are no longer needed, redundant, contradictory, or overly complex. Let's think about the `@loro-extended/repo` package as a whole and at a high level, re-design the messages and commands to correspond to our new simplified design.

Please read @/packages/repo/README.md as well as @/packages/repo/src/synchronizer.md and @/packages/repo/src/doc-handle.md to familiarize yourself with this codebase. Also read @/best/loro-abbrev.md to understand Loro's CRDT system.

The SyncState type is now fully covered by @/packages/repo/src/doc-handle.ts 's DocPeerStatus and ReadyState.

I'm still partial to the idea of containing the DocHandles inside the synchronizer. What if we take the approach that the synchronizer should contain doc handles, not the repo? How would that affect our architecture? Please also note: I've kept some code around at @/packages/repo/src/_clips.ts that is currently unused, but was crucial to the functioning of the repo package and to the DocHandle class specifically. I refactored much of DocHandle and clipped these functions for later analysis. I suspect we need to re-integrate it into the synchronizer.

Please also reference @/packages/repo/src/network/network-adapter.ts and @/packages/repo/src/storage/storage-adapter.ts both of which are under discussion.

Regarding the passing of `doc: LoroDoc` inside the DataSource `request` method: let's talk about this. Is it revealing too much, or is the right level of information hiding? I note that in current implementation, the StorageAdapter has a very specific interface that makes implementing a storage adapter quite easy (only 3 or 4 functions need to be implemented). Is the generic `request` function signature ideal for the "base class" (in scare quotes because I lack a term for this in functional style, but I don't mean to imply we should use OOP) to both the network adapter and storage adapter?

Some thoughts about the SynchronizerModel:
- could `isLoadingFromStorage` be computed from `readyStates`? Along with `isRequestionFromNetwork`?
- I note that `syncStates` has shown up again inside this model. But as far as I can tell, we include everything we need to know about a document in localDocs / DocumentState, no?

I like the unified `cmd-load-from-source` / `cmd-save-to-source` / `cmd-request-from-sources`--nice thinking there.

I like the hybrid approach for functional core / OOP shell where the OOP shell is for external-facing DX.

Thoughts? Discuss in the context of SRP, code re-use, low cognitive load for developers, and parsimonious/elegant code. If there is anything unclear, ask me.

Please make trenchant observations. Then make recommended path forward.

NOTE: We've begun to make plans at @/impl/simple-synchronizer.md , but we are still discussing details. Also, since this library has not yet been published, we do not necessarily need backwards compatibility.
