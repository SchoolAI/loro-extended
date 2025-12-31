---
"@loro-extended/change": minor
---

Add typed TreeRef and TreeNodeRef for type-safe tree operations

- Add `TreeNodeRef` class wrapping `LoroTreeNode` with typed `data` property
- Rewrite `TreeRef` class with full typed API including `createNode()`, `roots()`, `nodes()`, `getNodeByID()`, `move()`, `delete()`, `toJSON()`, `toArray()`
- Add `TreeNodeJSON` type for serialized tree nodes with `data` and `fractionalIndex` properties
- Transform Loro's native tree format (`meta`/`fractional_index`) to typed format (`data`/`fractionalIndex`) in serialization
- Fix `isValueShape` to include "any" valueType
