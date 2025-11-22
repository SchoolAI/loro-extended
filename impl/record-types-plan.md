# Implementation Plan: Record Types

The goal is to introduce `Shape.record` (collaborative map with uniform values) and `Shape.plain.record` (plain object with uniform values) to the `@loro-extended/change` package.

## 1. Define Shapes in `packages/change/src/shape.ts`

We need to add two new shape interfaces and update the `Shape` factory.

### `RecordContainerShape`

Represents a `LoroMap` where all values share the same shape.

```typescript
export interface RecordContainerShape<
  NestedShape extends ContainerOrValueShape = ContainerOrValueShape
> extends Shape<
    Record<string, NestedShape["_plain"]>,
    RecordDraftNode<NestedShape>
  > {
  readonly _type: "record";
  readonly shape: NestedShape;
}
```

### `RecordValueShape`

Represents a plain JavaScript object where all values share the same shape.

```typescript
export interface RecordValueShape<T extends ValueShape = ValueShape>
  extends Shape<Record<string, T["_plain"]>, Record<string, T["_draft"]>> {
  readonly _type: "value";
  readonly valueType: "record";
  readonly shape: T;
}
```

### Update `Shape` Factory

Add `record` to `Shape` and `Shape.plain`.

```typescript
export const Shape = {
  // ... existing ...
  record: <T extends ContainerOrValueShape>(
    shape: T
  ): RecordContainerShape<T> => ({
    _type: "record" as const,
    shape,
    _plain: {} as any,
    _draft: {} as any,
  }),

  plain: {
    // ... existing ...
    record: <T extends ValueShape>(shape: T): RecordValueShape<T> => ({
      _type: "value" as const,
      valueType: "record" as const,
      shape,
      _plain: {} as any,
      _draft: {} as any,
    }),
  },
};
```

### Update `ContainerShape` and `ValueShape` unions

Add `RecordContainerShape` to `ContainerShape`.
Add `RecordValueShape` to `ValueShape`.

## 2. Create `RecordDraftNode` in `packages/change/src/draft-nodes/record.ts`

This will be the draft node implementation for `Shape.record`. It wraps `LoroMap`.

```typescript
export class RecordDraftNode<
  NestedShape extends ContainerOrValueShape
> extends DraftNode<RecordContainerShape<NestedShape>> {
  // Cache for draft nodes
  private nodeCache = new Map<string, DraftNode<ContainerShape> | Value>();

  // ... implementation of get, set, delete, etc.
  // Similar to MapDraftNode but using this.shape.shape for all keys
}
```

## 3. Update `packages/change/src/draft-nodes/utils.ts`

Update `createContainerDraftNode` to handle `record` type.

```typescript
    case "record":
      return new RecordDraftNode(params as DraftNodeParams<RecordContainerShape>)
```

## 4. Update `packages/change/src/conversion.ts`

Add `convertRecordInput` and update `convertInputToNode`.

```typescript
function convertRecordInput(
  value: { [key: string]: Value },
  shape: RecordContainerShape | RecordValueShape
): LoroMap | { [key: string]: Value } {
  // ... similar to convertMapInput but using shape.shape for all values
}
```

## 5. Update `packages/change/src/utils/type-guards.ts`

Add `isRecordShape` and update `isValueShape`.

```typescript
export function isRecordShape(
  schema: ContainerOrValueShape
): schema is RecordContainerShape {
  return schema && typeof schema === "object" && schema._type === "record";
}
```

Update `isValueShape` to include "record".

## 6. Update `packages/change/src/types.ts`

Export `RecordContainerShape` and `RecordValueShape`.

## 7. Tests

Create `packages/change/src/record.test.ts` to verify:

- `Shape.record` with container values (e.g. `Shape.record(Shape.text())`)
- `Shape.record` with plain values (e.g. `Shape.record(Shape.plain.string())`)
- `Shape.plain.record`
- Nested records
- Type inference
