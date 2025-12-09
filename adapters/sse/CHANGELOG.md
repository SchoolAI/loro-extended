# @loro-extended/adapter-sse

## 0.9.1

### Patch Changes

- ede3f25: Improved reconnection logic and reliability:
  - Server: Fixed a channel leak where old connections were not cleaned up when a peer reconnected.
  - Client: Added connection state tracking (`disconnected`, `connecting`, `connected`, `reconnecting`).
  - Client: Preserves the channel during transient network failures, reducing re-sync overhead.
  - Client: Added retry logic with exponential backoff for failed POST requests.
  - Client: Added `reconnect` and `postRetry` options to `SseClientNetworkAdapter` configuration.
  - WebSocket: Added connection state tracking and subscription mechanism to `WsClientNetworkAdapter`.
  - HTTP Polling: Added connection state tracking and subscription mechanism to `HttpPollingClientNetworkAdapter`.
  - HTTP Polling: Added retry logic with exponential backoff for failed POST requests.
  - @loro-extended/repo@0.9.1

## 0.9.0

### Patch Changes

- Updated dependencies [9ba361d]
- Updated dependencies [d9ea24e]
- Updated dependencies [702af3c]
  - @loro-extended/repo@0.9.0

## 0.8.1

### Patch Changes

- a6d3fc8: Need to publish hooks-core
- Updated dependencies [a6d3fc8]
  - @loro-extended/repo@0.8.1

## 0.8.0

### Patch Changes

- Updated dependencies [907cdce]
  - @loro-extended/repo@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [a26a6c2]
- Updated dependencies [0879e51]
  - @loro-extended/repo@0.7.0

## 0.6.0

### Minor Changes

- 10502f5: Fix an issue with SSE adapter where successful termination resulted in never reconnecting

### Patch Changes

- Updated dependencies [c67e26c]
- Updated dependencies [76a18ba]
  - @loro-extended/repo@0.6.0

## 0.5.0

### Patch Changes

- 61c1c42: Created new adapters/ workspace dir and added adapter-indexeddb, adapter-leveldb, and adapter-sse. This allows packages to contain separate dependencies.
- Updated dependencies [9b291dc]
- Updated dependencies [204fda2]
  - @loro-extended/repo@0.5.0
