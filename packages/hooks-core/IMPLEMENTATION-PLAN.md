# Implementation Plan: New hooks-core API

## Overview

This plan implements the recommended API from `RECOMMENDED-API.md`. No backward compatibility is required.

## Phase 1: Core Implementation

### Task 1.1: Rewrite `packages/hooks-core/src/index.ts`

**Delete all existing code** and implement the new API:

```typescript
// packages/hooks-core/src/index.ts

import type { DeepReadonly, DocShape, Infer, ValueShape } from "@loro-extended/change"
import type { DocId, Repo, TypedDocHandle } from "@loro-extended/repo"

export interface FrameworkHooks {
  useState: <T>(initialState: T | (() => T)) => [T, (newState: T | ((prevState: T) => T)) => void]
  useEffect: (effect: () => undefined | (() => void), deps?: unknown[]) => void
  useCallback: <T extends Function>(callback: T, deps: unknown[]) => T
  useMemo: <T>(factory: () => T, deps: unknown[]) => T
  useRef: <T>(initialValue: T) => { current: T }
  useSyncExternalStore: <Snapshot>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => Snapshot,
  ) => Snapshot
  useContext: <T>(context: any) => T
  createContext: <T>(defaultValue: T) => any
}

export function createHooks(framework: FrameworkHooks) {
  const { useState, useCallback, useMemo, useSyncExternalStore, useContext, createContext } = framework

  // ============================================
  // RepoContext & useRepo
  // ============================================
  
  const RepoContext = createContext<Repo | null>(null)

  function useRepo(): Repo {
    const repo = useContext(RepoContext)
    if (!repo) throw new Error("useRepo must be used within a RepoProvider")
    return repo as Repo
  }

  // ============================================
  // useHandle - Get typed handle (stable, never re-renders)
  // ============================================

  // Overload: without presence
  function useHandle<D extends DocShape>(
    docId: DocId,
    docSchema: D
  ): TypedDocHandle<D>
  
  // Overload: with presence
  function useHandle<D extends DocShape, P extends ValueShape>(
    docId: DocId,
    docSchema: D,
    presenceSchema: P
  ): TypedDocHandle<D, P>
  
  // Implementation
  function useHandle<D extends DocShape, P extends ValueShape>(
    docId: DocId,
    docSchema: D,
    presenceSchema?: P
  ): TypedDocHandle<D, P> | TypedDocHandle<D> {
    const repo = useRepo()
    
    // Synchronous initialization - no null state, no flickering
    const [handle] = useState(() => {
      if (presenceSchema) {
        return repo.get(docId, docSchema, presenceSchema)
      }
      return repo.get(docId, docSchema)
    })
    
    return handle
  }

  // ============================================
  // useDoc - Select document values (reactive)
  // ============================================

  // Overload: with selector (fine-grained)
  function useDoc<D extends DocShape, R>(
    handle: TypedDocHandle<D>,
    selector: (doc: DeepReadonly<Infer<D>>) => R
  ): R
  
  // Overload: without selector (full doc)
  function useDoc<D extends DocShape>(
    handle: TypedDocHandle<D>
  ): DeepReadonly<Infer<D>>
  
  // Implementation
  function useDoc<D extends DocShape, R>(
    handle: TypedDocHandle<D>,
    selector?: (doc: DeepReadonly<Infer<D>>) => R
  ): R | DeepReadonly<Infer<D>> {
    const subscribe = useCallback(
      (onStoreChange: () => void) => {
        return handle.untyped.doc.subscribe(() => onStoreChange())
      },
      [handle]
    )

    const getSnapshot = useCallback(() => {
      const value = handle.value
      return selector ? selector(value) : value
    }, [handle, selector])

    return useSyncExternalStore(subscribe, getSnapshot)
  }

  // ============================================
  // usePresence - Get presence state (reactive)
  // ============================================

  function usePresence<D extends DocShape, P extends ValueShape>(
    handle: TypedDocHandle<D, P>
  ): { self: Infer<P>; peers: Map<string, Infer<P>> } {
    const subscribe = useCallback(
      (onStoreChange: () => void) => {
        return handle.presence.subscribe(() => onStoreChange())
      },
      [handle]
    )

    const getSnapshot = useCallback(() => {
      return {
        self: handle.presence.self,
        peers: handle.presence.peers,
      }
    }, [handle])

    return useSyncExternalStore(subscribe, getSnapshot)
  }

  // ============================================
  // Exports
  // ============================================

  return {
    RepoContext,
    useRepo,
    useHandle,
    useDoc,
    usePresence,
  }
}
```

**Files to modify:**
- [ ] `packages/hooks-core/src/index.ts` - Complete rewrite

### Task 1.2: Update Type Exports

**File:** `packages/hooks-core/src/index.ts`

Remove old type exports, keep only what's needed:

```typescript
// Export types that consumers might need
export type { FrameworkHooks }
```

