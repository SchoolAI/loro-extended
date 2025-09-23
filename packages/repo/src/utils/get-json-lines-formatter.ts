import type { JsonLinesFormatterOptions, LogRecord } from "@logtape/logtape"
import { getJsonLinesFormatter as originalGetJsonLinesFormatter } from "@logtape/logtape"

/**
 * Recursively converts Map objects to plain objects for JSON serialization.
 * This allows Maps to be properly logged in JSON format.
 *
 * @param value - The value to transform
 * @returns The transformed value with Maps converted to objects
 */
function mapToObject(value: unknown): unknown {
  // Handle Map instances
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {}
    for (const [key, val] of value.entries()) {
      // Convert key to string (JSON keys must be strings)
      const stringKey = String(key)
      obj[stringKey] = mapToObject(val)
    }
    return obj
  }

  // Handle arrays recursively
  if (Array.isArray(value)) {
    return value.map(mapToObject)
  }

  // Handle plain objects recursively
  if (
    value !== null &&
    typeof value === "object" &&
    value.constructor === Object
  ) {
    const obj: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      obj[key] = mapToObject(val)
    }
    return obj
  }

  // Return primitives and other types as-is
  return value
}

export function getJsonLinesFormatter(options?: JsonLinesFormatterOptions) {
  const baseFormatter = originalGetJsonLinesFormatter(options)

  return (record: LogRecord): string => {
    // Transform the record's properties to convert Maps
    const transformedRecord: LogRecord = {
      ...record,
      properties: mapToObject(record.properties) as Record<string, unknown>,
      // Also transform message values if they might contain Maps
      message: record.message.map((part, i) =>
        i % 2 === 1 ? mapToObject(part) : part,
      ),
    }

    return baseFormatter(transformedRecord)
  }
}
