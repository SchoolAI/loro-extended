---
"@loro-extended/askforce": minor
---

Improved Pool mode efficiency with staggered claiming.

**Pool Mode Changes:**
- Workers now use deterministic priority to avoid duplicate work
- Priority worker claims immediately; others wait 500ms then check
- Configurable via `claimWindowMs` option
- In the common case, only one worker processes each ask

**Removed:**
- Dead worker detection (unnecessary complexity)
- `checkDeadWorkers()` internal method
- Liveness polling interval

**No changes to:**
- RPC mode behavior
- Public API (`ask()`, `onAsk()`, `waitFor()`)
- Schema definitions
