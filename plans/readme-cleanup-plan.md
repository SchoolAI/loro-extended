# README Documentation Cleanup Plan

## Overview

This plan addresses accuracy issues in the README documentation across the repository, focusing on:
1. Root `README.md`
2. `packages/repo/README.md`
3. `packages/change/README.md`

## Issues Identified

### 1. Root README.md

#### Broken/Incorrect Links
- ✅ `examples/chat` - EXISTS (was concerned it didn't exist, but it does)
- ✅ `examples/todo-sse` - EXISTS
- ✅ `examples/video-conference` - EXISTS
- ✅ `examples/bumper-cars` - EXISTS
- ✅ `examples/hono-counter` - EXISTS
- ✅ `examples/todo-websocket` - EXISTS
- ✅ `examples/postgres` - EXISTS
- ✅ `adapters/indexeddb` - EXISTS
- ✅ `adapters/leveldb` - EXISTS
- ✅ `adapters/postgres` - EXISTS
- ✅ `adapters/sse` - EXISTS
- ✅ `adapters/websocket` - EXISTS
- ✅ `adapters/webrtc` - EXISTS
- ✅ `adapters/http-polling` - EXISTS

All links verified as correct.

#### Deprecated API Usage (Lines 146-165)
```typescript
// Current (deprecated):
const schema = Shape.doc({
  todos: Shape.list(
    Shape.map({  // ❌ Shape.map is deprecated
      text: Shape.text(),
      done: Shape.plain.boolean(),
    })
  ),
});
```

**Fix**: Replace `Shape.map()` with `Shape.struct()`

#### API Function Name Issue (Lines 160-164)
```typescript
// Current (incorrect):
batch(doc, (draft) => {
  draft.todos.push({ text: "Buy milk", done: false });
});
```

**Fix**: Replace `batch()` with `change()` - the actual exported function name

### 2. packages/change/README.md

#### Incorrect Function Name Throughout
The README uses `batch()` extensively but the actual exported function is `change()`.

**Affected sections:**
- Line 31: `import { createTypedDoc, Shape, batch, toJSON }`
- Line 60-64: `batch(doc, draft => { ... })`
- Line 145-149: `batch(doc, (draft) => { ... })`
- Line 159-198: Multiple `batch()` references
- Line 203-208: Table comparing `batch()` vs direct mutations
- Line 210: Note about `$.change()` and `$.batch()`
- Line 317-323: `batch(doc, (draft) => { ... })`
- Line 415-427: `batch()` documentation
- Line 457-462: `doc.$.batch()` documentation
- Line 524-526: `$.batch()` reference
- Line 627-628: `batch()` block reference
- Line 630: `batch()` block reference
- Line 705-716: `batch(doc, (draft) => { ... })`

**Fix**: Replace all `batch()` with `change()` throughout the document

#### Deprecated API Usage
Multiple uses of `Shape.map()` and `Shape.plain.object()`:
- Line 84-106: `Shape.map()` examples
- Line 289-323: `Shape.map()` in nested structures
- Line 330-344: `Shape.map()` in map operations
- Line 350-382: `Shape.map()` in lists with container items

**Fix**: Replace `Shape.map()` with `Shape.struct()` and `Shape.plain.object()` with `Shape.plain.struct()`

### 3. packages/repo/README.md

#### Deprecated API Usage
- Line 40-53: Uses `Shape.plain.object()` instead of `Shape.plain.struct()`
- Line 113-127: Uses `Shape.plain.object()` instead of `Shape.plain.struct()`
- Line 248-255: Uses `Shape.plain.object()` instead of `Shape.plain.struct()`
- Line 420-430: Uses `Shape.plain.object()` instead of `Shape.plain.struct()`

**Fix**: Replace `Shape.plain.object()` with `Shape.plain.struct()`

## Todo List

### Root README.md
- [x] Replace `Shape.map()` with `Shape.struct()` in code examples (line ~150)
- [x] Replace `batch()` with `change()` in code examples (line ~160)
- [x] Update import statement to use `change` instead of `batch` (line ~146)

### packages/change/README.md
- [x] Update import statement: `batch` → `change` (line 31)
- [x] Replace all `batch()` function calls with `change()` (~15 occurrences)
- [x] Replace all `Shape.map()` with `Shape.struct()` (~10 occurrences)
- [x] Replace all `Shape.plain.object()` with `Shape.plain.struct()` (~8 occurrences)
- [x] Update the "When to Use" table to reference `change()` instead of `batch()`
- [x] Update the note about `$.batch()` to reference `$.change()`
- [x] Update API Reference section for `batch()` → `change()`

### packages/repo/README.md
- [x] Replace all `Shape.plain.object()` with `Shape.plain.struct()` (~4 occurrences)
- [x] Replace `batch()` with `change()` in code examples
- [x] Verify all code examples are accurate with current API

## Implementation Notes

1. **Backward Compatibility**: The deprecated APIs (`Shape.map()`, `Shape.plain.object()`) still work, but documentation should use the current recommended APIs.

2. **Function Naming**: The functional helper is `change()` (exported from `@loro-extended/change`), not `batch()`. The README appears to have been written with a planned name that was changed.

3. **Struct Terminology**: Per CHANGELOG 1.0.0, the term "struct" was adopted for fixed-key objects to avoid confusion with JavaScript's `Map` (dynamic keys). The term "map" implied dynamic keys, while "struct" clearly communicates fixed, known keys.

## Verification Steps

After making changes:
1. Ensure all code examples in READMEs would compile if extracted
2. Verify all internal links point to existing files
3. Check that API references match actual exports from `packages/change/src/index.ts`