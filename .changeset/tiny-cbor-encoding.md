---
"@loro-extended/adapter-websocket": minor
---

Replace MessagePack with tiny-cbor for wire format encoding. Uses CBOR (RFC 8949) which provides a smaller library footprint (~1KB gzipped) while maintaining compact binary encoding. Also allows bun to package without .cjs complication.
