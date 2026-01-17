# Collaborative Form Example

This example demonstrates best practices for building collaborative forms with `loro-extended`. It shows how to choose the right hook based on your form control type and collaboration pattern.

## Features

- **Atomic controls**: Dropdown, counter using `useRefValue`
- **Text controls**: Switchable between `useRefValue` and `useCollaborativeText`
- **Network delay simulation**: Slider to add 0-10s delay to outgoing messages
- **Undo/Redo**: Full undo/redo support with keyboard shortcuts
- **Real-time sync**: Changes sync instantly across browser tabs

## Running the Example

```bash
# From the repository root
pnpm install

# Start the dev server
pnpm --filter example-collaborative-text dev
```

Then open http://localhost:5173 in multiple browser tabs to see real-time collaboration.

## Choosing the Right Approach

The key insight: **choose your hook based on the control type and collaboration pattern**.

| Control Type | Hook | Why |
|--------------|------|-----|
| Dropdown, Checkbox, Radio | `useRefValue` | Atomic values - last-write-wins is intuitive |
| Counter, Slider | `useRefValue` | CRDT counter handles concurrent increments |
| Text (rarely concurrent) | `useRefValue` | Simpler, controlled inputs work fine |
| Text (concurrent editing) | `useCollaborativeText` | Character-level merge preserves all edits |

### Atomic Controls (Always `useRefValue`)

For controls with discrete/atomic values, `useRefValue` is the natural choice because "last-write-wins" is the intuitive behavior:

```tsx
// Dropdown - selecting an option is atomic
function StatusDropdown({ statusRef }: { statusRef: TextRef }) {
  const { value } = useRefValue(statusRef);
  return (
    <select value={value} onChange={(e) => statusRef.update(e.target.value)}>
      <option value="draft">Draft</option>
      <option value="published">Published</option>
    </select>
  );
}

// Counter - increment/decrement operations merge via CRDT
function PrioritySelector({ priorityRef }: { priorityRef: CounterRef }) {
  const { value } = useRefValue(priorityRef);
  return (
    <div>
      <button onClick={() => priorityRef.decrement(1)}>−</button>
      <span>{value}</span>
      <button onClick={() => priorityRef.increment(1)}>+</button>
    </div>
  );
}
```

### Text Controls (Depends on Collaboration Pattern)

For text inputs, the choice depends on whether concurrent editing is expected:

#### `useRefValue` - For Single-User Sync or Turn-Based Editing

```tsx
function ControlledInput({ textRef }: { textRef: TextRef }) {
  const { value, placeholder } = useRefValue(textRef);
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => textRef.update(e.target.value)}
    />
  );
}
```

**Best for:**
- Settings pages
- Form fields where only one person edits at a time
- Single-user apps with cross-device sync

**Tradeoff:** During concurrent editing, `textRef.update()` replaces the entire text, which can produce unexpected merges.

#### `useCollaborativeText` - For Real-Time Collaboration

```tsx
function CollaborativeInput({ textRef }: { textRef: TextRef }) {
  const { inputRef, defaultValue, placeholder } =
    useCollaborativeText<HTMLInputElement>(textRef);
  return (
    <input
      ref={inputRef}
      defaultValue={defaultValue}
      placeholder={placeholder}
    />
  );
}
```

**Best for:**
- Document editing (Google Docs-style)
- Chat inputs
- Any text field where users might type simultaneously

**Benefit:** Character-level operations preserve user intent during merges.

## Network Delay Simulation

The difference between `useRefValue` and `useCollaborativeText` is **hard to see** when testing locally because messages sync almost instantly. To make the merge behavior visible, use the **Network Delay slider** in the toolbar.

### How It Works

The slider adds a delay (0-10 seconds, default 3s) to all **outgoing** messages using the `addSendInterceptor` API:

```typescript
// Delay all outgoing messages
wsAdapter.addSendInterceptor((ctx, next) => {
  setTimeout(next, networkDelay)
})
```

### Testing the Difference

1. Open two browser tabs
2. Set the delay to 3 seconds on both tabs
3. In Tab A, type "Hello World" in a text field
4. Immediately in Tab B, type "Hello There" in the same field
5. Wait for sync and observe the merge result

**With `useRefValue`:** You'll see unexpected character interleaving because each keystroke replaces the entire text.

**With `useCollaborativeText`:** Both edits are preserved at their insertion points because operations are character-level.

### Why Send-Only Delay?

The interceptor only delays outgoing messages, not incoming ones. This creates an asymmetric delay where:
- Your local edits appear immediately
- Your edits reach others after the delay
- Others' edits reach you immediately

This is actually **better for demonstration** because you can see your local state diverge from the synced state, then watch the merge happen.

## Network Partition Behavior

Understanding how edits merge during network issues helps you choose the right approach.

### Atomic Controls (Dropdown, Checkbox)

During a partition:
1. User A selects "In Review"
2. User B selects "Published"
3. After sync: One wins (based on timestamp)

**This is expected!** There's no meaningful "merge" of two dropdown selections.

### Text with `useRefValue`

During a partition:
1. User A: "Hello" → "Hello World"
2. User B: "Hello" → "Hello There"
3. After sync: "Hello World There" (or similar interleaving)

**Unexpected!** Neither user intended this result.

### Text with `useCollaborativeText`

During a partition:
1. User A types: insert(5, " World")
2. User B types: insert(5, " There")
3. After sync: Both insertions preserved at their positions

**Better!** Both users' complete edits are kept, though the result may still need manual cleanup.

## Schema Definition

```tsx
const FormSchema = Shape.doc({
  // Atomic controls
  status: Shape.text().placeholder("draft"),
  priority: Shape.counter().placeholder(2),
  
  // Text controls
  title: Shape.text().placeholder("Untitled"),
  description: Shape.text(),
  notes: Shape.text(),
});
```

## Undo/Redo

The `useUndoManager` hook provides undo/redo functionality:

```tsx
function Editor({ handle }) {
  const { undo, redo, canUndo, canRedo } = useUndoManager(handle);

  return (
    <div>
      <button onClick={undo} disabled={!canUndo}>Undo</button>
      <button onClick={redo} disabled={!canRedo}>Redo</button>
    </div>
  );
}
```

**Keyboard shortcuts:** Ctrl/Cmd+Z to undo, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z to redo.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Client                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────┐ │
│  │ Form Input  │───▶│   useRefValue    │───▶│  TypedRef  │ │
│  │  (atomic)   │◀───│                  │◀───│            │ │
│  └─────────────┘    └──────────────────┘    └────────────┘ │
│                                                             │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────┐ │
│  │ Text Input  │───▶│ useCollaborative │───▶│  TextRef   │ │
│  │(concurrent) │◀───│      Text        │◀───│ (LoroText) │ │
│  └─────────────┘    └──────────────────┘    └────────────┘ │
│                              │                      │       │
│                              ▼                      ▼       │
│                     ┌──────────────┐        ┌───────────┐  │
│                     │ UndoManager  │        │  LoroDoc  │  │
│                     └──────────────┘        └───────────┘  │
│                                                    │        │
└────────────────────────────────────────────────────┼────────┘
                                                     │
                                              WebSocket Sync
                                                     │
┌────────────────────────────────────────────────────┼────────┐
│                       Server                       │        │
│                                             ┌──────▼─────┐  │
│                                             │    Repo    │  │
│                                             └────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Vite** - Dev server with HMR and WASM support
- **React** - UI framework
- **loro-extended** - CRDT-based collaborative state
- **WebSocket** - Real-time sync transport