### Task 1.3: Update Package Exports

**File:** `packages/hooks-core/package.json`

No changes needed - exports remain the same.

---

## Phase 2: React Package Updates

### Task 2.1: Update React Hooks Export

**File:** `packages/react/src/hooks-core.ts`

```typescript
import { createHooks } from "@loro-extended/hooks-core"
import * as React from "react"

export const {
  RepoContext,
  useRepo,
  useHandle,
  useDoc,
  usePresence,
} = createHooks(React)
```

### Task 2.2: Update React Index Exports

**File:** `packages/react/src/index.ts`

```typescript
// Re-export schema-related types from @loro-extended/change
export type { DocShape, Infer, Mutable, DeepReadonly } from "@loro-extended/change"
export { Shape } from "@loro-extended/change"

// Re-export handle types from @loro-extended/repo
export type { TypedDocHandle, DocId } from "@loro-extended/repo"

// Hooks
export { RepoContext, useRepo, useHandle, useDoc, usePresence } from "./hooks-core.js"

// Context provider
export * from "./repo-context.js"
```

### Task 2.3: Update React Tests

**File:** `packages/react/src/hooks/use-document.test.tsx`

Rewrite tests for new API:

```typescript
import { Shape } from "@loro-extended/change"
import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useHandle, useDoc } from "../index.js"
import { createRepoWrapper, createTestDocumentId } from "../test-utils.js"

const testSchema = Shape.doc({
  title: Shape.text().placeholder("Test Document"),
  count: Shape.counter(),
})

describe("useHandle", () => {
  it("should return a typed handle synchronously", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(() => useHandle(documentId, testSchema), {
      wrapper: RepoWrapper,
    })

    const handle = result.current
    expect(handle).not.toBeNull()
    expect(handle.docId).toBe(documentId)
  })

  it("should return stable handle reference across re-renders", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result, rerender } = renderHook(
      () => useHandle(documentId, testSchema),
      { wrapper: RepoWrapper }
    )

    const firstHandle = result.current
    rerender()
    const secondHandle = result.current

    expect(firstHandle).toBe(secondHandle)
  })
})

describe("useDoc", () => {
  it("should return document value", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, testSchema)
        return useDoc(handle)
      },
      { wrapper: RepoWrapper }
    )

    expect(result.current.title).toBe("Test Document")
    expect(result.current.count).toBe(0)
  })

  it("should support selector for fine-grained access", () => {
    const documentId = createTestDocumentId()
    const RepoWrapper = createRepoWrapper()

    const { result } = renderHook(
      () => {
        const handle = useHandle(documentId, testSchema)
        return useDoc(handle, d => d.title)
      },
      { wrapper: RepoWrapper }
    )

    expect(result.current).toBe("Test Document")
  })
})
```

**Files to modify:**
- [ ] `packages/react/src/hooks/use-document.test.tsx` - Rewrite
- [ ] `packages/react/src/hooks/use-presence.test.tsx` - Rewrite
- [ ] Delete `packages/react/src/hooks/use-untyped-document.test.tsx`

---

## Phase 3: Hono Package Updates

### Task 3.1: Update Hono Hooks Export

**File:** `packages/hono/src/hooks-core.ts`

```typescript
import { createHooks } from "@loro-extended/hooks-core"
import * as Hono from "hono/jsx"

export const {
  RepoContext,
  useRepo,
  useHandle,
  useDoc,
  usePresence,
} = createHooks(Hono)
```

### Task 3.2: Update Hono Index Exports

**File:** `packages/hono/src/index.ts`

```typescript
// Re-export schema-related types
export type { DocShape, Infer, Mutable } from "@loro-extended/change"
export { Shape } from "@loro-extended/change"

// Re-export handle types
export type { TypedDocHandle, DocId } from "@loro-extended/repo"

// Hooks
export { RepoContext, useRepo, useHandle, useDoc, usePresence } from "./hooks-core.js"

// Context provider
export * from "./repo-context.js"
```

---

## Phase 4: Example Updates

### Task 4.1: Update `examples/todo-sse`

**File:** `examples/todo-sse/src/client/todo-app.tsx`

```typescript
// BEFORE
const [doc, changeDoc, handle] = useDocument(docId, schema)
changeDoc(d => { d.todos.push(...) })

// AFTER
const handle = useHandle(docId, schema)
const doc = useDoc(handle)
handle.change(d => { d.todos.push(...) })
```

Full migration:

