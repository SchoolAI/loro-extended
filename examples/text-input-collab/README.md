# Collaborative Text Inputs Example

This example demonstrates best practices for binding plain HTML `<input>` and `<textarea>` elements to `LoroText` containers for real-time collaborative editing.

## Features

- **Bidirectional sync**: Local changes are immediately reflected in the CRDT, and remote changes update the input
- **Cursor preservation**: Cursor position is maintained during remote edits
- **Undo/Redo**: Full undo/redo support with keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z)
- **IME support**: Proper handling of composition events for CJK input methods

## Running the Example

```bash
# From the repository root
pnpm install

# Start the dev server
pnpm --filter example-text-input-collab dev
```

Then open http://localhost:5173 in multiple browser tabs to see real-time collaboration.

## Key Concepts

### useCollaborativeText Hook

The `useCollaborativeText` hook binds an HTML input or textarea to a `TextRef`:

```tsx
import { useCollaborativeText, type TextRef } from "@loro-extended/react"

function CollaborativeInput({ textRef }: { textRef: TextRef }) {
  const { inputRef, handlers, defaultValue } =
    useCollaborativeText<HTMLInputElement>(textRef)

  return (
    <input
      ref={inputRef}
      defaultValue={defaultValue}
      onBeforeInput={handlers.onBeforeInput}
      onCompositionStart={handlers.onCompositionStart}
      onCompositionEnd={handlers.onCompositionEnd}
    />
  )
}
```

The hook:
1. Captures `beforeinput` events to translate user actions into LoroText operations
2. Subscribes to the LoroText container for remote changes
3. Updates the input value while preserving cursor position
4. Handles IME composition events for proper CJK support

### useUndoManager Hook

The `useUndoManager` hook provides undo/redo functionality:

```tsx
import { useUndoManager } from "@loro-extended/react"

function Editor({ handle }) {
  const { undo, redo, canUndo, canRedo } = useUndoManager(handle)

  return (
    <div>
      <button onClick={undo} disabled={!canUndo}>Undo</button>
      <button onClick={redo} disabled={!canRedo}>Redo</button>
    </div>
  )
}
```

The hook:
1. Creates a Loro `UndoManager` for the document
2. Provides `undo` and `redo` functions
3. Tracks `canUndo` and `canRedo` state reactively
4. Sets up keyboard shortcuts automatically (can be disabled via options)

### Schema Definition

```tsx
const TextSchema = Shape.doc({
  title: Shape.text().placeholder("Untitled"),
  description: Shape.text(),
  notes: Shape.text(),
})
```

Each `Shape.text()` creates a `LoroText` container that supports:
- Character-by-character collaborative editing
- Rich text marks (bold, italic, etc.)
- Efficient delta-based synchronization

## Event Handling

The hook uses the `beforeinput` event (InputEvent API) for fine-grained control over text operations:

| Input Type | Description | LoroText Operation |
|------------|-------------|-------------------|
| `insertText` | Normal typing | `insert(pos, text)` |
| `insertFromPaste` | Paste | `delete(start, len)` + `insert(start, text)` |
| `deleteContentBackward` | Backspace | `delete(pos-1, 1)` |
| `deleteContentForward` | Delete key | `delete(pos, 1)` |
| `insertLineBreak` | Enter key | `insert(pos, '\n')` |

## Options

### useCollaborativeText Options

```tsx
useCollaborativeText(textRef, {
  onBeforeChange: () => {
    // Return false to prevent the change
    return true
  },
  onAfterChange: () => {
    // Called after each change (local or remote)
  },
})
```

### useUndoManager Options

```tsx
useUndoManager(handle, {
  mergeInterval: 500, // ms to merge consecutive changes (default: 500)
  enableKeyboardShortcuts: true, // Enable Ctrl/Cmd+Z shortcuts (default: true)
})
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser Client                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────┐ │
│  │ HTML Input  │───▶│ useCollaborative │───▶│  TextRef   │ │
│  │  /Textarea  │◀───│      Text        │◀───│ (LoroText) │ │
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
