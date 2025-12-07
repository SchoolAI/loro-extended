import type { Value } from "loro-crdt"
import type {
  ContainerShape,
  DiscriminatedUnionValueShape,
  DocShape,
  ValueShape,
} from "./shape.js"
import { isObjectValue } from "./utils/type-guards.js"

/**
 * Overlays CRDT state with placeholder defaults
 */
export function overlayPlaceholder<Shape extends DocShape>(
  shape: Shape,
  crdtValue: { [key: string]: Value },
  placeholderValue: { [key: string]: Value },
): { [key: string]: Value } {
  if (typeof crdtValue !== "object") {
    throw new Error("crdt object is required")
  }

  if (typeof placeholderValue !== "object") {
    throw new Error("placeholder object is required")
  }

  const result = { ...placeholderValue }

  for (const [key, propShape] of Object.entries(shape.shapes)) {
    const propCrdtValue = crdtValue[key]

    const propPlaceholderValue =
      placeholderValue[key as keyof typeof placeholderValue]

    result[key as keyof typeof result] = mergeValue(
      propShape,
      propCrdtValue,
      propPlaceholderValue,
    )
  }

  return result
}

/**
 * Merges individual CRDT values with placeholder defaults
 */
export function mergeValue<Shape extends ContainerShape | ValueShape>(
  shape: Shape,
  crdtValue: Value,
  placeholderValue: Value,
): Value {
  if (crdtValue === undefined && placeholderValue === undefined) {
    throw new Error("either crdt or placeholder value must be defined")
  }

  switch (shape._type) {
    case "text":
      return crdtValue ?? placeholderValue ?? ""
    case "counter":
      return crdtValue ?? placeholderValue ?? 0
    case "list":
    case "movableList":
      return crdtValue ?? placeholderValue ?? []
    case "map": {
      if (!isObjectValue(crdtValue) && crdtValue !== undefined) {
        throw new Error("map crdt must be object")
      }

      const crdtMapValue = crdtValue ?? {}

      if (!isObjectValue(placeholderValue) && placeholderValue !== undefined) {
        throw new Error("map placeholder must be object")
      }

      const placeholderMapValue = placeholderValue ?? {}

      const result = { ...placeholderMapValue }
      for (const [key, nestedShape] of Object.entries(shape.shapes)) {
        const nestedCrdtValue = crdtMapValue[key]
        const nestedPlaceholderValue = placeholderMapValue[key]

        result[key as keyof typeof result] = mergeValue(
          nestedShape,
          nestedCrdtValue,
          nestedPlaceholderValue,
        )
      }

      return result
    }
    case "tree":
      return crdtValue ?? placeholderValue ?? []
    default:
      if (shape._type === "value" && shape.valueType === "object") {
        const crdtObj = (crdtValue as any) ?? {}
        const placeholderObj = (placeholderValue as any) ?? {}
        const result = { ...placeholderObj }

        if (typeof crdtObj !== "object" || crdtObj === null) {
          return crdtValue ?? placeholderValue
        }

        for (const [key, propShape] of Object.entries(shape.shape)) {
          const propCrdt = crdtObj[key]
          const propPlaceholder = placeholderObj[key]
          result[key] = mergeValue(propShape, propCrdt, propPlaceholder)
        }
        return result
      }

      // Handle discriminated unions
      if (shape._type === "value" && shape.valueType === "discriminatedUnion") {
        return mergeDiscriminatedUnion(
          shape as DiscriminatedUnionValueShape,
          crdtValue,
          placeholderValue,
        )
      }

      return crdtValue ?? placeholderValue
  }
}

/**
 * Merges a discriminated union value by determining the variant from the discriminant key.
 * Uses the placeholderValue's discriminant to determine the default variant when the discriminant is missing.
 */
function mergeDiscriminatedUnion(
  shape: DiscriminatedUnionValueShape,
  crdtValue: Value,
  placeholderValue: Value,
): Value {
  const crdtObj = (crdtValue as Record<string, Value>) ?? {}
  const placeholderObj = (placeholderValue as Record<string, Value>) ?? {}

  // Get the discriminant value from CRDT, falling back to placeholder
  const discriminantValue =
    crdtObj[shape.discriminantKey] ?? placeholderObj[shape.discriminantKey]

  if (typeof discriminantValue !== "string") {
    // If no valid discriminant, return the placeholder
    return placeholderValue
  }

  // Find the variant shape for this discriminant value
  const variantShape = shape.variants[discriminantValue]

  if (!variantShape) {
    // Unknown variant - return CRDT value or placeholder
    return crdtValue ?? placeholderValue
  }

  // Merge using the variant's object shape
  // If the placeholder's discriminant doesn't match the current discriminant,
  // we shouldn't use the placeholder for merging as it belongs to a different variant.
  const placeholderDiscriminant = placeholderObj[shape.discriminantKey]
  const effectivePlaceholderValue =
    placeholderDiscriminant === discriminantValue ? placeholderValue : undefined

  return mergeValue(variantShape, crdtValue, effectivePlaceholderValue as Value)
}
