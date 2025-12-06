# example-video-conference

## 1.2.0

### Minor Changes

- 0879e51: When generating a UUID, prefer crypto.generateUUID, but gracefully fall back to other means in insecure contexts

### Patch Changes

- Updated dependencies [ab2d939]
- Updated dependencies [a26a6c2]
- Updated dependencies [0879e51]
  - @loro-extended/change@0.7.0
  - @loro-extended/repo@0.7.0
  - @loro-extended/react@0.7.0
  - @loro-extended/adapter-leveldb@0.7.0
  - @loro-extended/adapter-sse@0.7.0
  - @loro-extended/adapter-webrtc@0.7.0

## 1.1.0

### Minor Changes

- 21dd3fb: Added visual audio indicator on pre-join-screen, along with device selector options

### Patch Changes

- Updated dependencies [10502f5]
- Updated dependencies [26ca4cd]
- Updated dependencies [b9da0e9]
- Updated dependencies [c67e26c]
- Updated dependencies [76a18ba]
  - @loro-extended/adapter-sse@0.6.0
  - @loro-extended/change@0.6.0
  - @loro-extended/react@0.6.0
  - @loro-extended/repo@0.6.0
  - @loro-extended/adapter-webrtc@0.6.0
  - @loro-extended/adapter-leveldb@0.6.0

## 1.0.0

### Major Changes

- 302c74d: Created examples/video-conference app to demonstrate p2p audio and video in the browser. The signaling is passed via loro-extended 'presence' channel, and a loro doc separately tracks state. Currently uses SSE and http POST for state sync, with WebRTC just for audio/video.

### Minor Changes

- 7b9d296: Rename examples (package names); remove bundler size warning
- 3ebcf03: Add dual-network adapter example in video-conference example: simultaneous WebRTC and SSE/POST network adapters enable video conference even when server goes down.

### Patch Changes

- 302c74d: Moved position of mic/camera icons near video bubble
- Updated dependencies [61c1c42]
- Updated dependencies [9b291dc]
- Updated dependencies [17e390d]
- Updated dependencies [204fda2]
  - @loro-extended/adapter-leveldb@0.5.0
  - @loro-extended/adapter-sse@0.5.0
  - @loro-extended/repo@0.5.0
  - @loro-extended/adapter-webrtc@0.2.0
  - @loro-extended/react@0.5.0
  - @loro-extended/change@0.5.0
