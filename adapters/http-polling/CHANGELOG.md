# @loro-extended/adapter-http-polling

## 2.0.0

### Patch Changes

- Updated dependencies [686006d]
- Updated dependencies [ccdca91]
- Updated dependencies [ae0ed28]
- Updated dependencies [a901004]
- Updated dependencies [977922e]
  - @loro-extended/repo@2.0.0

## 1.1.0

### Patch Changes

- Updated dependencies [4896d83]
  - @loro-extended/repo@1.1.0

## 1.0.1

### Patch Changes

- Updated dependencies [f982d45]
  - @loro-extended/repo@1.0.1

## 1.0.0

### Patch Changes

- Updated dependencies [5d8cfdb]
- Updated dependencies [dafd365]
  - @loro-extended/repo@1.0.0

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

### Patch Changes

- Updated dependencies [c67e26c]
- Updated dependencies [76a18ba]
  - @loro-extended/repo@0.6.0

## 0.5.0

### Minor Changes

- 1f7da1b: Added http-polling adapter for both request/response and long-polling

### Patch Changes

- Updated dependencies [9b291dc]
- Updated dependencies [204fda2]
  - @loro-extended/repo@0.5.0
