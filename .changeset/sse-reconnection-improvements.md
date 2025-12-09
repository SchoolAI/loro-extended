---
"@loro-extended/adapter-sse": patch
"@loro-extended/adapter-websocket": patch
"@loro-extended/adapter-http-polling": patch
---

Improved reconnection logic and reliability:
- Server: Fixed a channel leak where old connections were not cleaned up when a peer reconnected.
- Client: Added connection state tracking (`disconnected`, `connecting`, `connected`, `reconnecting`).
- Client: Preserves the channel during transient network failures, reducing re-sync overhead.
- Client: Added retry logic with exponential backoff for failed POST requests.
- Client: Added `reconnect` and `postRetry` options to `SseClientNetworkAdapter` configuration.
- WebSocket: Added connection state tracking and subscription mechanism to `WsClientNetworkAdapter`.
- HTTP Polling: Added connection state tracking and subscription mechanism to `HttpPollingClientNetworkAdapter`.
- HTTP Polling: Added retry logic with exponential backoff for failed POST requests.