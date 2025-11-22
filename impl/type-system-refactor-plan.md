# Type System Refactor Plan

## Problem Statement

The `@loro-extended/change` package is experiencing "Type instantiation is excessively deep and possibly infinite" errors. This is caused by:

1.  **Recursive Types**: `ContainerShape` and `ValueShape` are mutually recursive.
2.  **Deep Inference**: `InferPlainType` and `BaseSchemaMapper` traverse these recursive structures deeply.
3.  **Complex Generics**: `DraftNodeParams` and `DraftNode` rely on these deep inferences, causing TypeScript to hit its recursion limit.

This forces developers to use `any` casts, compromising type safety and readability.

## Proposed Solution

### 1. Decouple Shape Definitions from Inference

Instead of having `BaseSchemaMapper` do all the heavy lifting in one go, we can break it down.

### 2. Introduce `SchemaType` Interface

Add a `SchemaType` interface to `ContainerShape` and `ValueShape` that pre-calculates the plain and draft types. This moves the complexity from _inference time_ to _definition time_.

```typescript
export interface Shape<Plain, Draft> {
  _type: string;
  _plain: Plain; // Phantom type for inference
  _draft: Draft; // Phantom type for inference
}
```

### 3. Simplify `InferPlainType` and `InferDraftType`

With the phantom types, inference becomes trivial:

```typescript
export type InferPlainType<T extends Shape<any, any>> = T["_plain"];
export type InferDraftType<T extends Shape<any, any>> = T["_draft"];
```

### 4. Refactor `Shape` Factory

Update the `Shape` factory functions to populate these phantom types.

**Example:**

```typescript
// shape.ts

export interface TextContainerShape extends Shape<string, TextDraftNode> {
  readonly _type: "text";
}

export const Shape = {
  text: (): TextContainerShape => ({
    _type: "text",
    _plain: "" as string, // Phantom
    _draft: {} as TextDraftNode, // Phantom
  }),
  // ...
};
```

### 5. Handle Recursive Structures (Lists, Maps, Records)

For recursive structures, we still need to compute the types, but we can do it step-by-step.

```typescript
export interface ListContainerShape<T extends Shape<any, any>>
  extends Shape<InferPlainType<T>[], ListDraftNode<T>> {
  readonly _type: "list";
  readonly shape: T;
}
```

### 6. Remove `BaseSchemaMapper`

The complex conditional type `BaseSchemaMapper` can be removed or significantly simplified, as the mapping logic is now distributed across the shape definitions.

## Implementation Steps

1.  **Define `Shape` Base Interface**: Create the base interface with phantom types.
2.  **Update Shape Interfaces**: Modify all `*Shape` interfaces to extend `Shape<Plain, Draft>`.
3.  **Update `Shape` Factory**: Update factory functions to return the correct types (the runtime objects don't need to change much, just the type definitions).
4.  **Update Inference Types**: Replace `InferPlainType` and `InferDraftType` with the simple property accessors.
5.  **Clean Up**: Remove `BaseSchemaMapper` and `any` casts.

## Benefits

- **Performance**: TypeScript doesn't need to re-compute types deeply every time.
- **Readability**: The mapping logic is co-located with the shape definition.
- **Stability**: Reduces "excessively deep" errors.
- **Extensibility**: Adding new types is easier (just define the shape and its plain/draft types).

## Migration Strategy

This is a breaking change for internal types but should be backward compatible for public API usage if `InferPlainType` behaves the same way.

We can implement this incrementally:

1.  Create a new `Shape2` or similar to test the concept.
2.  Migrate one shape at a time.
3.  Replace the old system.

## Immediate Action Items (for readability/maintainability without full refactor)

If a full refactor is too much right now, we can:

1.  **Use `interface` instead of `type`**: Interfaces in TypeScript handle recursion better than type aliases.
2.  **Explicit Return Types**: Ensure all functions have explicit return types to prevent TypeScript from trying to infer them deeply.
3.  **Simplify `DraftNodeParams`**: Maybe pass `emptyState` as `any` internally but type it in the public API.

However, the "Phantom Type" approach is the most robust long-term solution.
