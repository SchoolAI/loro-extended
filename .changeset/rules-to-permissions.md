---
"@loro-extended/repo": major
---

**BREAKING CHANGE**: Replace `rules` API with `permissions` and `middleware`

The `rules` configuration option has been replaced with a new two-layer architecture:

### Migration Guide

**Before:**
```typescript
const repo = new Repo({
  rules: {
    canReveal: (ctx) => ctx.docId.startsWith("public/"),
    canUpdate: (ctx) => ctx.peerType !== "bot",
    canCreate: (ctx) => ctx.peerType === "user",
    canDelete: (ctx) => ctx.peerType === "service",
  }
})
```

**After:**
```typescript
const repo = new Repo({
  permissions: {
    visibility: (doc, peer) => doc.id.startsWith("public/"),
    mutability: (doc, peer) => peer.peerType !== "bot",
    creation: (docId, peer) => peer.peerType === "user",
    deletion: (doc, peer) => peer.peerType === "service",
  }
})
```

### Key Changes

1. **Renamed options:**
   - `rules` → `permissions`
   - `canReveal` → `visibility`
   - `canUpdate` → `mutability`
   - `canCreate` → `creation`
   - `canDelete` → `deletion`

2. **New function signature:**
   - Old: `(ctx: RuleContext) => boolean`
   - New: `(doc: DocContext, peer: PeerContext) => boolean`
   - Document and peer context are now separate parameters

3. **Removed `canBeginSync`:**
   - This rule was never implemented and has been removed

4. **New middleware layer:**
   - For async operations (external auth, rate limiting, audit logging)
   - See `docs/middleware.md` for details

### New Features

- **Middleware support**: Async operations like external auth services, rate limiting, and audit logging
- **Cleaner API**: Separated document and peer context for better ergonomics
- **Deletion now enforced**: The `deletion` permission is now actually checked (was never implemented before)
