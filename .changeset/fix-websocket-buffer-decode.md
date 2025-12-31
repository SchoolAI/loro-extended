---
"@loro-extended/adapter-websocket": patch
---

Fix "Unsupported data type" error when decoding WebSocket messages in Bun

The `decodeFrame` function now normalizes `Buffer` subclasses to plain `Uint8Array` before passing to the CBOR decoder. This fixes compatibility with Bun's WebSocket implementation which may return `Buffer` instances instead of plain `Uint8Array`.
