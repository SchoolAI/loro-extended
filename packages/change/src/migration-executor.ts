/**
 * Migration Executor
 *
 * This module handles the runtime execution of schema migrations.
 * It implements the "Eager Migration" strategy: when accessing a field,
 * if the primary key is missing but a migration source exists, the data
 * is transformed and written to the new key immediately.
 */

import type { Container, LoroDoc, LoroMap, Value } from "loro-crdt"
import { convertInputToRef, populateContainer } from "./conversion.js"
import { getMigrations, getStorageKey } from "./migration.js"
import type { ContainerOrValueShape, ContainerShape } from "./shape.js"
import { isContainer, isContainerShape } from "./utils/type-guards.js"

/**
 * Result of attempting to read a migrated value.
 */
export interface MigrationReadResult {
  /**
   * Whether the value was found (either at primary key or via migration).
   */
  found: boolean

  /**
   * The value, either from the primary key or transformed from a migration source.
   */
  value?: Value

  /**
   * Whether a migration was performed (data was transformed and written).
   */
  migrated: boolean

  /**
   * The source key that was migrated from, if any.
   */
  migratedFrom?: string
}

/**
 * Checks if a key exists in a LoroMap.
 * Uses getShallowValue() to check existence without creating containers.
 *
 * IMPORTANT: An empty value ([], {}, "", 0) is still considered "existing".
 * Only undefined/missing keys return false.
 */
export function keyExistsInMap(map: LoroMap | LoroDoc, key: string): boolean {
  const shallow = map.getShallowValue()
  return key in shallow
}

/**
 * Attempts to read a value from a LoroMap, applying migrations if necessary.
 *
 * The algorithm:
 * 1. Check if the primary key exists in the map
 * 2. If it exists, return the value (even if empty)
 * 3. If missing and migrations are defined:
 *    a. Check each migration source in order
 *    b. If source has data, transform it and write to primary key
 *    c. Return the transformed value
 * 4. If no data found anywhere, return not found
 *
 * @param map - The LoroMap to read from
 * @param logicalKey - The logical field name
 * @param shape - The shape definition (may include migration info)
 * @param readonly - If true, don't perform eager migration writes
 */
export function readWithMigration(
  map: LoroMap,
  logicalKey: string,
  shape: ContainerOrValueShape,
  readonly: boolean = false,
): MigrationReadResult {
  const storageKey = getStorageKey(shape, logicalKey)

  // Step 1: Check if primary key exists
  if (keyExistsInMap(map, storageKey)) {
    return {
      found: true,
      value: map.get(storageKey) as Value,
      migrated: false,
    }
  }

  // Step 2: Check migrations
  const migrations = getMigrations(shape)
  if (!migrations || migrations.length === 0) {
    return {
      found: false,
      migrated: false,
    }
  }

  // Step 3: Try each migration source in order
  for (const migration of migrations) {
    if (keyExistsInMap(map, migration.sourceKey)) {
      const sourceValue = map.get(migration.sourceKey)

      // Transform the source data
      const transformedValue = migration.transform(sourceValue)

      // Eager migration: write to the new key (unless readonly)
      if (!readonly) {
        writeTransformedValue(map, storageKey, transformedValue, shape)
      }

      return {
        found: true,
        value: transformedValue as Value,
        migrated: !readonly,
        migratedFrom: migration.sourceKey,
      }
    }
  }

  // Step 4: No data found
  return {
    found: false,
    migrated: false,
  }
}

/**
 * Writes a transformed value to a LoroMap.
 * Handles both container and value shapes appropriately.
 */
function writeTransformedValue(
  map: LoroMap,
  key: string,
  value: unknown,
  shape: ContainerOrValueShape,
): void {
  if (isContainerShape(shape)) {
    // For container shapes, we need to convert the plain value to a container
    const container = convertInputToRef(value as Value, shape)
    if (isContainer(container)) {
      map.setContainer(key, container)
    } else {
      // Shouldn't happen for container shapes, but handle gracefully
      map.set(key, container as Value)
    }
  } else {
    // For value shapes, just set the value directly
    map.set(key, value as Value)
  }
}

/**
 * Applies migrations to overlay placeholder data.
 * Used by overlayPlaceholder/mergeValue to handle migrated fields in toJSON().
 *
 * @param crdtValue - The raw CRDT value (object with physical keys)
 * @param logicalKey - The logical field name
 * @param shape - The shape definition (may include migration info)
 * @returns The value to use (from primary key or migrated source)
 */
