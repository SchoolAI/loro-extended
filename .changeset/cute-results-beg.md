---
"@loro-extended/adapter-websocket": minor
---

Fix an issue where return sync-request was not being made in websocket adapter. For now, use authPayload as a hack to cover this mismatch between our protocol and Loro Websocket Protocol.
