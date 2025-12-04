import type {
  Container,
  LoroCounter,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
  LoroTreeNode,
  Value,
} from "loro-crdt"
import type {
  ContainerOrValueShape,
  ContainerShape,
  CounterContainerShape,
  ListContainerShape,
  MapContainerShape,
  MovableListContainerShape,
  RecordContainerShape,
  TextContainerShape,
  TreeContainerShape,
  ValueShape,
} from "../shape.js"

export { isContainer, isContainerId } from "loro-crdt"

/**
 * Type guard to check if a container is a LoroCounter
 */
export function isLoroCounter(container: Container): container is LoroCounter {
  return container.kind() === "Counter"
}

/**
 * Type guard to check if a container is a LoroList
 */
export function isLoroList(container: Container): container is LoroList {
  return container.kind() === "List"
}

/**
 * Type guard to check if a container is a LoroMap
 */
export function isLoroMap(container: Container): container is LoroMap {
  return container.kind() === "Map"
}

/**
 * Type guard to check if a container is a LoroMovableList
 */
export function isLoroMovableList(
  container: Container,
): container is LoroMovableList {
  return container.kind() === "MovableList"
}

/**
 * Type guard to check if a container is a LoroText
 */
export function isLoroText(container: Container): container is LoroText {
  return container.kind() === "Text"
}

/**
 * Type guard to check if a container is a LoroTree
 */
export function isLoroTree(container: Container): container is LoroTree {
  return container.kind() === "Tree"
}

/**
 * Type guard to check if an object is a LoroTreeNode
 * Note: LoroTreeNode is not a Container, so we check for its specific properties
 */
export function isLoroTreeNode(obj: any): obj is LoroTreeNode {
  return (
    obj &&
    typeof obj === "object" &&
    typeof obj.id === "string" &&
    typeof obj.data === "object" &&
    typeof obj.parent === "function" &&
    typeof obj.children === "function" &&
    typeof obj.createNode === "function"
  )
}

/**
 * Type guard to ensure cached container matches expected type using kind() method
 */
export function assertContainerType<T extends Container>(
  cached: Container,
  expected: T,
  context: string = "container operation",
): asserts cached is T {
  if (cached.kind() !== expected.kind()) {
    throw new Error(
      `Type safety violation in ${context}: ` +
        `cached container kind '${cached.kind()}' does not match ` +
        `expected kind '${expected.kind()}'`,
    )
  }

  // Additional safety check: ensure IDs match
  if (cached.id !== expected.id) {
    throw new Error(
      `Container ID mismatch in ${context}: ` +
        `cached ID '${cached.id}' does not match expected ID '${expected.id}'`,
    )
  }
}

/**
 * Type guard to check if a schema is for TextDraftNode
 */
export function isTextShape(
  schema: ContainerOrValueShape,
): schema is TextContainerShape {
  return schema && typeof schema === "object" && schema._type === "text"
}

/**
 * Type guard to check if a schema is for CounterDraftNode
 */
export function isCounterShape(
  schema: ContainerOrValueShape,
): schema is CounterContainerShape {
  return schema && typeof schema === "object" && schema._type === "counter"
}

/**
 * Type guard to check if a schema is for ListDraftNode
 */
export function isListShape(
  schema: ContainerOrValueShape,
): schema is ListContainerShape {
  return schema && typeof schema === "object" && schema._type === "list"
}

/**
 * Type guard to check if a schema is for MovableListDraftNode
 */
export function isMovableListShape(
  schema: ContainerOrValueShape,
): schema is MovableListContainerShape {
  return schema && typeof schema === "object" && schema._type === "movableList"
}

/**
 * Type guard to check if a schema is for MapDraftNode
 */
export function isMapShape(
  schema: ContainerOrValueShape,
): schema is MapContainerShape {
  return schema && typeof schema === "object" && schema._type === "map"
}

/**
 * Type guard to check if a schema is for RecordDraftNode
 */
export function isRecordShape(
  schema: ContainerOrValueShape,
): schema is RecordContainerShape {
  return schema && typeof schema === "object" && schema._type === "record"
}

/**
 * Type guard to check if a schema is for TreeDraftNode
 */
export function isTreeShape(
  schema: ContainerOrValueShape,
): schema is TreeContainerShape {
  return schema && typeof schema === "object" && schema._type === "tree"
}

export function isContainerShape(
  schema: ContainerOrValueShape,
): schema is ContainerShape {
  return schema._type && schema._type !== "value"
}

/**
 * Type guard to check if a schema is any of the Value shapes
 */
export function isValueShape(
  schema: ContainerOrValueShape,
): schema is ValueShape {
  return (
    schema._type === "value" &&
    [
      "string",
      "number",
      "boolean",
      "null",
      "undefined",
      "uint8array",
      "object",
      "record",
      "array",
      "union",
      "discriminatedUnion",
    ].includes(schema.valueType)
  )
}

export function isObjectValue(value: Value): value is { [key: string]: Value } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
  )
}
