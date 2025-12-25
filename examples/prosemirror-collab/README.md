# Collaborative ProseMirror Example

A real-time collaborative rich text editor built with:

- **[loro-prosemirror](https://github.com/loro-dev/loro-prosemirror)** - ProseMirror binding for Loro CRDT
- **@loro-extended/adapter-websocket** - WebSocket sync using the Loro Syncing Protocol
- **@loro-extended/adapter-leveldb** - Server-side persistence
- **Fastify** - Fast Node.js web framework
- **Vite** - Next-generation frontend tooling
- **React** - UI framework

## Features

- ✅ Real-time collaborative text editing
- ✅ Cursor presence with user names and colors
- ✅ Collaborative undo/redo
- ✅ Server-side persistence (LevelDB)
- ✅ URL-based document sharing (`#docId`)
- ✅ Automatic reconnection

## Quick Start

```bash
# From the loro-extended root directory
pnpm install

# Start the development server
cd examples/prosemirror-collab
pnpm dev
```

Open http://localhost:5173 in your browser.

## Integration Pattern: External Store via `addEphemeral()`

This example demonstrates the **elegant** way to integrate loro-extended with external libraries that bring their own `EphemeralStore`. The key insight is:

- **Document**: Use `Shape.doc({ doc: Shape.any() })` to opt out of document typing
- **Cursor Sync**: Use `handle.addEphemeral()` to register the external store for automatic network sync

### Why This Pattern?

loro-prosemirror provides its own `CursorEphemeralStore` class that extends `EphemeralStore` from loro-crdt. Instead of creating a bridge layer to sync between two stores, we simply register loro-prosemirror's store directly with loro-extended:

```typescript
// Just one line, and you get presence propagated across the network
handle.addEphemeral("cursors", cursorStore);
```

The Synchronizer automatically:

- Subscribes to store changes (`by='local'` triggers broadcast)
- Applies incoming network data (`by='import'` updates the store)

### Document Schema

```typescript
// src/shared/schemas.ts
export const ProseMirrorDocSchema = Shape.doc({
  doc: Shape.any(), // loro-prosemirror manages this
});
```

### Getting the Handle

```typescript
// src/client/app.tsx
const handle = repo.get(docId, ProseMirrorDocSchema);
// No ephemeral declarations needed - we use addEphemeral() instead
```

### Editor Integration

```typescript
// src/client/editor.tsx
export function Editor({ handle, userName }: EditorProps) {
  useEffect(() => {
    const loroDoc = handle.loroDoc;
    const containerId = loroDoc.getMap("doc").id;

    // Create loro-prosemirror's cursor store
    const cursorStore = new CursorEphemeralStore(handle.peerId as PeerID);

    // Register it for network sync - ONE LINE!
    handle.addEphemeral("cursors", cursorStore);

    const plugins = [
      LoroSyncPlugin({ doc: loroDoc, containerId }),
      LoroUndoPlugin({ doc: loroDoc }),
      LoroEphemeralCursorPlugin(cursorStore, {
        user: { name: userName, color: userColor },
      }),
    ];

    // ... create editor
  }, [handle, userName]);
}
```

**Key benefits:**

- **Zero bridge code** - No manual sync between stores
- **No infinite loop guards** - The Synchronizer handles `by='local'` vs `by='import'`
- **Automatic network sync** - Just register the store and it works
- **Works with any EphemeralStore subclass** - Not just loro-prosemirror

### When to Use Each Pattern

| Pattern                                                  | Use Case                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `repo.get(docId, DocShape, { presence: PresenceShape })` | **Internal stores** - you define the shape, loro-extended manages the store |
| `handle.addEphemeral('name', externalStore)`             | **External stores** - library brings its own `EphemeralStore` subclass      |

## How It Works

### Document Sync

The editor uses `loro-prosemirror` to sync ProseMirror state with a Loro CRDT document. Changes are automatically synchronized via WebSocket using the Loro Syncing Protocol.

```
Browser A                    Server                    Browser B
    │                          │                          │
    │  LoroDoc changes         │                          │
    ├─────────────────────────►│                          │
    │                          │  Relay to other peers    │
    │                          ├─────────────────────────►│
    │                          │                          │
    │                          │  LoroDoc changes         │
    │◄─────────────────────────┤◄─────────────────────────┤
    │                          │                          │
```

### Cursor Presence

Cursor positions are synced using `CursorEphemeralStore` from `loro-prosemirror`, registered directly with loro-extended via `handle.addEphemeral()`. Each user's cursor position and selection are visible to other collaborators in real-time.

### Storage

- **Server**: LevelDB stores documents persistently in `./data/prosemirror-docs`

When a client connects:

1. Request document from server via WebSocket
2. Server sends snapshot or update
3. Merge with any local state

## Project Structure

```
examples/prosemirror-collab/
├── index.html              # HTML entry point
├── package.json            # Dependencies
├── vite.config.ts          # Vite configuration
├── src/
│   ├── main.tsx            # React entry with LogTape config
│   ├── index.css           # Tailwind + ProseMirror styles
│   ├── shared/
│   │   └── schemas.ts      # Document schema (Shape.any())
│   ├── client/
│   │   ├── app.tsx         # Main app with URL routing
│   │   ├── editor.tsx      # ProseMirror editor component
│   │   └── repo-provider.tsx      # Repo context
│   └── server/
│       ├── server.ts       # Fastify server
│       ├── repo.ts         # Server Repo with LevelDB
│       └── ws-router.ts    # WebSocket routes
```

## Development

### Running in Development Mode

```bash
pnpm dev
```

This starts:

- Fastify server on port 5173
- Vite dev server with HMR

### Building for Production

```bash
pnpm build
```

### Type Checking

```bash
pnpm typecheck
```

## URL Routing

Documents are identified by the URL hash:

- `http://localhost:5173/#doc-abc123` - Opens document `doc-abc123`
- `http://localhost:5173/` - Creates a new document with a random ID

Share the URL to collaborate with others!

## Keyboard Shortcuts

| Shortcut           | Action |
| ------------------ | ------ |
| `Cmd/Ctrl+Z`       | Undo   |
| `Cmd/Ctrl+Y`       | Redo   |
| `Cmd/Ctrl+Shift+Z` | Redo   |
| `Cmd/Ctrl+B`       | Bold   |
| `Cmd/Ctrl+I`       | Italic |

## Architecture Notes

### loro-prosemirror Integration

This example uses `loro-prosemirror` which provides:

- `LoroSyncPlugin` - Syncs ProseMirror state with a Loro document
- `LoroUndoPlugin` - Collaborative undo/redo that respects CRDT semantics
- `LoroEphemeralCursorPlugin` - Real-time cursor presence
- `CursorEphemeralStore` - Manages cursor state for all peers (extends `EphemeralStore`)

### The One Type Cast

When using `Shape.any()` with loro-prosemirror, one type cast is needed:

```typescript
LoroSyncPlugin({
  doc: loroDoc as LoroDocType, // loro-prosemirror expects specific type
  containerId,
});
```

This is because loro-prosemirror's TypeScript types expect a specific `LoroDocType`, but the underlying `LoroDoc` is compatible at runtime. This is the minimal friction when integrating with external libraries.

## License

MIT
