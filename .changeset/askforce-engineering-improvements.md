---
"@loro-extended/askforce": minor
---

Engineering improvements for reliability and maintainability.

**Changes:**
- Ask IDs now use cryptographically secure UUIDs (via `generateUUID` from repo)
- Errors now include context (askId, peerId, mode, timeoutMs) for easier debugging
- New `AskforceError` class exported for structured error handling
- Reduced unsafe `any` type assertions with type guards

**Removed from public API:**
- `isPresenceExpired` (internal only)
- `DEFAULT_PRESENCE_TIMEOUT` (unused after v3)

**Internal:**
- Consolidated test utilities into `test-utils.ts`
