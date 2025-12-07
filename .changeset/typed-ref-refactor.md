---
"@loro-extended/change": minor
"@loro-extended/repo": patch
"@loro-extended/hooks-core": patch
"@loro-extended/react": patch
"@loro-extended/hono": patch
---

Renamed internal DraftNode classes to TypedRef for clarity:
- `DraftNode` → `TypedRef`
- `DraftNodeParams` → `TypedRefParams`
- `DraftDoc` → `DocRef`
- `MapDraftNode` → `MapRef`
- `ListDraftNode` → `ListRef`
- `ListDraftNodeBase` → `ListRefBase`
- `RecordDraftNode` → `RecordRef`
- `TextDraftNode` → `TextRef`
- `CounterDraftNode` → `CounterRef`
- `MovableListDraftNode` → `MovableListRef`
- `TreeDraftNode` → `TreeRef`

Added `Mutable<T>` type alias (replaces `Draft<T>`).
`Draft<T>` is now deprecated but still exported for backward compatibility.

Added `InferMutableType<T>` type alias (replaces `InferDraftType<T>`).
`InferDraftType<T>` is now deprecated but still exported for backward compatibility.

The `draft-nodes/` directory is now `typed-refs/`.

The `Shape` interface now uses `_mutable` instead of `_draft` for the mutable type parameter.

Added consistent readonly enforcement to all TypedRef mutation methods:
- `TextRef`: `insert`, `delete`, `update`, `mark`, `unmark`, `applyDelta`
- `CounterRef`: `increment`, `decrement`
- `TreeRef`: `createNode`, `move`, `delete`