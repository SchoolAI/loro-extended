# example-video-conference

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
