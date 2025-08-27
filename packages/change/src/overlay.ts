import type { LoroDocSchema, InferEmptyType } from "./schema.js"

/**
 * Overlays CRDT state with empty state defaults
 */
export function overlayEmptyState<T extends LoroDocSchema>(
  crdtValue: any,
  schema: T,
  emptyState: InferEmptyType<T>
): InferEmptyType<T> {
  if (!crdtValue) return emptyState
  
  const result = { ...emptyState }
  
  for (const [key, schemaValue] of Object.entries(schema.shape)) {
    if (crdtValue[key] !== undefined) {
      result[key as keyof typeof result] = mergeValue(
        crdtValue[key],
        schemaValue,
        emptyState[key as keyof typeof emptyState]
      )
    }
  }
  
  return result
}

/**
 * Merges individual CRDT values with empty state defaults
 */
export function mergeValue(crdtValue: any, schema: any, emptyValue: any): any {
  if (!schema || typeof schema !== "object" || !("_type" in schema)) {
    // It's a Zod schema (POJO) - prefer CRDT value if it exists
    return crdtValue !== undefined ? crdtValue : emptyValue
  }

  switch (schema._type) {
    case "text":
      return crdtValue || emptyValue || ""
    case "counter":
      return crdtValue !== undefined ? crdtValue : emptyValue || 0
    case "list":
    case "movableList":
      return crdtValue || emptyValue || []
    case "map": {
      if (!crdtValue) return emptyValue || {}
      const result = { ...emptyValue }
      for (const [key, nestedSchema] of Object.entries(schema.shape || {})) {
        result[key] = mergeValue(
          crdtValue[key],
          nestedSchema,
          emptyValue?.[key]
        )
      }
      return result
    }
    case "tree":
      return crdtValue || emptyValue || []
    default:
      return crdtValue !== undefined ? crdtValue : emptyValue
  }
}