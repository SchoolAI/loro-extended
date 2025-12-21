# Type-Safe Path Selector DSL for `TypedDocHandle.subscribe`

## Executive Summary

This plan introduces a type-safe path selector DSL that:
1. Provides full TypeScript type inference for subscription callbacks
2. Compiles to JSONPath strings for WASM-side filtering via `subscribeJsonpath`
3. Enables precise change detection through JS-side deep equality checks
4. Integrates with the existing `@loro-extended/change` Shape system

## Background & Motivation

### The Problem

The current `subscribeJsonpath` implementation has two limitations:

1. **No Type Safety**: Callbacks receive `unknown[]` instead of properly typed values
2. **False Positives**: The WASM NFA matcher is intentionally conservative—it may fire when the path did NOT actually change

From the Loro release notes:
> *"Conservative matching: May produce false positives (extra notifications) but never false negatives (missed changes)"*

### Why `subscribeJsonpath` Matters

The `subscribeJsonpath` API exists for **performance**. By keeping path matching inside the Rust/WASM runtime, we avoid the expensive JS↔WASM boundary crossing on every document change. This is critical for large documents with frequent updates.

### The Solution: Two-Stage Filtering

```
┌─────────────────────────────────────────────────────────────────┐
│                         WASM Runtime                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  subscribeJsonpath NFA matcher                          │   │
│  │  - Fast: O(1) per change to check if path MAY match     │   │
│  │  - Conservative: false positives, never false negatives │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Only fires when path MAY have changed
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         JS Runtime                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Deep equality check (Stage 2)                          │   │
│  │  - Filters out false positives                          │   │
│  │  - Only runs when Stage 1 fires (infrequent)            │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Design

### API Overview

```typescript
// Given this schema:
const docShape = Shape.doc({
  books: Shape.list(
    Shape.struct({
      title: Shape.text(),
      price: Shape.plain.number(),
      author: Shape.struct({
        name: Shape.plain.string(),
      }),
    }),
  ),
  config: Shape.struct({
    theme: Shape.plain.string(),
  }),
  users: Shape.record(
    Shape.struct({
      name: Shape.plain.string(),
      score: Shape.counter(),
    }),
  ),
})

// Type-safe path selector DSL:
handle.subscribe(
  p => p.books.$each.title,           // PathSelector<string[]>
  (titles, prev) => {                  // titles: string[], prev: string[] | undefined
    console.log("Titles changed:", titles)
  }
)

handle.subscribe(
  p => p.config.theme,                 // PathSelector<string>
  (theme, prev) => {                   // theme: string
    console.log("Theme:", theme)
  }
)

handle.subscribe(
  p => p.users.$each.score,            // PathSelector<number[]>
  (scores, prev) => {                  // scores: number[]
    console.log("Scores:", scores)
  }
)

// Raw JSONPath escape hatch (existing API, no type safety):
handle.subscribe(
  "$.books[?@.price>10].title",
  (values) => { ... }                  // values: unknown[]
)

// General-purpose JSONPath query method on handle:
const expensiveBooks = handle.jsonPath("$.books[?@.price>10]")  // unknown[]
```

### DSL Subset vs Full JSONPath

The DSL represents a **constrained subset** of JSONPath that:
- Maps directly to our Shape type system
- Can reliably detect actual changes
- Compiles to valid JSONPath for `subscribeJsonpath`

| DSL Construct | JSONPath Equivalent | Type Inference | Change Detection |
|---------------|---------------------|----------------|------------------|
| `.books` | `$.books` | ✅ From schema | ✅ Exact match |
| `.$each` | `[*]` | ✅ Array element type | ⚠️ Wildcard (needs deep eq) |
| `.$at(0)` | `[0]` | ✅ Array element type | ✅ Exact match |
| `.$at(-1)` | `[-1]` | ✅ Array element type | ✅ Exact match (last element) |
| `.$key("alice")` | `["alice"]` | ✅ Record value type | ✅ Exact match |
| `.title` | `.title` | ✅ From schema | ✅ Exact match |
| `.$first` | `[0]` | ✅ Array element type | ✅ Exact match (alias for `$at(0)`) |
| `.$last` | `[-1]` | ✅ Array element type | ✅ Exact match (alias for `$at(-1)`) |

**Not Supported** (use raw JSONPath escape hatch):
- Filter expressions: `[?@.price>10]`
- Recursive descent: `..`
- Slices: `[0:5]`

### Type System Integration

The DSL leverages the existing Shape system in `@loro-extended/change`:

```typescript
// packages/change/src/path-selector.ts

