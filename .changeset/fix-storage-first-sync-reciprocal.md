---
"@loro-extended/repo": patch
---

fix: send reciprocal sync-request in storage-first sync path

When a server has a storage adapter and receives a bidirectional sync-request for an unknown document, it now correctly sends the reciprocal sync-request after storage responds. Previously, this was skipped, causing the client to not know the server was subscribed to the document. This prevented ephemeral/presence data from being relayed between clients.

The fix ensures the documented symmetric sync protocol is followed even when the storage-first path is used:
1. Client sends `sync-request` with `bidirectional: true`
2. Server queues request, consults storage
3. Server sends `sync-response` AND reciprocal `sync-request` (now fixed)
4. Client adds server to subscriptions, enabling ephemeral relay