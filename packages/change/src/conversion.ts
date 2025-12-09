import {
  type Container,
  LoroCounter,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
  type Value,
} from "loro-crdt"
import { getStorageKey } from "./migration.js"
import type {
  ArrayValueShape,
  ContainerOrValueShape,
  ContainerShape,
  ListContainerShape,
  MapContainerShape,
  MovableListContainerShape,
  ObjectValueShape,
  RecordContainerShape,
  RecordValueShape,
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
    const convertedItem = convertInputToRef(item, shape.shape)
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
    const convertedItem = convertInputToRef(item, shape.shape)
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
      // Use storage key for CRDT access - this respects .key() configuration
      const storageKey = getStorageKey(nestedSchema, k)
      const convertedValue = convertInputToRef(v, nestedSchema)
      if (isContainer(convertedValue)) {
        map.setContainer(storageKey, convertedValue)
      } else {
        map.set(storageKey, convertedValue)
      }
    } else {
      map.set(k, value)
    }
  }

  return map
}

/**
 * Converts object input to LoroMap container (Record)
 */
function convertRecordInput(
  value: { [key: string]: Value },
  shape: RecordContainerShape | RecordValueShape,
): LoroMap | { [key: string]: Value } {
  if (!isContainerShape(shape)) {
    return value
  }

  const map = new LoroMap()
  for (const [k, v] of Object.entries(value)) {
    const convertedValue = convertInputToRef(v, shape.shape)
    if (isContainer(convertedValue)) {
      map.setContainer(k, convertedValue)
    } else {
      map.set(k, convertedValue)
    }
  }

  return map
}

/**
 * Main conversion function that transforms input values to appropriate CRDT containers
 * based on schema definitions
 */
export function convertInputToRef<Shape extends ContainerOrValueShape>(
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
    case "record": {
      if (!isObjectValue(value)) {
        throw new Error("object expected")
      }

      return convertRecordInput(value, shape)
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

/**
 * Populates an existing container with data from a plain value.
 * This is useful for initializing root containers in LoroDoc or migrating data into existing containers.
 */
export function populateContainer(
  container: Container,
  value: any,
  shape: ContainerShape,
): void {
  if (shape._type === "list" || shape._type === "movableList") {
    const list = container as LoroList | LoroMovableList
    if (Array.isArray(value)) {
      for (const item of value) {
        const converted = convertInputToRef(item, shape.shape)
        if (isContainer(converted)) {
          list.pushContainer(converted)
        } else {
          list.push(converted)
        }
      }
    }
  } else if (shape._type === "map") {
    const map = container as LoroMap
    if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value)) {
        const propShape = shape.shapes[k]
        if (propShape) {
          // Use storage key for CRDT access - this respects .key() configuration
          const storageKey = getStorageKey(propShape, k)
          const converted = convertInputToRef(v as Value, propShape)
          if (isContainer(converted)) {
            map.setContainer(storageKey, converted)
          } else {
            map.set(storageKey, converted as Value)
          }
        }
      }
    }
  } else if (shape._type === "record") {
    const map = container as LoroMap
    if (typeof value === "object" && value !== null) {
      for (const [k, v] of Object.entries(value)) {
        const converted = convertInputToRef(v as Value, shape.shape)
        if (isContainer(converted)) {
          map.setContainer(k, converted)
        } else {
          map.set(k, converted as Value)
        }
      }
    }
  } else if (shape._type === "text") {
    const text = container as LoroText
    if (typeof value === "string") {
      // Clear existing content if any? Or assume empty?
      // For migration, we assume empty.
      text.insert(0, value)
    }
  } else if (shape._type === "counter") {
    const counter = container as LoroCounter
    if (typeof value === "number") {
      counter.increment(value)
    }
  }
}
