import {
  type Container,
  LoroCounter,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  type Value,
} from "loro-crdt"
import type {
  ArrayValueShape,
  ContainerOrValueShape,
  ListContainerShape,
  MapContainerShape,
  MovableListContainerShape,
  ObjectValueShape,
} from "./shape.js"
import {
  isContainer,
  isContainerShape,
  isObjectValue,
  isValueShape,
} from "./utils/type-guards.js"

/**
 * Converts string input to LoroText container
 */
function convertTextInput(value: string): LoroText {
  const text = new LoroText()
  text.insert(0, value)
  return text
}

/**
 * Converts number input to LoroCounter container
 */
function convertCounterInput(value: number): LoroCounter {
  const counter = new LoroCounter()
  counter.increment(value)
  return counter
}

/**
 * Converts array input to LoroList container
 */
function convertListInput(
  value: Value[],
  shape: ListContainerShape | ArrayValueShape,
  // parentPath: string[],
): LoroList | Value[] {
  if (!isContainerShape(shape)) {
    return value
  }

  const list = new LoroList()

  for (const item of value) {
    const convertedItem = convertInputToNode(item, shape.shape)
    if (isContainer(convertedItem)) {
      list.pushContainer(convertedItem)
    } else {
      list.push(convertedItem)
    }
  }

  return list
}

/**
 * Converts array input to LoroMovableList container
 */
function convertMovableListInput(
  value: Value[],
  shape: MovableListContainerShape | ArrayValueShape,
  // parentPath: string[],
): LoroMovableList | Value[] {
  if (!isContainerShape(shape)) {
    return value
  }

  const list = new LoroMovableList()

  for (const item of value) {
    const convertedItem = convertInputToNode(item, shape.shape)
    if (isContainer(convertedItem)) {
      list.pushContainer(convertedItem)
    } else {
      list.push(convertedItem)
    }
  }

  return list
}

/**
 * Converts object input to LoroMap container
 */
function convertMapInput(
  value: { [key: string]: Value },
  shape: MapContainerShape | ObjectValueShape,
): LoroMap | { [key: string]: Value } {
  if (!isContainerShape(shape)) {
    return value
  }

  const map = new LoroMap()
  for (const [k, v] of Object.entries(value)) {
    const nestedSchema = shape.shapes[k]
    if (nestedSchema) {
      const convertedValue = convertInputToNode(v, nestedSchema)
      if (isContainer(convertedValue)) {
        map.setContainer(k, convertedValue)
      } else {
        map.set(k, convertedValue)
      }
    } else {
      map.set(k, value)
    }
  }

  return map
}

/**
 * Main conversion function that transforms input values to appropriate CRDT containers
 * based on schema definitions
 */
export function convertInputToNode<Shape extends ContainerOrValueShape>(
  value: Value,
  shape: Shape,
): Container | Value {
  switch (shape._type) {
    case "text": {
      if (typeof value !== "string") {
        throw new Error("string expected")
      }

      return convertTextInput(value)
    }
    case "counter": {
      if (typeof value !== "number") {
        throw new Error("number expected")
      }

      return convertCounterInput(value)
    }
    case "list": {
      if (!Array.isArray(value)) {
        throw new Error("array expected")
      }

      return convertListInput(value, shape)
    }
    case "movableList": {
      if (!Array.isArray(value)) {
        throw new Error("array expected")
      }

      return convertMovableListInput(value, shape)
    }
    case "map": {
      if (!isObjectValue(value)) {
        throw new Error("object expected")
      }

      return convertMapInput(value, shape)
    }
    case "value": {
      if (!isValueShape(shape)) {
        throw new Error("value expected")
      }

      return value
    }

    case "tree":
      throw new Error("tree type unimplemented")

    default:
      throw new Error(`unexpected type: ${(shape as Shape)._type}`)
  }
}
