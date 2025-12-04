import type { Value } from "loro-crdt"
import type {
  ContainerShape,
  DiscriminatedUnionValueShape,
  DocShape,
  ValueShape,
} from "./shape.js"
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
      if (shape._type === "value" && shape.valueType === "object") {
        const crdtObj = (crdtValue as any) ?? {}
        const emptyObj = (emptyValue as any) ?? {}
        const result = { ...emptyObj }

        if (typeof crdtObj !== "object" || crdtObj === null) {
          return crdtValue ?? emptyValue
        }

        for (const [key, propShape] of Object.entries(shape.shape)) {
          const propCrdt = crdtObj[key]
          const propEmpty = emptyObj[key]
          result[key] = mergeValue(propShape, propCrdt, propEmpty)
        }
        return result
      }

      // Handle discriminated unions
      if (shape._type === "value" && shape.valueType === "discriminatedUnion") {
        return mergeDiscriminatedUnion(
          shape as DiscriminatedUnionValueShape,
          crdtValue,
          emptyValue,
        )
      }

      return crdtValue ?? emptyValue
  }
}

/**
 * Merges a discriminated union value by determining the variant from the discriminant key.
 * Uses the emptyValue's discriminant to determine the default variant when the discriminant is missing.
 */
function mergeDiscriminatedUnion(
  shape: DiscriminatedUnionValueShape,
  crdtValue: Value,
  emptyValue: Value,
): Value {
  const crdtObj = (crdtValue as Record<string, Value>) ?? {}
  const emptyObj = (emptyValue as Record<string, Value>) ?? {}

  // Get the discriminant value from CRDT, falling back to empty state
  const discriminantValue =
    crdtObj[shape.discriminantKey] ?? emptyObj[shape.discriminantKey]

  if (typeof discriminantValue !== "string") {
    // If no valid discriminant, return the empty state
    return emptyValue
  }

  // Find the variant shape for this discriminant value
  const variantShape = shape.variants[discriminantValue]

  if (!variantShape) {
    // Unknown variant - return CRDT value or empty
    return crdtValue ?? emptyValue
  }

  // Merge using the variant's object shape
  // If the empty state's discriminant doesn't match the current discriminant,
  // we shouldn't use the empty state for merging as it belongs to a different variant.
  const emptyDiscriminant = emptyObj[shape.discriminantKey]
  const effectiveEmptyValue =
    emptyDiscriminant === discriminantValue ? emptyValue : undefined

  return mergeValue(variantShape, crdtValue, effectiveEmptyValue as Value)
}
