---
"@loro-extended/adapter-websocket": major
"@loro-extended/adapter-websocket-compat": major
---

Replaced the Loro Protocol-based WebSocket adapter with a native loro-extended protocol adapter.

**Breaking Changes:**
- `@loro-extended/adapter-websocket` now uses a native wire format (MessagePack) instead of the Loro Syncing Protocol
- The old Loro Protocol adapter is now available as `@loro-extended/adapter-websocket-compat`

**New Native Adapter (`@loro-extended/adapter-websocket`):**
- Directly transmits `ChannelMsg` types without protocol translation
- Full support for all loro-extended message types (batch, directory, delete, new-doc)
- Fixes hub-spoke synchronization issues caused by dropped `channel/batch` messages
- Simpler implementation with better debugging

**Compat Adapter (`@loro-extended/adapter-websocket-compat`):**
- Moved from `@loro-extended/adapter-websocket`
- Use this for interoperability with Loro Protocol servers

**Migration:**
- If you need Loro Protocol compatibility, change imports from `@loro-extended/adapter-websocket` to `@loro-extended/adapter-websocket-compat`
- Otherwise, no changes needed - the API is compatible
