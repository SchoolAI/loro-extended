---
"@loro-extended/repo": minor
---

Enhanced RuleContext with full peer identity information

### Changes

The `RuleContext` type now includes complete peer identity information for more robust permission rules:

- **`peerId`** (new): Unique peer identifier - use this for reliable identity checks
- **`peerType`** (new): `"user" | "bot" | "service"` - use for role-based permissions
- **`peerName`** (changed): Now optional (`string | undefined`) - human-readable label only

### Migration

If your rules use `peerName`, consider migrating to `peerId` or `peerType`:

```typescript
// Before (fragile - relies on name which is now optional)
canUpdate: (ctx) => ctx.peerName === "admin"

// After (robust - uses unique identifier or type)
canUpdate: (ctx) => ctx.peerId === "admin-123" || ctx.peerType === "service"
```

### Breaking Changes

- `RuleContext.peerName` is now `string | undefined` instead of `string`
- Rules that depend on `peerName` should check for undefined or migrate to `peerId`/`peerType`