import type {
  DocShape,
  ContainerOrValueShape,
  ListContainerShape,
  MovableListContainerShape,
  StructContainerShape,
  RecordContainerShape,
  TextContainerShape,
  CounterContainerShape,
  ValueShape,
} from "./shape.js"
import type { Infer } from "./types.js"

// ============================================================================
// Path Segment Types
// ============================================================================

export type PathSegment =
  | { type: "property"; key: string }
  | { type: "each" }                    // Wildcard for arrays/records
  | { type: "index"; index: number }    // Specific array index
  | { type: "key"; key: string }        // Specific record key

// ============================================================================
// Path Selector (carries type and segments)
// ============================================================================

export interface PathSelector<T> {
  readonly __resultType: T              // Phantom type for inference
  readonly __segments: PathSegment[]    // Runtime path data
}

// ============================================================================
// Path Node Types (for each container type)
// ============================================================================

// Terminal node for primitive values
interface TerminalPathNode<T> extends PathSelector<T> {}

// List path node
interface ListPathNode<Item extends ContainerOrValueShape>
  extends PathSelector<Infer<Item>[]> {
  /** Select all items (wildcard) */
  readonly $each: PathNode<Item, true>
  /** Select item at specific index (supports negative indices: -1 = last, -2 = second-to-last, etc.) */
  $at(index: number): PathNode<Item, false>
  /** Select first item (alias for $at(0)) */
  readonly $first: PathNode<Item, false>
  /** Select last item (alias for $at(-1)) */
  readonly $last: PathNode<Item, false>
}

// Struct path node (fixed keys)
interface StructPathNode<Shapes extends Record<string, ContainerOrValueShape>>
  extends PathSelector<{ [K in keyof Shapes]: Infer<Shapes[K]> }> {
  readonly [K in keyof Shapes]: PathNode<Shapes[K], false>
}

// Record path node (dynamic keys)
interface RecordPathNode<Item extends ContainerOrValueShape>
  extends PathSelector<Record<string, Infer<Item>>> {
  /** Select all values (wildcard) */
  readonly $each: PathNode<Item, true>
  /** Select value at specific key */
  $key(key: string): PathNode<Item, false>
}

// Text path node (terminal)
interface TextPathNode extends PathSelector<string> {}

// Counter path node (terminal)
interface CounterPathNode extends PathSelector<number> {}

// ============================================================================
// PathNode Type Mapping
// ============================================================================

// InArray tracks whether we've passed through a wildcard ($each)
// This affects the result type: T vs T[]
type PathNode<S extends ContainerOrValueShape, InArray extends boolean> =
  S extends ListContainerShape<infer Item>
    ? WrapIfArray<ListPathNode<Item>, InArray>
    : S extends MovableListContainerShape<infer Item>
      ? WrapIfArray<ListPathNode<Item>, InArray>
      : S extends StructContainerShape<infer Shapes>
        ? WrapIfArray<StructPathNode<Shapes>, InArray>
        : S extends RecordContainerShape<infer Item>
          ? WrapIfArray<RecordPathNode<Item>, InArray>
          : S extends TextContainerShape
            ? WrapIfArray<TextPathNode, InArray>
            : S extends CounterContainerShape
              ? WrapIfArray<CounterPathNode, InArray>
              : S extends ValueShape
                ? WrapIfArray<TerminalPathNode<Infer<S>>, InArray>
                : never

// Helper: wrap result type in array if we've passed through $each
type WrapIfArray<Node extends PathSelector<any>, InArray extends boolean> =
  InArray extends true
    ? PathSelector<Node["__resultType"][]> & Omit<Node, "__resultType">
    : Node

// ============================================================================
// Path Builder (entry point)
// ============================================================================

export type PathBuilder<D extends DocShape> = {
  readonly [K in keyof D["shapes"]]: PathNode<D["shapes"][K], false>
}
```

### Implementation Architecture

```
packages/
├── change/src/
│   ├── path-selector.ts          # Type definitions (above)
│   ├── path-builder.ts           # Runtime path builder factory
│   ├── path-compiler.ts          # Compile segments → JSONPath string
│   ├── path-evaluator.ts         # Evaluate path against TypedDoc
│   └── index.ts                  # Export new APIs
│
└── repo/src/
    ├── typed-doc-handle.ts       # Updated subscribe() overloads
    └── typed-doc-handle-subscribe.test.ts  # Tests
```

### Runtime Implementation

#### Path Builder Factory

```typescript
// packages/change/src/path-builder.ts

import type { DocShape, ContainerOrValueShape } from "./shape.js"
import type { PathBuilder, PathSegment, PathSelector } from "./path-selector.js"
import { isContainerShape } from "./utils/type-guards.js"

