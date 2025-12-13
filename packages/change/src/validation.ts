import type {
  ArrayValueShape,
  ContainerOrValueShape,
  DiscriminatedUnionValueShape,
  DocShape,
  ListContainerShape,
  MovableListContainerShape,
  RecordContainerShape,
  RecordValueShape,
  StringValueShape,
  StructContainerShape,
  StructValueShape,
  UnionValueShape,
  ValueShape,
} from "./shape.js"
import type { Infer } from "./types.js"

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

  if (schema._type === "struct") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `Expected object at path ${currentPath}, got ${typeof value}`,
      )
    }
    const structSchema = schema as StructContainerShape
    const result: Record<string, unknown> = {}

    // Validate each property in the struct shape
    for (const [key, nestedSchema] of Object.entries(structSchema.shapes)) {
      const nestedPath = `${currentPath}.${key}`
      const nestedValue = (value as Record<string, unknown>)[key]
      result[key] = validateValue(nestedValue, nestedSchema, nestedPath)
    }
    return result
  }

  if (schema._type === "record") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `Expected object at path ${currentPath}, got ${typeof value}`,
      )
    }
    const recordSchema = schema as RecordContainerShape
    const result: Record<string, unknown> = {}

    // Validate each property in the record
    for (const [key, nestedValue] of Object.entries(value)) {
      const nestedPath = `${currentPath}.${key}`
      result[key] = validateValue(nestedValue, recordSchema.shape, nestedPath)
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
      case "string": {
        if (typeof value !== "string") {
          throw new Error(
            `Expected string at path ${currentPath}, got ${typeof value}`,
          )
        }
        const stringSchema = valueSchema as StringValueShape
        if (stringSchema.options && !stringSchema.options.includes(value)) {
          throw new Error(
            `Expected one of [${stringSchema.options.join(", ")}] at path ${currentPath}, got "${value}"`,
          )
        }
        return value
      }

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

      case "struct": {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error(
            `Expected object at path ${currentPath}, got ${typeof value}`,
          )
        }
        const structSchema = valueSchema as StructValueShape
        const result: Record<string, unknown> = {}

        // Validate each property in the struct shape
        for (const [key, nestedSchema] of Object.entries(structSchema.shape)) {
          const nestedPath = `${currentPath}.${key}`
          const nestedValue = (value as Record<string, unknown>)[key]
          result[key] = validateValue(nestedValue, nestedSchema, nestedPath)
        }
        return result
      }

      case "record": {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error(
            `Expected object at path ${currentPath}, got ${typeof value}`,
          )
        }
        const recordSchema = valueSchema as RecordValueShape
        const result: Record<string, unknown> = {}

        // Validate each property in the record
        for (const [key, nestedValue] of Object.entries(value)) {
          const nestedPath = `${currentPath}.${key}`
          result[key] = validateValue(
            nestedValue,
            recordSchema.shape,
            nestedPath,
          )
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

      case "discriminatedUnion": {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error(
            `Expected object at path ${currentPath}, got ${typeof value}`,
          )
        }

        const unionSchema = valueSchema as DiscriminatedUnionValueShape
        const discriminantKey = unionSchema.discriminantKey
        const discriminantValue = (value as Record<string, unknown>)[
          discriminantKey
        ]

        if (typeof discriminantValue !== "string") {
          throw new Error(
            `Expected string for discriminant key "${discriminantKey}" at path ${currentPath}, got ${typeof discriminantValue}`,
          )
        }

        const variantSchema = unionSchema.variants[discriminantValue]

        if (!variantSchema) {
          throw new Error(
            `Invalid discriminant value "${discriminantValue}" at path ${currentPath}. Expected one of: ${Object.keys(
              unionSchema.variants,
            ).join(", ")}`,
          )
        }

        return validateValue(value, variantSchema, currentPath)
      }

      default:
        throw new Error(`Unknown value type: ${(valueSchema as any).valueType}`)
    }
  }

  throw new Error(`Unknown schema type: ${(schema as any)._type}`)
}

/**
 * Validates placeholder against schema structure without using Zod
 * Combines the functionality of createPlaceholderValidator and createValueValidator
 */
export function validatePlaceholder<T extends DocShape>(
  placeholder: unknown,
  schema: T,
): Infer<T> {
  if (
    !placeholder ||
    typeof placeholder !== "object" ||
    Array.isArray(placeholder)
  ) {
    throw new Error("Placeholder must be an object")
  }

  const result: Record<string, unknown> = {}

  // Validate each property in the document schema
  for (const [key, schemaValue] of Object.entries(schema.shapes)) {
    const value = (placeholder as Record<string, unknown>)[key]
    result[key] = validateValue(value, schemaValue, key)
  }

  return result as Infer<T>
}
