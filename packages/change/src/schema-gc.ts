import type { LoroDoc, LoroMap } from "loro-crdt"
import { getMigrations, getStorageKey, hasMigrations } from "./migration.js"
import type { ContainerShape, DocShape } from "./shape.js"
import { isContainer, isLoroMap } from "./utils/type-guards.js"

/**
 * Options for schema garbage collection.
 */
export interface SchemaGCOptions {
  /**
   * Callback function invoked when keys are deleted.
   * Useful for logging or triggering additional cleanup actions.
   */
  onCleanup?: (deletedKeys: string[]) => void
}

/**
 * Handles garbage collection of deprecated schema fields.
 *
 * This class identifies fields that have been migrated to new storage keys
 * and removes the old data to keep the document clean.
 */
export class SchemaGC {
  constructor(private doc: LoroDoc) {}

  /**
   * Performs garbage collection on the document based on the provided schema.
   *
   * It iterates through the schema, identifies fields with migrations,
   * and checks if the new storage key exists. If the new key exists (meaning migration has happened),
   * it deletes the old source keys defined in the migrations.
   *
   * @param shape The document schema defining the current structure and migrations.
   * @param options Configuration options for the GC process.
   */
  collect(shape: DocShape, options: SchemaGCOptions = {}): void {
    const deletedKeys: string[] = []

    // Start recursive GC from the root document
    gc(this.doc, shape, options, deletedKeys)

    if (deletedKeys.length > 0 && options.onCleanup) {
      options.onCleanup(deletedKeys)
    }

    if (deletedKeys.length > 0) {
      this.doc.commit()
    }
  }
}

/**
 * Recursive GC implementation
 */
export function gc(
  container: LoroDoc | LoroMap,
  shape: ContainerShape | DocShape,
  options: SchemaGCOptions,
  deletedKeysAccumulator: string[],
) {
  const isDoc = shape._type === "doc"
  // @ts-expect-error - we know shapes exists on DocShape and MapContainerShape
  const shapes = shape.shapes

  if (!shapes) return

  const shallowValue = container.getShallowValue()

  for (const [logicalKey, propShape] of Object.entries(shapes)) {
    const childShape = propShape as ContainerShape

    // 1. Handle Migration Cleanup (Only for Maps, not root Doc)
    if (!isDoc && hasMigrations(childShape)) {
      const currentStorageKey = getStorageKey(childShape, logicalKey)

      // Check if V2 exists
      if (Object.hasOwn(shallowValue, currentStorageKey)) {
        const migrations = getMigrations(childShape)
        if (migrations) {
          for (const migration of migrations) {
            const sourceKey = migration.sourceKey
            if (Object.hasOwn(shallowValue, sourceKey)) {
              // Delete V1
              ;(container as LoroMap).delete(sourceKey)
              deletedKeysAccumulator.push(sourceKey)
            }
          }
        }
      }
    }

    // 2. Recurse into nested Maps
    if (childShape._type === "map") {
      const storageKey = getStorageKey(childShape, logicalKey)

      let childContainer: LoroMap | undefined

      if (isDoc) {
        // Root container access
        if (Object.hasOwn(shallowValue, storageKey)) {
          // We assume it's a map if the schema says so
          childContainer = (container as LoroDoc).getMap(storageKey)
        }
      } else {
        // Map access
        const val = (container as LoroMap).get(storageKey)
        if (isContainer(val) && isLoroMap(val)) {
          childContainer = val
        }
      }

      if (childContainer) {
        gc(childContainer, childShape, options, deletedKeysAccumulator)
      }
    }
    // TODO: Handle Records if needed
  }
}
