---
"@loro-extended/adapter-websocket": minor
---

Add `wrapBunWebSocket` helper function for Bun runtime support. This provides a new `/bun` export that wraps Bun's `ServerWebSocket` to match the `WsSocket` interface expected by `WsServerNetworkAdapter`.