function createPathSelector<T>(segments: PathSegment[]): PathSelector<T> {
  return {
    __resultType: undefined as unknown as T,
    __segments: segments,
  }
}

function createPathNode(
  shape: ContainerOrValueShape,
  segments: PathSegment[],
): any {
  const selector = createPathSelector(segments)

  // Terminal shapes (text, counter, value)
  if (shape._type === "text" || shape._type === "counter") {
    return selector
  }
  if (shape._type === "value") {
    return selector
  }

  // List/MovableList
  if (shape._type === "list" || shape._type === "movableList") {
    return Object.assign(selector, {
      get $each() {
        return createPathNode(shape.shape, [...segments, { type: "each" }])
      },
      $at(index: number) {
        return createPathNode(shape.shape, [...segments, { type: "index", index }])
      },
      get $first() {
        return createPathNode(shape.shape, [...segments, { type: "index", index: 0 }])
      },
      get $last() {
        return createPathNode(shape.shape, [...segments, { type: "index", index: -1 }])
      },
    })
  }

  // Struct (fixed keys)
  if (shape._type === "struct") {
    const props: Record<string, any> = {}
    for (const key in shape.shapes) {
      Object.defineProperty(props, key, {
        get() {
          return createPathNode(shape.shapes[key], [...segments, { type: "property", key }])
        },
        enumerable: true,
      })
    }
    return Object.assign(selector, props)
  }

  // Record (dynamic keys)
  if (shape._type === "record") {
    return Object.assign(selector, {
      get $each() {
        return createPathNode(shape.shape, [...segments, { type: "each" }])
      },
      $key(key: string) {
        return createPathNode(shape.shape, [...segments, { type: "key", key }])
      },
    })
  }

  return selector
}

export function createPathBuilder<D extends DocShape>(docShape: D): PathBuilder<D> {
  const builder: Record<string, any> = {}
  
  for (const key in docShape.shapes) {
    Object.defineProperty(builder, key, {
      get() {
        return createPathNode(docShape.shapes[key], [{ type: "property", key }])
      },
      enumerable: true,
    })
  }
  
  return builder as PathBuilder<D>
}
```

#### JSONPath Compiler

```typescript
// packages/change/src/path-compiler.ts

import type { PathSegment } from "./path-selector.js"

export function compileToJsonPath(segments: PathSegment[]): string {
  let path = "$"
  
  for (const segment of segments) {
    switch (segment.type) {
      case "property":
        // Use bracket notation for safety (handles special chars)
        path += `["${segment.key}"]`
        break
      case "each":
        path += "[*]"
        break
      case "index":
        path += `[${segment.index}]`
        break
      case "key":
        path += `["${segment.key}"]`
        break
    }
  }
  
  return path
}

/**
 * Check if the path contains any wildcard segments.
 * Paths with wildcards need deep equality checking for change detection.
 */
export function hasWildcard(segments: PathSegment[]): boolean {
  return segments.some(s => s.type === "each")
}
```

#### Path Evaluator

```typescript
// packages/change/src/path-evaluator.ts

import type { PathSegment, PathSelector } from "./path-selector.js"
import type { TypedDoc } from "./typed-doc.js"
import type { DocShape } from "./shape.js"

/**
 * Evaluate a path selector against a TypedDoc to get the current value.
 * Returns the value(s) at the path, properly typed.
 */
export function evaluatePath<D extends DocShape, T>(
  doc: TypedDoc<D>,
  selector: PathSelector<T>,
): T {
  const json = doc.$.toJSON()
  return evaluatePathOnValue(json, selector.__segments) as T
}

function evaluatePathOnValue(value: any, segments: PathSegment[]): any {
  if (segments.length === 0) {
    return value
  }

  const [segment, ...rest] = segments

  switch (segment.type) {
    case "property":
    case "key":
      if (value == null) return undefined
      return evaluatePathOnValue(value[segment.key], rest)

    case "index":
      if (!Array.isArray(value)) return undefined
      // Handle negative indices: -1 = last, -2 = second-to-last, etc.
      const index = segment.index < 0 ? value.length + segment.index : segment.index
      if (index < 0 || index >= value.length) return undefined
      return evaluatePathOnValue(value[index], rest)

    case "each":
      if (Array.isArray(value)) {
        return value.map(item => evaluatePathOnValue(item, rest))
      }
      if (typeof value === "object" && value !== null) {
        return Object.values(value).map(item => evaluatePathOnValue(item, rest))
      }
      return []
  }
}
```

### Updated TypedDocHandle

```typescript
// packages/repo/src/typed-doc-handle.ts (updated subscribe method)

