---
"@loro-extended/repo": patch
---

Add unit tests for all command handlers in synchronizer

- Add `createMockCommandContext()` and related mock factories to test-utils.ts for isolated handler testing
- Create 14 co-located test files with 81 tests covering all command handlers
- Tests cover edge cases like empty data, missing stores, invalid channels, and multi-doc scenarios
- Fix circular type dependency: export `SynchronizerEvents` from command-executor.ts and import in synchronizer.ts
- Remove unnecessary non-null assertion in `#encodeAllPeerStores`
