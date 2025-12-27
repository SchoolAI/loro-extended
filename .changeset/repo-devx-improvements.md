---
"@loro-extended/repo": minor
---

Improve Repo DevX with optional identity, optional adapters, and dynamic adapter management

### New Features

- **Optional Identity**: `identity` parameter is now optional with sensible defaults
  - `peerId` auto-generated if not provided
  - `name` is now optional (undefined is fine)
  - `type` defaults to "user"

- **Optional Adapters**: `adapters` parameter is now optional (defaults to empty array)

- **Dynamic Adapter Management**: Add and remove adapters at runtime
  - `repo.addAdapter(adapter)` - Add an adapter (idempotent)
  - `repo.removeAdapter(adapterId)` - Remove an adapter (idempotent)
  - `repo.hasAdapter(adapterId)` - Check if adapter exists
  - `repo.getAdapter(adapterId)` - Get adapter by ID
  - `repo.adapters` - Get all current adapters

- **Adapter IDs**: Each adapter now has a unique `adapterId`
  - Auto-generated as `{adapterType}-{uuid}` if not provided
  - Can be explicitly set via constructor parameter

### API Examples

```typescript
// Minimal - all defaults
const repo = new Repo()

// Just adapters
const repo = new Repo({ adapters: [storageAdapter] })

// Partial identity
const repo = new Repo({ 
  identity: { type: "service" }
})

// Add adapters dynamically
await repo.addAdapter(networkAdapter)

// Remove when done
await repo.removeAdapter(networkAdapter.adapterId)
```

### Breaking Changes

None - all changes are backwards compatible.