import { createPathBuilder, compileToJsonPath, evaluatePath, hasWildcard } from "@loro-extended/change"
import type { PathBuilder, PathSelector } from "@loro-extended/change"
import { equal } from "./utils/equal.js"

export class TypedDocHandle<D extends DocShape, P extends ValueShape = ValueShape> {
  // ... existing code ...

  /**
   * Subscribe to all changes on the document.
   */
  subscribe(listener: Listener): () => void

  /**
   * Subscribe to changes at a specific path using the type-safe DSL.
   * 
   * The callback receives:
   * - `value`: The current value at the path (properly typed)
   * - `prev`: The previous value (undefined on first call)
   * 
   * @example
   * ```typescript
   * handle.subscribe(
   *   p => p.books.$each.title,
   *   (titles, prev) => {
   *     console.log("Titles changed from", prev, "to", titles)
   *   }
   * )
   * ```
   */
  subscribe<T>(
    selector: (path: PathBuilder<D>) => PathSelector<T>,
    listener: (value: T, prev: T | undefined) => void,
  ): () => void

  /**
   * Subscribe to changes that may affect a JSONPath query (escape hatch).
   *
   * Use this for complex queries not expressible in the DSL (filters, etc.).
   * Note: No type safety - callback receives unknown[].
   *
   * For ad-hoc JSONPath queries, use handle.jsonPath() instead.
   */
  subscribe(
    jsonpath: string,
    listener: (value: unknown[]) => void,
  ): () => void

  /**
   * Execute a JSONPath query against the document.
   *
   * This is a general-purpose method for querying the document with full
   * JSONPath expressiveness. Use this for ad-hoc queries or within callbacks.
   *
   * @example
   * ```typescript
   * const expensiveBooks = handle.jsonPath("$.books[?@.price>10]")
   * const allTitles = handle.jsonPath("$..title")
   * ```
   */
  jsonPath(path: string): unknown[] {
    return this._doc.$.loroDoc.JSONPath(path)
  }

