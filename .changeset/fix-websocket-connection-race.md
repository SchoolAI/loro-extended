---
"@loro-extended/adapter-websocket": patch
"@loro-extended/adapter-websocket-compat": patch
---

Fix intermittent WebSocket connection establishment race condition

The WebSocket server adapter was calling `establishChannel()` immediately after sending the "ready" signal, which could cause a race condition where binary messages arrived before the client had processed "ready" and created its channel.

**Changes:**
- Remove `establishChannel()` call from server adapters (websocket and websocket-compat)
- The server's channel now gets established when it receives the client's `establish-request`
- Add test verifying server does not send binary before client sends establish-request
- Update documentation in `docs/messages.md` to clarify the establishment protocol

This aligns the WebSocket adapters with the SSE adapter pattern, where only the client initiates the establishment handshake.
