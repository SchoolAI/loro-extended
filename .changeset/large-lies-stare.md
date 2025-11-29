---
"video-conference-app": major
---

Created examples/video-conference app to demonstrate p2p audio and video in the browser. The signaling is passed via loro-extended 'presence' channel, and a loro doc separately tracks state. Currently uses SSE and http POST for state sync, with WebRTC just for audio/video.
