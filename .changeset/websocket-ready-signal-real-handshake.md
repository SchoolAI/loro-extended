---
"@loro-extended/adapter-websocket": minor
---

Add ready signal and use real establish protocol

**Ready Signal**
- Server sends "ready" text frame after WebSocket setup completes
- Client waits for "ready" before creating channel and sending messages
- Fixes intermittent connection failures on page refresh caused by race condition

**Real Establish Protocol**
- Remove `simulateHandshake()` which injected fake protocol messages
- Server and client now exchange real `establish-request`/`establish-response` messages
- Peer identities are properly exchanged over the wire (no more hardcoded "server" peerId)
- The Synchronizer's existing handlers process real protocol messages