  // Implementation
  subscribe(
    listenerOrSelectorOrJsonpath: Listener | ((path: PathBuilder<D>) => PathSelector<any>) | string,
    pathListener?: ((value: any, prev: any) => void) | ((value: unknown[]) => void),
  ): () => void {
    // Case 1: Regular subscription (all changes)
    if (typeof listenerOrSelectorOrJsonpath === "function" && !pathListener) {
      return this._doc.$.loroDoc.subscribe(listenerOrSelectorOrJsonpath as Listener)
    }

    // Case 2: Raw JSONPath string (escape hatch)
    if (typeof listenerOrSelectorOrJsonpath === "string") {
      const jsonpath = listenerOrSelectorOrJsonpath
      const loroDoc = this._doc.$.loroDoc

      if (!pathListener) {
        throw new Error("JSONPath subscription requires a listener callback")
      }

      const wrappedCallback = () => {
        const value = loroDoc.JSONPath(jsonpath)
        ;(pathListener as (value: unknown[]) => void)(value)
      }

      return loroDoc.subscribeJsonpath(jsonpath, wrappedCallback)
    }

    // Case 3: Type-safe path selector DSL
    const selectorFn = listenerOrSelectorOrJsonpath as (path: PathBuilder<D>) => PathSelector<any>
    const listener = pathListener as (value: any, prev: any) => void

    if (!listener) {
      throw new Error("Path selector subscription requires a listener callback")
    }

    const pathBuilder = createPathBuilder(this._doc.$.docShape)
    const selector = selectorFn(pathBuilder)
    const jsonpath = compileToJsonPath(selector.__segments)
    const needsDeepEqual = hasWildcard(selector.__segments)

    let previousValue: any = undefined
    let isFirstCall = true

    const wrappedCallback = () => {
      const newValue = evaluatePath(this._doc, selector)

      // For paths with wildcards, we need deep equality to filter false positives
      // For exact paths, subscribeJsonpath is already precise
      if (!isFirstCall && needsDeepEqual && equal(newValue, previousValue)) {
        return // False positive, skip callback
      }

      const prev = previousValue
      previousValue = newValue
      isFirstCall = false
      listener(newValue, prev)
    }

    return this._doc.$.loroDoc.subscribeJsonpath(jsonpath, wrappedCallback)
  }
}
```

## Implementation Plan

### Phase 1: Core Type System
- [x] Create `packages/change/src/path-selector.ts` with type definitions
- [x] Create `packages/change/src/path-builder.ts` with runtime factory
- [x] Create `packages/change/src/path-compiler.ts` for JSONPath compilation
- [x] Create `packages/change/src/path-evaluator.ts` for value extraction
- [x] Export new APIs from `packages/change/src/index.ts`

### Phase 2: Integration
- [x] Update `TypedDocHandle.subscribe()` with new overloads
- [x] Add `TypedDocHandle.jsonPath()` method for ad-hoc queries
- [x] Simplify raw JSONPath callback (remove `getPath` parameter)
- [x] Ensure deep equality check uses existing `equal.ts` utility
- [x] Handle edge cases (empty paths, undefined values, etc.)

### Phase 3: Testing
- [x] Unit tests for path builder type inference
- [x] Unit tests for JSONPath compilation
- [x] Unit tests for path evaluation
- [x] Integration tests for subscribe with DSL
- [x] Tests for false positive filtering
- [x] Tests for previous value tracking

### Phase 4: Documentation
- [x] Update JSDoc comments
- [ ] Add examples to README
- [ ] Document trade-offs and limitations

## Trade-offs & Considerations

### What We Gain

1. **Full Type Safety**: Callbacks receive properly typed values inferred from the schema
2. **IDE Autocomplete**: Path builder provides full autocomplete for schema properties
3. **Precise Change Detection**: Deep equality filtering eliminates false positives
4. **Previous Value Tracking**: Built-in support for comparing old vs new values
5. **WASM Performance**: Still uses `subscribeJsonpath` for efficient filtering

### What We Trade Away

1. **Full JSONPath Expressiveness**: No filters, recursive descent, or slices in DSL (negative indices ARE supported)
2. **Slight Overhead**: Deep equality check runs when WASM fires (but only then)
3. **Additional Code**: New modules in `@loro-extended/change`

### Escape Hatch

The raw JSONPath string overload remains available for power users who need:
- Filter expressions: `$.books[?@.price>10]`
- Recursive descent: `$..title`
- Complex queries not expressible in the DSL

These users accept the trade-off of no type safety for full JSONPath power.

### When False Positives Occur

The WASM NFA fires (potentially false positive) when:
- Path contains `$each` (wildcard) and any sibling in that container changes
- Example: `p.books.$each.title` fires when any book property changes

The JS-side deep equality check then filters:
- Book added but titles unchanged → filtered out
- Book's `price` changed → filtered out
- Book's `title` changed → passed through

### Performance Characteristics

| Scenario | WASM Fires? | JS Deep Equal? | Callback Invoked? |
|----------|-------------|----------------|-------------------|
| Unrelated path changed | ❌ No | ❌ No | ❌ No |
| Sibling property changed (wildcard path) | ✅ Yes | ✅ Yes | ❌ No (filtered) |
| Actual value changed | ✅ Yes | ✅ Yes | ✅ Yes |
| Exact path (no wildcard) | ✅ Yes | ❌ No | ✅ Yes |

## Open Questions

1. ~~**Should we support `$first` / `$last` for arrays?** These could compile to `[0]` and `[-1]` but negative indices may not be supported by `subscribeJsonpath`.~~
   
   **✅ RESOLVED (2024-12-21):** Testing confirmed that **negative indices ARE fully supported** by both `JSONPath` queries and `subscribeJsonpath`. We can safely implement `$first` (compiles to `[0]`) and `$last` (compiles to `[-1]`). The DSL table above has been updated to reflect this.
   
   **Test Results:**
   - `$.books[-1]` correctly returns the last element
   - `$.books[-2]` correctly returns the second-to-last element
   - `subscribeJsonpath("$.books[-1].title", ...)` fires correctly when the last element changes
   - Out-of-bounds negative indices (e.g., `[-5]` on a 3-element array) gracefully return empty arrays

2. **Should the DSL support optional chaining?** e.g., `p.user?.profile?.name` for nullable paths.

3. **Should we provide a `subscribeOnce` variant?** Auto-unsubscribes after first change.

4. **Should we batch multiple path subscriptions?** If a user subscribes to multiple paths, we could potentially optimize by subscribing to a common ancestor.


## Suggestions & Recommendations

Immediate Initial Evaluation: When subscribe is called, we must synchronously evaluate the path to establish the previousValue baseline. If we don't, we can't accurately detect if the first signaled event is a genuine change.

Defensive Runtime Evaluation: The PathEvaluator must be robust. If a path segment is missing (e.g., accessing .title on undefined), it should return undefined (or an empty array for wildcards) rather than throwing. This aligns with standard JSONPath behavior and CRDT realities.

Testing "False Positives": We need a specific test case that proves the "Two-Stage" filtering works.

Scenario: Subscribe to $.list[*].id.
Action: Modify $.list[0].description.
Result: WASM fires (path matches wildcard), but our wrapper should not fire the user callback because ids didn't change.
