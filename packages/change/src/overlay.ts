import type { Value } from "loro-crdt"
import type { ContainerShape, DocShape, ValueShape } from "./shape.js"
import { isObjectValue } from "./utils/type-guards.js"

/**
 * Overlays CRDT state with empty state defaults
 */
export function overlayEmptyState<Shape extends DocShape>(
  shape: Shape,
  crdtValue: { [key: string]: Value },
  emptyValue: { [key: string]: Value },
): { [key: string]: Value } {
  if (typeof crdtValue !== "object") {
    throw new Error("crdt object is required")
  }

  if (typeof emptyValue !== "object") {
    throw new Error("empty object is required")
  }

  const result = { ...emptyValue }

  for (const [key, propShape] of Object.entries(shape.shapes)) {
    const propCrdtValue = crdtValue[key]

    const propEmptyValue = emptyValue[key as keyof typeof emptyValue]

    result[key as keyof typeof result] = mergeValue(
      propShape,
      propCrdtValue,
      propEmptyValue,
    )
  }

  return result
}

/**
 * Merges individual CRDT values with empty state defaults
 */
export function mergeValue<Shape extends ContainerShape | ValueShape>(
  shape: Shape,
  crdtValue: Value,
  emptyValue: Value,
): Value {
  if (crdtValue === undefined && emptyValue === undefined) {
    throw new Error("either crdt or empty value must be defined")
  }

  switch (shape._type) {
    case "text":
      return crdtValue ?? emptyValue ?? ""
    case "counter":
      return crdtValue ?? emptyValue ?? 0
    case "list":
    case "movableList":
      return crdtValue ?? emptyValue ?? []
    case "map": {
      if (!isObjectValue(crdtValue) && crdtValue !== undefined) {
        throw new Error("map crdt must be object")
      }

      const crdtMapValue = crdtValue ?? {}

      if (!isObjectValue(emptyValue) && emptyValue !== undefined) {
        throw new Error("map empty state must be object")
      }

      const emptyMapValue = emptyValue ?? {}

      const result = { ...emptyMapValue }
      for (const [key, nestedShape] of Object.entries(shape.shapes)) {
        const nestedCrdtValue = crdtMapValue[key]
        const nestedEmptyValue = emptyMapValue[key]

        result[key as keyof typeof result] = mergeValue(
          nestedShape,
          nestedCrdtValue,
          nestedEmptyValue,
        )
      }

      return result
    }
    case "tree":
      return crdtValue ?? emptyValue ?? []
    default:
      return crdtValue ?? emptyValue
  }
}
