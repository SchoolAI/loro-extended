# Post-Mortem: Second Attempt at Refactoring `@loro-extended/change` to Hide the Root Map

## Executive Summary

This document chronicles our second attempt to improve the developer experience of the `@loro-extended/change` library by hiding the internal "root" LoroMap container. While we made significant progress and discovered new approaches, we encountered fundamental architectural constraints that reveal deeper insights about the relationship between wrapper libraries and their underlying CRDT implementations.

## Original Goal

Remove the requirement for users to access a "root" property when working with Loro documents, transforming the API from:
```typescript
const doc = from({ name: "Alice" });
console.log(doc.toJSON().root); // { name: "Alice" }
```

To:
```typescript
const doc = from({ name: "Alice" });
console.log(doc.toJSON()); // { name: "Alice" }
```

## Approach Taken: Wrapper Class with Custom toJSON

### Implementation Strategy

We created an `ExtendedLoroDoc` class that extends the base `LoroDoc`:

```typescript
export class ExtendedLoroDoc extends LoroDoc {
  toJSON(): Record<string, unknown> {
    const json = super.toJSON()
    return (json.root as Record<string, unknown>) || {}
  }
}
```

This approach successfully:
- ✅ Made `doc.toJSON()` return the data directly without the `.root` wrapper
- ✅ Maintained full compatibility with existing Loro functionality
- ✅ Required minimal code changes
- ✅ All tests passed after updating expectations

### Limitations Discovered

However, this solution only partially achieved our goals:

1. **Incomplete Abstraction**: The root map is still exposed when accessing Loro containers directly:
   ```typescript
   const doc = from({ title: "hello" });
   const map = doc.getMap("root"); // Still need to know about "root"!
   ```

2. **Leaky Implementation Details**: Tests and user code that interact with the underlying Loro containers still need to be aware of the root map's existence.

## Alternative Approaches Explored

### 1. Comprehensive Proxy Wrapper

We considered creating a JavaScript Proxy that would intercept all method calls and property access:

```typescript
function createProxyDoc(doc: LoroDoc): LoroProxyDoc {
  return new Proxy(doc, {
    get(target, prop) {
      if (prop === 'toJSON') {
        return () => target.toJSON().root || {};
      }
      if (prop === 'getMap') {
        return (key: string) => {
          if (/* user is asking for a top-level property */) {
            return target.getMap('root').get(key);
          }
          return target.getMap(key);
        };
      }
      // ... handle other methods
    }
  });
}
```

**Challenges:**
- Complex to implement correctly for all LoroDoc methods
- Difficult to maintain type safety
- Performance overhead from proxy interception
- Risk of breaking edge cases in Loro's API

### 2. Direct Document-Level Containers (Original Vision)

The initial refactoring goal was to eliminate the root map entirely and use document-level containers:

```typescript
// Desired: Multiple root containers
doc.getMap("users");    // A root-level container
doc.getList("tasks");   // Another root-level container
```

**Why This Failed:**
- Loro doesn't support "grafting" pre-populated detached containers
- The `toLoroValue()` function creates detached container trees that can't be directly attached to the document
- Would require fundamental changes to Loro's architecture

## Key Insights

### 1. The Impedance Mismatch

There's a fundamental mismatch between:
- **What users want**: A simple object-like interface where the document IS the data
- **What Loro provides**: A document that CONTAINS named containers

This isn't just an API design choice—it reflects the underlying CRDT architecture where containers must be explicitly created and named at the document root.

### 2. The Proxy Paradox

Creating a perfect proxy wrapper faces an inherent contradiction:
- To be useful, it must expose Loro's methods (getMap, getList, etc.)
- But these methods inherently reveal the container-based architecture
- Hiding the root map in some contexts but not others creates inconsistency

### 3. Type System Limitations

TypeScript's type system makes it challenging to:
- Create a type that is simultaneously a LoroDoc AND has dynamic properties
- Maintain type safety while hiding implementation details
- Provide good IDE autocomplete for dynamically determined properties

## Recommendations

### Short Term: Document the Current Architecture

Rather than hiding the root map, we should:
1. Clearly document WHY the root map exists
2. Provide examples that show its benefits (single attachment point, transactional updates)
3. Consider renaming it from "root" to something more semantic like "data" or "state"

### Medium Term: Convenience Methods

Add helper methods that reduce boilerplate without hiding the architecture:

```typescript
// Helper to access nested data
doc.getData() // Returns the root map's contents as JSON
doc.getContainer(path: string) // Navigate to nested containers easily
```

### Long Term: Collaborate with Loro Core

Work with the Loro team to explore:
1. Native support for transparent root containers
2. A `doc.attachContainer(name, container)` API for grafting
3. Built-in proxy support at the library level

## Conclusion

This exploration revealed that what initially seemed like a simple API improvement actually requires fundamental architectural changes. The "root" map isn't just an implementation detail—it's a necessary abstraction that bridges the gap between JavaScript's object model and Loro's CRDT container model.

The best path forward is to:
1. **Accept the root map** as a necessary part of the architecture
2. **Improve the developer experience** through better documentation and helper methods
3. **Collaborate with upstream** for long-term architectural improvements

The principle of least surprise is sometimes better served by being explicit about necessary complexity rather than attempting to hide it incompletely.

## Lessons Learned

1. **Surface-level API changes often reveal deeper architectural constraints**
2. **Wrapper libraries are limited by their underlying dependencies' design decisions**
3. **Type safety and runtime behavior must be considered together**
4. **Sometimes the best solution is to embrace and document complexity rather than hide it**

## Technical Artifacts

The following changes were successfully implemented and tested:
- `ExtendedLoroDoc` class with custom `toJSON()` method
- Updated test suite using the cleaner API
- Type definitions maintaining backward compatibility

These changes provide value even if they don't fully achieve the original vision, demonstrating that incremental improvements are worthwhile even when perfect solutions aren't achievable.