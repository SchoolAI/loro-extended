---
"@loro-extended/repo": patch
"@loro-extended/adapter-websocket": patch
---

Add synchronous receive queue to Synchronizer for recursion prevention

The Synchronizer now uses a receive queue to handle incoming messages iteratively,
preventing infinite recursion when adapters deliver messages synchronously.

**Key changes:**
- Synchronizer.channelReceive() now queues messages and processes them iteratively
- Removed queueMicrotask() from BridgeAdapter.deliverMessage() - now synchronous
- Removed queueMicrotask() from StorageAdapter.reply() - now synchronous
- Removed queueMicrotask() from WsConnection.handleProtocolMessage() and simulateHandshake()
- Removed queueMicrotask() from WsClientNetworkAdapter.handleProtocolMessage()
- Updated test-utils.ts documentation to explain flushMicrotasks() is rarely needed

**Benefits:**
- Single location for recursion prevention (Synchronizer, not scattered across adapters)
- Works for all adapters automatically (BridgeAdapter, StorageAdapter, WebSocket, future adapters)
- Simpler tests - no async utilities needed for basic message handling
- Completely synchronous message processing within a single dispatch cycle
