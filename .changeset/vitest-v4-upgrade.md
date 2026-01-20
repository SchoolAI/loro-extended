---
"@loro-extended/repo": patch
"@loro-extended/react": patch
"@loro-extended/change": patch
"@loro-extended/hono": patch
"@loro-extended/hooks-core": patch
"@loro-extended/asks": patch
"@loro-extended/adapter-http-polling": patch
"@loro-extended/adapter-indexeddb": patch
"@loro-extended/adapter-leveldb": patch
"@loro-extended/adapter-postgres": patch
"@loro-extended/adapter-sse": patch
"@loro-extended/adapter-webrtc": patch
"@loro-extended/adapter-websocket": patch
"@loro-extended/adapter-websocket-compat": patch
---

Upgrade vitest from v3.2.4 to v4.0.17

This is an internal tooling upgrade with no changes to the public API. The upgrade includes:

- Updated vitest to ^4.0.17 across all packages and adapters
- Fixed mock type compatibility issues in test files (vitest v4 has stricter mock types)
- Fixed SSE adapter test mock to use class-based constructor mock (required by vitest v4)
- Added timeout to postgres adapter large data test
- Fixed Playwright e2e test port conflicts by assigning unique ports (8000+) to each example:
  - todo-sse: ports 8000/8001
  - username-checker: port 8002
  - todo-websocket: port 8003
