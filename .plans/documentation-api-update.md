# Plan: Documentation API Update for v6 Method-Based API

## Background

The loro-extended v6 release introduced a unified method-based API for reading and writing plain values. The core principle is:

1. **Traversal** — Dot notation for schema paths, `.get()` for dynamic/indexed access
2. **Read/Write** — Method notation (`.get()`, `.set()`, etc.) — never assignment or property getters
3. **Uniform** — Same API inside and outside `change()` blocks

This change was implemented in the codebase and documented in:
- `TECHNICAL.md` (root) — API Consistency Principle section
- `packages/change/TECHNICAL.md` — PlainValueRef design
- `docs/migration-v5-to-v6.md` — Sections 10 and 11 (recently added)

However, **many README files and docs still show the old assignment-based patterns**, creating confusion for users.

## Problem Statement

Documentation across the monorepo contains outdated API examples that use:
- Property assignment: `draft.meta.title = "New"` (should be `.set()`)
- Counter value getter: `counter.value` (should be `.get()`)
- List bracket assignment: `list[0] = value` (should be `.set()`)
- Old `useDocument` signature: `const [doc, changeDoc] = useDocument(...)` (should return `Doc`)

This causes user confusion and undermines the migration guide.

## Success Criteria

1. All README.md files use the v6 method-based API exclusively
2. All docs/*.md files use v6 API (except migration-v5-to-v6.md which intentionally shows old patterns)
3. TECHNICAL.md files are consistent with implemented behavior
4. Example READMEs reflect current API patterns
5. No `draft.x = y` assignment patterns remain in documentation (outside migration guide)
6. No `.value` property access on CounterRef in documentation

## The Gap

| File | Issues | Priority |
|------|--------|----------|
| `README.md` (root) | Wrong `useDocument` signature `[doc, changeDoc]`, uses `changeDoc()` | HIGH |
| `packages/change/README.md` | 6+ locations: `draft.metadata.author = "..."`, `delete draft.x`, `counter.value`, nested assignments, find-and-mutate patterns | HIGH |
| `packages/react/README.md` | `todo.completed = !todo.completed` (line 78), `doc.settings.theme = "dark"` (line 263) | HIGH |
| `docs/getting-started.md` | `todo.completed = true` (line 119) | MEDIUM |
| `docs/lea.md` | `draft.status = "reviewing"` (line 354), `draft.game = {...}` (line 897) | MEDIUM |
| `docs/lea-web.md` | `draft.modal = ...` (lines 200, 207), `draft.leaderView = ...` (line 605) | MEDIUM |
| `TECHNICAL.md` (root) | Line 856-858 uses assignment pattern | MEDIUM |
| `examples/chat/README.md` | Uses old `handle.doc.subscribe()` and `typedDoc.value.messages` | MEDIUM |
| `examples/todo-sse/README.md` | Uses `changeDoc()` pattern, `d.todos = []` assignment | MEDIUM |

## Phases and Tasks

### Phase 1: Core Package Documentation ✅

- ✅ **Task 1.1**: Update `README.md` (root) Quick Start section
  - Fix `useDocument` signature to return `Doc` not tuple
  - Replace `changeDoc((d) => ...)` with `change(doc, d => ...)`
  - Add `useValue()` for reactive reads
  - Update RepoProvider example if needed

- ✅ **Task 1.2**: Update `packages/change/README.md`
  - Line 192-194: Replace `draft.metadata.author = "John Doe"` with `.set()`
  - Line 194: Remove `delete draft.metadata.featured` (use `.set(null)` note)
  - Line 937: Replace `const current = draft.count.value` with `.get()`
  - Lines 444-445: Fix `author.name = "Alice"`, `author.email = ...`
  - Lines 464-467: Fix `theme = "dark"`, `collapsed = true`, `width = 250`
  - Lines 985-988: Fix `todo.completed = true`, `todo.text = "..."`

- ✅ **Task 1.3**: Update `packages/react/README.md`
  - Line 78: Replace `todo.completed = !todo.completed` with `.set()`
  - Line 263: Replace `doc.settings.theme = "dark"` with `.set()`

- ✅ **Task 1.4**: Update `packages/hooks-core/README.md`
  - Verify examples use current API
  - Ensure `useDocument` return type is documented correctly

### Phase 2: Architecture Documentation ✅

- ✅ **Task 2.1**: Update `docs/getting-started.md`
  - Line 119: Replace `todo.completed = true` with `.set(true)`

- ✅ **Task 2.2**: Update `docs/lea.md`
  - Line 354-357: Replace `draft.status = "reviewing"` with `.set()`
  - Line 368: Replace `draft.sensors.responses[...] = result` with `.set()`
  - Line 897: Replace `draft.game = {...}` with `.set()`

- ✅ **Task 2.3**: Update `docs/lea-web.md`
  - Lines 167-169, 175-177, 185-187, 192-194: Replace all `draft.navigation.route = ...` with `.set()`
  - Lines 200, 207: Replace `draft.modal = ...` with `.set()`
  - Line 332-334: Replace route assignment with `.set()`
  - Lines 604-610: Replace `draft.leaderView = {...}` with `.set()`

- ✅ **Task 2.4**: Update `TECHNICAL.md` (root)
  - Line 856-858: Fix UndoManager example to use `.set()`

### Phase 3: Example READMEs ✅

- ✅ **Task 3.1**: Update `examples/chat/README.md`
  - Replace `handle.doc.subscribe()` with `loro(doc).subscribe()`
  - Replace `typedDoc.value.messages` with proper ref access

- ✅ **Task 3.2**: Update `examples/todo-sse/README.md`
  - Replace `changeDoc((d) => ...)` pattern with `change(doc, d => ...)`
  - Replace `d.todos = []` initialization with proper pattern
  - Update hook return documentation

- ✅ **Task 3.3**: Audit remaining example READMEs
  - `examples/collaborative-text/README.md` - verify patterns
  - `examples/rps-demo/README.md` - verify patterns
  - `examples/video-conference/README.md` - verify patterns
  - Fix any outdated patterns found

### Phase 4: Verification ✅

- ✅ **Task 4.1**: Grep verification
  - Run: `grep -r "draft\.[a-z]*\s*=" --include="*.md" | grep -v migration | grep -v CHANGELOG | grep -v changeset`
  - Run: `grep -r "\.value\b" --include="*.md" | grep -v migration | grep -v CHANGELOG | grep -v "value\(" | grep -v "plain\."`
  - Run: `grep -r "changeDoc\(" --include="*.md" | grep -v migration | grep -v CHANGELOG`
  - Ensure zero results outside migration guide and historical changelogs

- ✅ **Task 4.2**: Review for consistency
  - Verify all `change()` examples use method-based API
  - Verify all `useDocument` examples show correct signature

## Tests

No automated tests required — this is documentation-only. Verification is via grep patterns in Phase 4.

## Transitive Effect Analysis

| Changed File | Consumers | Impact |
|--------------|-----------|--------|
| `README.md` (root) | New users, GitHub visitors | First impression of API |
| `packages/change/README.md` | Package users | Core API understanding |
| `packages/react/README.md` | React users | React integration patterns |
| `docs/getting-started.md` | New users | Initial learning experience |
| `docs/lea*.md` | Architecture implementers | Correct patterns for reactors |
| Example READMEs | Example users | Working code expectations |

**No code changes** — documentation only. No risk of breaking functionality.

## Resources for Implementation

### Files to Update

```
README.md
packages/change/README.md
packages/react/README.md
packages/hooks-core/README.md
docs/getting-started.md
docs/lea.md
docs/lea-web.md
TECHNICAL.md
examples/chat/README.md
examples/todo-sse/README.md
examples/collaborative-text/README.md
```

### Reference Files (correct patterns)

```
docs/migration-v5-to-v6.md (Sections 10-11)
packages/change/TECHNICAL.md
packages/hooks-core/src/create-hooks.ts (useDocument signature)
examples/todo-minimal/src/app.tsx (correct patterns in actual code)
examples/hono-counter/src/client.tsx (correct patterns in actual code)
```

### Key API Patterns to Use

```typescript
// Reading values
const title = doc.meta.title.get()
const count = doc.counter.get()
const item = doc.items.get(0)

// Writing values
doc.meta.title.set("New Title")
doc.counter.increment(5)
doc.items.set(0, newItem)

// Inside change()
change(doc, draft => {
  draft.meta.title.set("New")
  draft.items.get(0)?.name.set("Updated")
})

// React hooks
const doc = useDocument(docId, schema)
const title = useValue(doc.meta.title)

// Struct property writes
draft.settings.theme.set("dark")
draft.modal.set({ type: "confirm", message: "..." })

// Find-and-mutate
const todo = draft.todos.find(t => t.id === "123")
if (todo) {
  todo.completed.set(true)
  todo.text.set("Updated text")
}
```

## Changeset

Not required — documentation changes do not warrant a changeset.

## README Updates

This plan IS about README updates. See Phase 1 and Phase 3.

## TECHNICAL.md Updates

Minor fix in root TECHNICAL.md (Task 2.4). The package-level TECHNICAL.md files are already correct.

## Other Documentation

- `docs/getting-started.md` updates in Phase 2 (Task 2.1)
- `docs/lea.md` and `docs/lea-web.md` updates in Phase 2
- Migration guide already updated (not part of this plan)