```typescript
import { Shape, useHandle, useDoc } from "@loro-extended/react"
import { type DocId, generateUUID } from "@loro-extended/repo"
import { TodoSchema } from "../shared/types"
// ... other imports

const schema = Shape.doc({
  todos: Shape.list(TodoSchema),
})

const DEFAULT_TODO_DOC_ID: DocId = "todos-example-document"

function TodoApp() {
  const docId = useDocIdFromHash(DEFAULT_TODO_DOC_ID)
  
  // NEW API
  const handle = useHandle(docId, schema)
  const doc = useDoc(handle)
  const connectionState = useConnectionState()

  const addTodo = (text: string) => {
    handle.change(d => {
      d.todos.push({
        id: generateUUID(),
        text,
        completed: false,
      })
    })
  }

  const toggleTodo = (id: string) => {
    handle.change(d => {
      const todo = d.todos.find(t => t.id === id)
      if (todo) {
        todo.completed = !todo.completed
      }
    })
  }

  const deleteTodo = (id: string) => {
    handle.change(d => {
      const index = d.todos.findIndex(t => t.id === id)
      if (index > -1) {
        d.todos.delete(index, 1)
      }
    })
  }

  // ... rest unchanged
}
```

### Task 4.2: Update `examples/chat`

**File:** `examples/chat/src/client/chat-app.tsx`

```typescript
// BEFORE
const [doc, changeDoc, handle] = useDocument(docId, ChatSchema)
const { peers, self, setSelf } = usePresence(docId, PresenceSchema)

// AFTER
const handle = useHandle(docId, ChatSchema, PresenceSchema)
const doc = useDoc(handle)
const { self, peers } = usePresence(handle)

// Changes
changeDoc(d => { ... })  →  handle.change(d => { ... })
setSelf({ ... })         →  handle.presence.set({ ... })
```

### Task 4.3: Update `examples/bumper-cars`

**File:** `examples/bumper-cars/src/client/bumper-cars-app.tsx`

```typescript
// BEFORE
const [doc, _changeDoc, handle] = useDocument(ARENA_DOC_ID, ArenaSchema)
const { all: allPresence, setSelf: setPresence } = usePresence(ARENA_DOC_ID, GamePresenceSchema)

// AFTER
const handle = useHandle(ARENA_DOC_ID, ArenaSchema, GamePresenceSchema)
const doc = useDoc(handle)
const { self, peers } = usePresence(handle)

// Changes
setPresence(presence)  →  handle.presence.set(presence)

// Note: Need to adapt allPresence logic to use self + peers
```

### Task 4.4: Update `examples/todo-websocket`

Same pattern as `todo-sse`.

### Task 4.5: Update `examples/video-conference`

Check for any hook usage and update accordingly.

### Task 4.6: Update `examples/hono-counter`

**File:** `examples/hono-counter/src/client.tsx`

Update to use new Hono hooks.

---

## Phase 5: Documentation Updates

### Task 5.1: Update `docs/presence.md`

Update the "Typed Presence" section:

```markdown
## Typed Presence

To use typed presence with the new API:

\`\`\`typescript
const handle = useHandle(docId, DocSchema, PresenceSchema)
const { self, peers } = usePresence(handle)

// Read presence
console.log(self.cursor)
console.log([...peers.values()].map(p => p.cursor))

// Update presence
handle.presence.set({ cursor: { x: 10, y: 20 } })
\`\`\`
```

### Task 5.2: Create Migration Guide

**File:** `docs/migration-v1.md`

Document the API changes for users upgrading.

---

## Phase 6: Cleanup

### Task 6.1: Remove Old Files

- [ ] Delete `packages/hooks-core/plan-typed-doc-handle.md`
- [ ] Delete `packages/hooks-core/api-analysis.md`
- [ ] Delete `packages/hooks-core/state-management-patterns.md`
- [ ] Delete `packages/hooks-core/selector-patterns.md`
- [ ] Delete `packages/hooks-core/handle-first-pattern.md`
- [ ] Keep `packages/hooks-core/RECOMMENDED-API.md` as documentation

### Task 6.2: Update CHANGELOG

Add entry for breaking changes.

---

## Implementation Order

1. **Phase 1** - Core implementation (hooks-core)
2. **Phase 2** - React package updates
3. **Phase 3** - Hono package updates
4. **Phase 4** - Example updates (one at a time, test each)
5. **Phase 5** - Documentation
6. **Phase 6** - Cleanup

## Testing Strategy

After each phase:

```bash
# Type check
pnpm --filter @loro-extended/hooks-core typecheck
pnpm --filter @loro-extended/react typecheck
pnpm --filter @loro-extended/hono typecheck

# Run tests
pnpm --filter @loro-extended/react test

# Build
pnpm build
```

After examples:

```bash
# Test each example
cd examples/todo-sse && pnpm dev
cd examples/chat && pnpm dev
cd examples/bumper-cars && pnpm dev
```

## Estimated Effort

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| Phase 1 | Core implementation | 1-2 hours |
| Phase 2 | React package | 1 hour |
| Phase 3 | Hono package | 30 min |
| Phase 4 | Examples (6 apps) | 2-3 hours |
| Phase 5 | Documentation | 1 hour |
| Phase 6 | Cleanup | 30 min |
| **Total** | | **6-8 hours** |