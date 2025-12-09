import type { Value } from "loro-crdt"
import { deriveShapePlaceholder } from "./derive-placeholder.js"
import { getStorageKey, hasMigrations } from "./migration.js"
import { getValueWithMigrationFallback } from "./migration-executor.js"
import type {
  ContainerOrValueShape,
  ContainerShape,
  DiscriminatedUnionValueShape,
  DocShape,
  ValueShape,
} from "./shape.js"
import { isObjectValue } from "./utils/type-guards.js"

/**
 * Overlays CRDT state with placeholder defaults.
 *
 * This function handles the mapping between logical field names (used in the schema)
 * and physical storage keys (used in the CRDT). It also handles migration fallback
 * when the primary key is missing but a migration source exists.
 *
 * @param shape - The document schema
 * @param crdtValue - The raw CRDT value (uses physical keys)
 * @param placeholderValue - The placeholder defaults (uses logical keys)
 * @returns The merged value (uses logical keys)
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

  for (const [logicalKey, propShape] of Object.entries(shape.shapes)) {
    // Get the CRDT value, handling storage key mapping and migrations
    const propCrdtValue = getCrdtValueWithMigration(
      crdtValue,
      logicalKey,
      propShape,
    )

    const propPlaceholderValue =
      placeholderValue[logicalKey as keyof typeof placeholderValue]

    result[logicalKey as keyof typeof result] = mergeValue(
      propShape,
      propCrdtValue,
      propPlaceholderValue,
    )
  }

  return result
}

/**
 * Gets the CRDT value for a logical key, handling storage key mapping and migrations.
 *
 * @param crdtValue - The raw CRDT value object
 * @param logicalKey - The logical field name
 * @param shape - The shape definition (may include migration info)
 * @returns The value from the CRDT (from primary key or migrated source)
 */
function getCrdtValueWithMigration(
  crdtValue: { [key: string]: Value },
  logicalKey: string,
  shape: ContainerOrValueShape,
): Value {
  // If the shape has migrations, use the migration-aware lookup
  if (hasMigrations(shape)) {
    return getValueWithMigrationFallback(crdtValue, logicalKey, shape) as Value
  }

  // Otherwise, just use the storage key (which may be the same as logical key)
  const storageKey = getStorageKey(shape, logicalKey)
  return crdtValue[storageKey]
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
      return crdtValue !== undefined ? crdtValue : (placeholderValue ?? "")
    case "counter":
      return crdtValue !== undefined ? crdtValue : (placeholderValue ?? 0)
    case "list":
    case "movableList": {
      if (crdtValue === undefined) {
        return placeholderValue ?? []
      }

      const crdtArray = crdtValue as Value[]
      const itemShape = shape.shape
      const itemPlaceholder = deriveShapePlaceholder(itemShape)

      return crdtArray.map(item =>
        mergeValue(itemShape, item, itemPlaceholder as Value),
      )
    }
    case "map": {
      if (!isObjectValue(crdtValue) && crdtValue !== undefined) {
        throw new Error("map crdt must be object")
      }

      const crdtMapValue = (crdtValue ?? {}) as Record<string, Value>

      if (!isObjectValue(placeholderValue) && placeholderValue !== undefined) {
        throw new Error("map placeholder must be object")
      }

      const placeholderMapValue = (placeholderValue ?? {}) as Record<
        string,
        Value
      >

      const result = { ...placeholderMapValue }
      for (const [logicalKey, nestedShape] of Object.entries(shape.shapes)) {
        // Get the CRDT value, handling storage key mapping and migrations
        const nestedCrdtValue = getCrdtValueWithMigration(
          crdtMapValue,
          logicalKey,
          nestedShape,
        )
        const nestedPlaceholderValue = placeholderMapValue[logicalKey]

        result[logicalKey as keyof typeof result] = mergeValue(
          nestedShape,
          nestedCrdtValue,
          nestedPlaceholderValue,
        )
      }

      return result
    }
    case "tree":
      return crdtValue !== undefined ? crdtValue : (placeholderValue ?? [])
    case "record": {
      if (!isObjectValue(crdtValue) && crdtValue !== undefined) {
        throw new Error("record crdt must be object")
      }

      const crdtRecordValue = (crdtValue as Record<string, Value>) ?? {}
      const result: Record<string, Value> = {}

      // For records, we iterate over the keys present in the CRDT value
      // and apply the nested shape's placeholder logic to each value
      for (const key of Object.keys(crdtRecordValue)) {
        const nestedCrdtValue = crdtRecordValue[key]
        // For records, the placeholder is always {}, so we need to derive
        // the placeholder for the nested shape on the fly
        const nestedPlaceholderValue = deriveShapePlaceholder(shape.shape)

        result[key] = mergeValue(
          shape.shape,
          nestedCrdtValue,
          nestedPlaceholderValue as Value,
        )
      }

      return result
    }
    default:
      if (shape._type === "value" && shape.valueType === "object") {
        const crdtObj = (crdtValue as any) ?? {}
        const placeholderObj = (placeholderValue as any) ?? {}
        const result = { ...placeholderObj }

        if (typeof crdtObj !== "object" || crdtObj === null) {
          return crdtValue !== undefined ? crdtValue : placeholderValue
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

      return crdtValue !== undefined ? crdtValue : placeholderValue
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
    return crdtValue !== undefined ? crdtValue : placeholderValue
  }

  // Merge using the variant's object shape
  // If the placeholder's discriminant doesn't match the current discriminant,
  // we shouldn't use the placeholder for merging as it belongs to a different variant.
  const placeholderDiscriminant = placeholderObj[shape.discriminantKey]
  const effectivePlaceholderValue =
    placeholderDiscriminant === discriminantValue ? placeholderValue : undefined

  return mergeValue(variantShape, crdtValue, effectivePlaceholderValue as Value)
}
