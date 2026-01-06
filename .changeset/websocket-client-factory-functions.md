---
"@loro-extended/adapter-websocket": minor
---

Add factory functions for WebSocket client creation with clear API separation:

- `createWsClient()` - For browser-to-server connections (no headers option)
- `createServiceWsClient()` - For service-to-service connections (supports headers for auth)

This provides a clearer API that guides developers to the correct usage pattern based on their environment. The `WsClientNetworkAdapter` class constructor is now deprecated in favor of these factory functions.

New exports: `createWsClient`, `createServiceWsClient`, `ServiceWsClientOptions`
