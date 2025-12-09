---
"@loro-extended/adapter-sse": patch
---

Improved SSE reconnection logic and reliability:
- Server: Fixed a channel leak where old connections were not cleaned up when a peer reconnected.
- Client: Added connection state tracking (`disconnected`, `connecting`, `connected`, `reconnecting`).
- Client: Preserves the channel during transient network failures, reducing re-sync overhead.
- Client: Added retry logic with exponential backoff for failed POST requests.
- Client: Added `reconnect` and `postRetry` options to `SseClientNetworkAdapter` configuration.