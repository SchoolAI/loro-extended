---
"@loro-extended/repo": patch
---

Refactor: Extract focused modules from Synchronizer

Decomposed the monolithic Synchronizer class into focused, testable modules:

- `WorkQueue` - Unified work queue for deferred execution
- `OutboundBatcher` - Batches outbound messages by channel
- `EphemeralStoreManager` - Manages namespaced ephemeral stores
- `HeartbeatManager` - Manages periodic heartbeat
- `MiddlewareProcessor` - Handles middleware execution

The Synchronizer now implements `MiddlewareContextProvider` interface for clean abstraction.

This is an internal refactor with no public API changes.
