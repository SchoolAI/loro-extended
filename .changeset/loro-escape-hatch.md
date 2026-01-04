---
"@loro-extended/change": minor
---

Add `loro()` escape hatch function, `doc.change()` method, and JavaScript-native StructRef API

## New Features

### `loro()` Function

A new `loro()` function is the recommended way to access underlying Loro primitives:

```typescript
import { loro } from "@loro-extended/change"

// Access underlying LoroDoc
loro(ref).doc

// Access underlying Loro container (correctly typed)
loro(ref).container  // LoroList, LoroMap, LoroText, etc.

// Subscribe to changes
loro(ref).subscribe(callback)

// Container operations
loro(list).pushContainer(loroMap)
loro(list).insertContainer(0, loroMap)
loro(struct).setContainer('key', loroMap)
loro(record).setContainer('key', loroMap)

// For TypedDoc
loro(doc).doc
loro(doc).docShape
loro(doc).rawValue
loro(doc).applyPatch(patch)
```

### `doc.change()` Method

The `change()` method is now available directly on TypedDoc:

```typescript
// NEW (recommended)
doc.change(draft => {
  draft.count.increment(10)
  draft.title.update("Hello")
})

// Supports chaining
doc
  .change(draft => draft.count.increment(1))
  .change(draft => draft.count.increment(2))
```

### JavaScript-Native StructRef API

StructRef now uses a Proxy-based implementation that provides JavaScript-native object behavior:

```typescript
const schema = Shape.doc({
  settings: Shape.struct({
    darkMode: Shape.plain.boolean().placeholder(false),
    fontSize: Shape.plain.number().placeholder(14),
    theme: Shape.plain.string().placeholder("light"),
  }),
})

const doc = createTypedDoc(schema)

// Property assignment (NEW - recommended)
doc.settings.darkMode = true
doc.settings.fontSize = 16
doc.settings.theme = "dark"

// Property access
console.log(doc.settings.darkMode) // true

// Object.keys()
console.log(Object.keys(doc.settings)) // ['darkMode', 'fontSize', 'theme']

// 'key' in obj
console.log('darkMode' in doc.settings) // true

// delete obj.key (for optional properties)
delete doc.settings.theme
```

## Breaking Changes

### StructRef `.set()` Method Removed

The `.set(key, value)` method on StructRef is no longer available. Use property assignment instead:

```typescript
// OLD (no longer works)
doc.settings.set("darkMode", true)

// NEW (required)
doc.settings.darkMode = true
```

**Note:** RecordRef still has `.set()` since records have dynamic keys:

```typescript
// Records still use .set() for dynamic keys
doc.users.set("alice", { name: "Alice" })
```

## Deprecations

The `$` namespace is now deprecated but remains for backward compatibility:

```typescript
// OLD (deprecated)
doc.$.change(draft => { ... })
doc.$.loroDoc
ref.$.loroDoc
ref.$.loroContainer
ref.$.subscribe(cb)

// NEW (recommended)
doc.change(draft => { ... })
loro(doc).doc
loro(ref).doc
loro(ref).container
loro(ref).subscribe(cb)
```

Container operations on refs are also deprecated in favor of `loro()`:
- `list.pushContainer(c)` → `loro(list).pushContainer(c)`
- `struct.setContainer(k, c)` → `loro(struct).setContainer(k, c)`

## Migration

1. Replace `doc.$.change()` with `doc.change()`
2. Replace `ref.$.loroDoc` with `loro(ref).doc`
3. Replace `ref.$.loroContainer` with `loro(ref).container`
4. Replace `ref.$.subscribe(cb)` with `loro(ref).subscribe(cb)`
5. Replace `list.pushContainer(c)` with `loro(list).pushContainer(c)`
6. Replace `struct.setContainer(k, c)` with `loro(struct).setContainer(k, c)`
7. **Replace `struct.set("key", value)` with `struct.key = value`**
