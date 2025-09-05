import { z } from "zod"
import type { InferInputType, LoroDocSchema } from "./schema.js"

/**
 * Creates a Zod validator for empty state based on schema structure
 */
export function createEmptyStateValidator<T extends LoroDocSchema>(
  schema: T,
): z.ZodType<InferInputType<T>> {
  const objectSchema = z.object(
    Object.fromEntries(
      Object.entries(schema.shape).map(([key, schemaValue]) => [
        key,
        createValueValidator(schemaValue),
      ]),
    ),
  )
  return objectSchema as unknown as z.ZodType<InferInputType<T>>
}

/**
 * Creates a Zod validator for individual schema values
 */
function createValueValidator(schema: any): z.ZodType {
  if (!schema || typeof schema !== "object" || !("_type" in schema)) {
    return schema // Already a Zod schema
  }

  switch (schema._type) {
    case "text":
      return z.string()
    case "counter":
      return z.number()
    case "list":
    case "movableList":
      return z.array(createValueValidator(schema.item))
    case "map":
      return z.object(
        Object.fromEntries(
          Object.entries(schema.shape).map(([key, nestedSchema]) => [
            key,
            createValueValidator(nestedSchema),
          ]),
        ),
      )
    case "tree":
      return z.array(z.any())
    default:
      return z.any()
  }
}
