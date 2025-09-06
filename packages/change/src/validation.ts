import type {
  ArrayValueShape,
  ContainerOrValueShape,
  DocShape,
  InferInputType,
  ListContainerShape,
  MapContainerShape,
  MovableListContainerShape,
  ObjectValueShape,
  UnionValueShape,
  ValueShape,
} from "./schema.js"

/**
 * Validates a value against a ContainerShape or ValueShape schema
 */
export function validateValue(
  value: unknown,
  schema: ContainerOrValueShape,
  path: string = "",
): unknown {
  if (!schema || typeof schema !== "object" || !("_type" in schema)) {
    throw new Error(`Invalid schema at path ${path}: missing _type`)
  }

  const currentPath = path || "root"

  // Handle ContainerShape types
  if (schema._type === "text") {
    if (typeof value !== "string") {
      throw new Error(
        `Expected string at path ${currentPath}, got ${typeof value}`,
      )
    }
    return value
  }

  if (schema._type === "counter") {
    if (typeof value !== "number") {
      throw new Error(
        `Expected number at path ${currentPath}, got ${typeof value}`,
      )
    }
    return value
  }

  if (schema._type === "list" || schema._type === "movableList") {
    if (!Array.isArray(value)) {
      throw new Error(
        `Expected array at path ${currentPath}, got ${typeof value}`,
      )
    }
    const listSchema = schema as ListContainerShape | MovableListContainerShape
    return value.map((item, index) =>
      validateValue(item, listSchema.shape, `${currentPath}[${index}]`),
    )
  }

  if (schema._type === "map") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `Expected object at path ${currentPath}, got ${typeof value}`,
      )
    }
    const mapSchema = schema as MapContainerShape
    const result: Record<string, unknown> = {}

    // Validate each property in the map shape
    for (const [key, nestedSchema] of Object.entries(mapSchema.shape)) {
      const nestedPath = `${currentPath}.${key}`
      const nestedValue = (value as Record<string, unknown>)[key]
      result[key] = validateValue(nestedValue, nestedSchema, nestedPath)
    }
    return result
  }

  if (schema._type === "tree") {
    if (!Array.isArray(value)) {
      throw new Error(
        `Expected array for tree at path ${currentPath}, got ${typeof value}`,
      )
    }
    // Trees can contain any structure, so we just validate it's an array
    return value
  }

  // Handle ValueShape types
  if (schema._type === "value") {
    const valueSchema = schema as ValueShape

    switch (valueSchema.valueType) {
      case "string":
        if (typeof value !== "string") {
          throw new Error(
            `Expected string at path ${currentPath}, got ${typeof value}`,
          )
        }
        return value

      case "number":
        if (typeof value !== "number") {
          throw new Error(
            `Expected number at path ${currentPath}, got ${typeof value}`,
          )
        }
        return value

      case "boolean":
        if (typeof value !== "boolean") {
          throw new Error(
            `Expected boolean at path ${currentPath}, got ${typeof value}`,
          )
        }
        return value

      case "null":
        if (value !== null) {
          throw new Error(
            `Expected null at path ${currentPath}, got ${typeof value}`,
          )
        }
        return value

      case "undefined":
        if (value !== undefined) {
          throw new Error(
            `Expected undefined at path ${currentPath}, got ${typeof value}`,
          )
        }
        return value

      case "uint8array":
        if (!(value instanceof Uint8Array)) {
          throw new Error(
            `Expected Uint8Array at path ${currentPath}, got ${typeof value}`,
          )
        }
        return value

      case "object": {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error(
            `Expected object at path ${currentPath}, got ${typeof value}`,
          )
        }
        const objectSchema = valueSchema as ObjectValueShape
        const result: Record<string, unknown> = {}

        // Validate each property in the object shape
        for (const [key, nestedSchema] of Object.entries(objectSchema.shape)) {
          const nestedPath = `${currentPath}.${key}`
          const nestedValue = (value as Record<string, unknown>)[key]
          result[key] = validateValue(nestedValue, nestedSchema, nestedPath)
        }
        return result
      }

      case "array": {
        if (!Array.isArray(value)) {
          throw new Error(
            `Expected array at path ${currentPath}, got ${typeof value}`,
          )
        }
        const arraySchema = valueSchema as ArrayValueShape
        return value.map((item, index) =>
          validateValue(item, arraySchema.shape, `${currentPath}[${index}]`),
        )
      }

      case "union": {
        const unionSchema = valueSchema as UnionValueShape
        let lastError: Error | null = null

        // Try to validate against each shape in the union
        for (const shape of unionSchema.shapes) {
          try {
            return validateValue(value, shape, currentPath)
          } catch (error) {
            lastError = error as Error
          }
        }

        throw new Error(
          `Value at path ${currentPath} does not match any union type: ${lastError?.message}`,
        )
      }

      default:
        // biome-ignore lint/suspicious/noExplicitAny: impossible state
        throw new Error(`Unknown value type: ${(valueSchema as any).valueType}`)
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: impossible state
  throw new Error(`Unknown schema type: ${(schema as any)._type}`)
}

/**
 * Validates empty state against schema structure without using Zod
 * Combines the functionality of createEmptyStateValidator and createValueValidator
 */
export function validateEmptyState<T extends DocShape>(
  emptyState: unknown,
  schema: T,
): InferInputType<T> {
  if (
    !emptyState ||
    typeof emptyState !== "object" ||
    Array.isArray(emptyState)
  ) {
    throw new Error("Empty state must be an object")
  }

  const result: Record<string, unknown> = {}

  // Validate each property in the document schema
  for (const [key, schemaValue] of Object.entries(schema.shape)) {
    const value = (emptyState as Record<string, unknown>)[key]
    result[key] = validateValue(value, schemaValue, key)
  }

  return result as InferInputType<T>
}