export function getValueWithMigrationFallback(
  crdtValue: Record<string, Value>,
  logicalKey: string,
  shape: ContainerOrValueShape,
): Value | undefined {
  const storageKey = getStorageKey(shape, logicalKey)

  // Check primary key first
  if (storageKey in crdtValue) {
    return crdtValue[storageKey]
  }

  // Check migrations
  const migrations = getMigrations(shape)
  if (!migrations || migrations.length === 0) {
    return undefined
  }

  // Try each migration source
  for (const migration of migrations) {
    if (migration.sourceKey in crdtValue) {
      const sourceValue = crdtValue[migration.sourceKey]
      // Transform and return (but don't write - this is for read-only overlay)
      return migration.transform(sourceValue) as Value
    }
  }

  return undefined
}

/**
 * Recursively applies migrations to a nested structure.
 * This is used when the entire document needs migration-aware serialization.
 */
export function applyMigrationsToValue(
  crdtValue: Record<string, Value>,
  shapes: Record<string, ContainerOrValueShape>,
): Record<string, Value> {
  const result: Record<string, Value> = {}

  for (const [logicalKey, shape] of Object.entries(shapes)) {
    const value = getValueWithMigrationFallback(crdtValue, logicalKey, shape)
    if (value !== undefined) {
      result[logicalKey] = value
    }
  }

  return result
}

/**
 * Helper to handle migration and container retrieval for TypedRefs.
 * This encapsulates the logic of checking for migration, transforming data,
 * and initializing the container if needed.
 *
 * @param parent - The parent container (LoroMap or LoroDoc)
 * @param logicalKey - The logical key of the field
 * @param shape - The shape of the field
 * @param getContainer - Function to get/create the container at the storage key
 * @param readonly - Whether we are in readonly mode
 */
export function migrateAndGetContainer(
  parent: LoroMap | LoroDoc,
  logicalKey: string,
  shape: ContainerShape,
  getContainer: () => Container,
  readonly: boolean,
): Container {
  const storageKey = getStorageKey(shape, logicalKey)

  // 1. Check if storage key exists
  if (keyExistsInMap(parent, storageKey)) {
    return getContainer()
  }

  // 2. Check migrations
  const migrations = getMigrations(shape)
  if (!migrations || migrations.length === 0) {
    return getContainer()
  }

  // 3. Try migrations
  for (const migration of migrations) {
    if (keyExistsInMap(parent, migration.sourceKey)) {
      // Found source data!

      // If readonly, we can't migrate (write), so we just return the empty container
      // (or whatever getContainer returns). The overlay logic in toJSON will handle
      // the read-time migration for serialization.
      if (readonly) {
        return getContainer()
      }

      // Get source value
      let sourceValue: Value
      if ("get" in parent && typeof parent.get === "function") {
        const rawValue = parent.get(migration.sourceKey)
        if (
          isContainer(rawValue) &&
          "toJSON" in rawValue &&
          typeof rawValue.toJSON === "function"
        ) {
          sourceValue = rawValue.toJSON() as Value
        } else if (
          isContainer(rawValue) &&
          "getShallowValue" in rawValue &&
          typeof rawValue.getShallowValue === "function"
        ) {
          sourceValue = rawValue.getShallowValue() as Value
        } else {
          sourceValue = rawValue as Value
        }
      } else {
        // LoroDoc: we need to get the value from the doc
        // Since we don't have a generic get, we use toJSON() to get the value
        // This is safe because we checked keyExistsInMap (which uses getShallowValue)
        const docJson = parent.toJSON()
        sourceValue = docJson[migration.sourceKey]
      }

      // Transform
      const transformedValue = migration.transform(sourceValue)

      // Initialize container with transformed value
      const container = getContainer()

      // Populate container
      if (
        "setContainer" in parent &&
        typeof parent.setContainer === "function"
      ) {
        // LoroMap: we can create a new detached container and set it
        const newContainer = convertInputToRef(transformedValue as Value, shape)
        if (isContainer(newContainer)) {
          parent.setContainer(storageKey, newContainer)
          // We need to return the new container handle that is attached
          return parent.get(storageKey) as Container
        }
      } else {
        // LoroDoc or fallback: populate the existing container
        populateContainer(container, transformedValue, shape)
      }

      return container
    }
  }

  return getContainer()
}
