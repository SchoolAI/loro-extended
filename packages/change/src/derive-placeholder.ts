import type { ContainerOrValueShape, DocShape, ValueShape } from "./shape.js"
import type { InferPlaceholderType } from "./types.js"

/**
 * Derives the placeholder state from a schema by composing placeholder values.
 *
 * For leaf nodes (text, counter, values): uses _placeholder directly
 * For containers (map, list, record): recurses into nested shapes
 */
export function derivePlaceholder<T extends DocShape>(
  schema: T,
): InferPlaceholderType<T> {
  const result: Record<string, unknown> = {}

  for (const [key, shape] of Object.entries(schema.shapes)) {
    result[key] = deriveShapePlaceholder(shape)
  }

  return result as InferPlaceholderType<T>
}

/**
 * Derives placeholder for a single shape.
 *
 * Leaf nodes: return _placeholder directly
 * Containers: recurse into nested shapes (ignore _placeholder on containers)
 */
export function deriveShapePlaceholder(shape: ContainerOrValueShape): unknown {
  switch (shape._type) {
    // Any container - no placeholder (undefined)
    case "any":
      return undefined

    // Leaf containers - use _placeholder directly
    case "text":
      return shape._placeholder
    case "counter":
      return shape._placeholder

    // Dynamic containers - always empty (no per-entry merging)
    case "list":
    case "movableList":
    case "tree":
      return []
    case "record":
      return {}

    // Structured container - recurse into nested shapes
    case "struct": {
      const result: Record<string, unknown> = {}
      for (const [key, nestedShape] of Object.entries(shape.shapes)) {
        result[key] = deriveShapePlaceholder(nestedShape)
      }
      return result
    }

    case "value":
      return deriveValueShapePlaceholder(shape)

    default:
      return undefined
  }
}

function deriveValueShapePlaceholder(shape: ValueShape): unknown {
  switch (shape.valueType) {
    // Any value - no placeholder (undefined)
    case "any":
      return undefined

    // Leaf values - use _placeholder directly
    case "string":
      return shape._placeholder
    case "number":
      return shape._placeholder
    case "boolean":
      return shape._placeholder
    case "null":
      return null
    case "undefined":
      return undefined
    case "uint8array":
      return shape._placeholder

    // Structured value - recurse into nested shapes (like struct)
    case "struct": {
      const result: Record<string, unknown> = {}
      for (const [key, nestedShape] of Object.entries(shape.shape)) {
        result[key] = deriveValueShapePlaceholder(nestedShape)
      }
      return result
    }

    // Dynamic values - always empty
    case "array":
      return []
    case "record":
      return {}

    // Unions - use _placeholder if explicitly set, otherwise derive from first variant
    case "union": {
      // Check if _placeholder was explicitly set (not the default empty object)
      // We need to check if it's a primitive value OR a non-empty object
      const placeholder = shape._placeholder
      if (placeholder !== undefined) {
        // If it's a primitive (null, string, number, boolean), use it
        if (placeholder === null || typeof placeholder !== "object") {
          return placeholder
        }
        // If it's an object with keys, use it
        if (Object.keys(placeholder as object).length > 0) {
          return placeholder
        }
      }
      // Otherwise derive from first variant
      return deriveValueShapePlaceholder(shape.shapes[0])
    }

    case "discriminatedUnion": {
      // Check if _placeholder was explicitly set (not the default empty object)
      const placeholder = shape._placeholder
      if (placeholder !== undefined) {
        // If it's a primitive (null, string, number, boolean), use it
        if (placeholder === null || typeof placeholder !== "object") {
          return placeholder
        }
        // If it's an object with keys, use it
        if (Object.keys(placeholder as object).length > 0) {
          return placeholder
        }
      }
      // Otherwise derive from first variant
      const firstKey = Object.keys(shape.variants)[0]
      return deriveValueShapePlaceholder(shape.variants[firstKey])
    }

    default:
      return undefined
  }
}
