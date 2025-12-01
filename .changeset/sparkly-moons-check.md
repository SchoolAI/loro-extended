---
"@loro-extended/repo": patch
---

Updated Repo messages to be more efficient with regard to ephemeral state when peers request documents--just pass the ephemeral state along with the sync-request and sync-response, rather than initiating another message loop.
