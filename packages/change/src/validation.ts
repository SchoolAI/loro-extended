import { SchemaViolationError } from "./errors.js"
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
  const currentPath = path || "root"

  if (!schema || typeof schema !== "object" || !("_type" in schema)) {
    throw new SchemaViolationError(currentPath, "valid schema", schema)
  }

  // Handle AnyContainerShape - no validation, accept anything
  if (schema._type === "any") {
    return value
  }

  // Handle ContainerShape types
  if (schema._type === "text") {
    if (typeof value !== "string") {
      throw new SchemaViolationError(currentPath, "string", value)
    }
    return value
  }

  if (schema._type === "counter") {
    if (typeof value !== "number") {
      throw new SchemaViolationError(currentPath, "number", value)
    }
    return value
  }

  if (schema._type === "list" || schema._type === "movableList") {
    if (!Array.isArray(value)) {
      throw new SchemaViolationError(currentPath, "array", value)
    }
    const listSchema = schema as ListContainerShape | MovableListContainerShape
    return value.map((item, index) =>
      validateValue(item, listSchema.shape, `${currentPath}[${index}]`),
    )
  }

  if (schema._type === "struct") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new SchemaViolationError(currentPath, "object", value)
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
      throw new SchemaViolationError(currentPath, "object", value)
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
      throw new SchemaViolationError(currentPath, "array (tree)", value)
    }
    // Trees can contain any structure, so we just validate it's an array
    return value
  }

  // Handle ValueShape types
  if (schema._type === "value") {
    const valueSchema = schema as ValueShape

    switch (valueSchema.valueType) {
      // AnyValueShape - no validation, accept anything
      case "any":
        return value

      case "string": {
        if (typeof value !== "string") {
          throw new SchemaViolationError(currentPath, "string", value)
        }
        const stringSchema = valueSchema as StringValueShape
        if (stringSchema.options && !stringSchema.options.includes(value)) {
          throw new SchemaViolationError(
            currentPath,
            `one of [${stringSchema.options.join(", ")}]`,
            value,
          )
        }
        return value
      }

      case "number":
        if (typeof value !== "number") {
          throw new SchemaViolationError(currentPath, "number", value)
        }
        return value

      case "boolean":
        if (typeof value !== "boolean") {
          throw new SchemaViolationError(currentPath, "boolean", value)
        }
        return value

      case "null":
        if (value !== null) {
          throw new SchemaViolationError(currentPath, "null", value)
        }
        return value

      case "undefined":
        if (value !== undefined) {
          throw new SchemaViolationError(currentPath, "undefined", value)
        }
        return value

      case "uint8array":
        if (!(value instanceof Uint8Array)) {
          throw new SchemaViolationError(currentPath, "Uint8Array", value)
        }
        return value

      case "struct": {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new SchemaViolationError(currentPath, "object", value)
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
          throw new SchemaViolationError(currentPath, "object", value)
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
          throw new SchemaViolationError(currentPath, "array", value)
        }
        const arraySchema = valueSchema as ArrayValueShape
        return value.map((item, index) =>
          validateValue(item, arraySchema.shape, `${currentPath}[${index}]`),
        )
      }

      case "union": {
        const unionSchema = valueSchema as UnionValueShape

        // Try to validate against each shape in the union
        for (const shape of unionSchema.shapes) {
          try {
            return validateValue(value, shape, currentPath)
          } catch {
            // Continue to next shape in union
          }
        }

        throw new SchemaViolationError(currentPath, "one of union types", value)
      }

      case "discriminatedUnion": {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new SchemaViolationError(currentPath, "object", value)
        }

        const unionSchema = valueSchema as DiscriminatedUnionValueShape
        const discriminantKey = unionSchema.discriminantKey
        const discriminantValue = (value as Record<string, unknown>)[
          discriminantKey
        ]

        if (typeof discriminantValue !== "string") {
          throw new SchemaViolationError(
            `${currentPath}.${discriminantKey}`,
            "string (discriminant)",
            discriminantValue,
          )
        }

        const variantSchema = unionSchema.variants[discriminantValue]

        if (!variantSchema) {
          throw new SchemaViolationError(
            `${currentPath}.${discriminantKey}`,
            `one of [${Object.keys(unionSchema.variants).join(", ")}]`,
            discriminantValue,
          )
        }

        return validateValue(value, variantSchema, currentPath)
      }

      default:
        throw new SchemaViolationError(
          currentPath,
          "known value type",
          (valueSchema as any).valueType,
        )
    }
  }

  throw new SchemaViolationError(currentPath, "known schema type", schema)
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
