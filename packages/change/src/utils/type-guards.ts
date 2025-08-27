import type {
  Container,
  LoroCounter,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  LoroTree,
  LoroTreeNode,
} from "loro-crdt"

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
  return obj && typeof obj === "object" &&
         typeof obj.id === "string" &&
         typeof obj.data === "object" &&
         typeof obj.parent === "function" &&
         typeof obj.children === "function" &&
         typeof obj.createNode === "function"
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
