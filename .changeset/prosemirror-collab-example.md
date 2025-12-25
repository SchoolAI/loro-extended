---
"@loro-extended/repo": patch
---

# ProseMirror Collaborative Editing Example

Added a new example app demonstrating elegant integration between loro-extended and external libraries that bring their own `EphemeralStore`.

## Key Features

- **`handle.addEphemeral()`** - Register external stores for automatic network sync
- **Zero bridge code** - loro-prosemirror's `CursorEphemeralStore` works directly
- **Shape.any()** - Opt out of document typing when external libraries manage structure

## Integration Pattern

```typescript
// Create loro-prosemirror's cursor store
const cursorStore = new CursorEphemeralStore(handle.peerId);

// Register it for network sync - ONE LINE!
handle.addEphemeral("cursors", cursorStore);

// Use with loro-prosemirror plugins
LoroEphemeralCursorPlugin(cursorStore, { user: { name, color } });
```

The Synchronizer automatically:
- Subscribes to store changes (`by='local'` triggers broadcast)
- Applies incoming network data (`by='import'` updates the store)

This demonstrates that loro-extended can integrate with external libraries **with beauty and grace**.
