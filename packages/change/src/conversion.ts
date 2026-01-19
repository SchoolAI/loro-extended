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
  MovableListContainerShape,
  RecordContainerShape,
  RecordValueShape,
  StructContainerShape,
  StructValueShape,
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
 * Converts object input to LoroMap container (Struct)
 */
function convertStructInput(
  value: { [key: string]: Value },
  shape: StructContainerShape | StructValueShape,
): LoroMap | { [key: string]: Value } {
  if (!isContainerShape(shape)) {
    return value
  }

  const map = new LoroMap()

  // Iterate over schema keys to ensure all nested containers are materialized
  for (const k of Object.keys(shape.shapes)) {
    const nestedSchema = shape.shapes[k]
    const v = value[k]

    if (v !== undefined) {
      const convertedValue = convertInputToRef(v, nestedSchema)
      if (isContainer(convertedValue)) {
        map.setContainer(k, convertedValue)
      } else {
        map.set(k, convertedValue)
      }
    } else if (isContainerShape(nestedSchema)) {
      // If value is missing but it's a container shape, create an empty container
      // This ensures deterministic container IDs across peers
      let emptyValue: any
      if (nestedSchema._type === "struct" || nestedSchema._type === "record") {
        emptyValue = {}
      } else if (
        nestedSchema._type === "list" ||
        nestedSchema._type === "movableList"
      ) {
        emptyValue = []
      } else if (nestedSchema._type === "text") {
        emptyValue = ""
      } else if (nestedSchema._type === "counter") {
        emptyValue = 0
      }

      if (emptyValue !== undefined) {
        const convertedValue = convertInputToRef(emptyValue, nestedSchema)
        if (isContainer(convertedValue)) {
          map.setContainer(k, convertedValue)
        }
      }
    }
  }

  // Also handle keys present in value but not in schema (if any, though for structs this shouldn't happen ideally)
  // But for backward compatibility or loose typing, we might want to preserve them?
  // The original code did:
  // if (nestedSchema) { ... } else { map.set(k, value) }
  // So it allowed extra keys.
  for (const [k, v] of Object.entries(value)) {
    if (!shape.shapes[k]) {
      map.set(k, v)
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
    case "struct": {
      if (!isObjectValue(value)) {
        throw new Error("object expected")
      }

      return convertStructInput(value, shape)
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
