import {
  LoroCounter,
  LoroDoc,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
} from "loro-crdt"
import { isContainer } from "./utils/type-guards.js"

/**
 * Schema type checking utilities
 */
export function isLoroSchema(schema: any): boolean {
  return schema && typeof schema === "object" && "_type" in schema
}

/**
 * Converts string input to LoroText container
 */
function convertTextInput(inputValue: any): LoroText | any {
  if (typeof inputValue === "string") {
    const text = new LoroText()
    text.insert(0, inputValue)
    return text
  }
  return inputValue
}

/**
 * Converts number input to LoroCounter container
 */
function convertCounterInput(inputValue: any): LoroCounter | any {
  if (typeof inputValue === "number") {
    const counter = new LoroCounter()
    counter.increment(inputValue)
    return counter
  }
  return inputValue
}

/**
 * Converts array input to LoroList or LoroMovableList container
 */
function convertListInput(
  doc: LoroDoc,
  inputValue: any,
  schema: any,
  parentPath: string[],
  ListClass: typeof LoroList | typeof LoroMovableList
): any {
  if (!Array.isArray(inputValue)) return inputValue
  
  const list = new ListClass()
  for (const item of inputValue) {
    const convertedItem = convertInputToContainer(doc, item, schema.item, parentPath)
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
  doc: LoroDoc,
  inputValue: any,
  schema: any,
  parentPath: string[]
): LoroMap | any {
  if (!inputValue || typeof inputValue !== "object" || Array.isArray(inputValue)) {
    return inputValue
  }
  
  const map = new LoroMap()
  for (const [key, value] of Object.entries(inputValue)) {
    const nestedSchema = schema.shape?.[key]
    if (nestedSchema) {
      const convertedValue = convertInputToContainer(
        doc,
        value,
        nestedSchema,
        [...parentPath, key]
      )
      if (isContainer(convertedValue)) {
        map.setContainer(key, convertedValue)
      } else {
        map.set(key, convertedValue)
      }
    } else {
      map.set(key, value)
    }
  }
  return map
}

/**
 * Main conversion function that transforms input values to appropriate CRDT containers
 * based on schema definitions
 */
export function convertInputToContainer(
  doc: LoroDoc,
  inputValue: any,
  schema: any,
  parentPath: string[]
): any {
  if (!isLoroSchema(schema)) {
    // It's a Zod schema (POJO) - return the value directly
    return inputValue
  }

  switch (schema._type) {
    case "text":
      return convertTextInput(inputValue)
    case "counter":
      return convertCounterInput(inputValue)
    case "list":
      return convertListInput(doc, inputValue, schema, parentPath, LoroList)
    case "movableList":
      return convertListInput(doc, inputValue, schema, parentPath, LoroMovableList)
    case "map":
      return convertMapInput(doc, inputValue, schema, parentPath)
    case "tree":
      // Tree conversion is complex, return as-is for now
      return inputValue
    default:
      return inputValue
  }
}