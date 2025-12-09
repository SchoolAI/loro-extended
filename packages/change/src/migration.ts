/**
 * Schema Migration Types and Utilities
 *
 * This module provides the foundation for the "Mapped Schema" approach to schema migration.
 * It allows decoupling the logical schema (public API) from physical storage (CRDT keys).
 */

import type {
  ContainerOrValueShape,
  MigratableContainerShape,
  MigrationDefinition,
  MigrationMethods,
} from "./shape.js"

// Re-export types from shape.ts
export type { MigrationDefinition, MigratableContainerShape, MigrationMethods }

/**
 * Type guard to check if a shape has migration methods.
 * Container shapes from Shape.* factories always have these methods.
 */
function isMigratable<S extends ContainerOrValueShape>(
  shape: S,
): shape is S & MigrationMethods<S> {
  return "_storageKey" in shape || "_migrations" in shape || "key" in shape
}

/**
 * Gets the physical storage key for a shape.
 * Returns the _storageKey if set, otherwise returns the provided logical key.
 */
export function getStorageKey<S extends ContainerOrValueShape>(
  shape: S | MigratableContainerShape<S>,
  logicalKey: string,
): string {
  if (isMigratable(shape)) {
    return shape._storageKey ?? logicalKey
  }
  return logicalKey
}

/**
 * Gets the migration definitions for a shape, if any.
 */
export function getMigrations<S extends ContainerOrValueShape>(
  shape: S | MigratableContainerShape<S>,
): MigrationDefinition[] | undefined {
  if (isMigratable(shape)) {
    return shape._migrations
  }
  return undefined
}

/**
 * Checks if a shape has migration support configured.
 */
export function hasMigrations<S extends ContainerOrValueShape>(
  shape: S | MigratableContainerShape<S>,
): boolean {
  const migrations = getMigrations(shape)
  return migrations !== undefined && migrations.length > 0
}

/**
 * Checks if a shape has a custom storage key.
 */
export function hasCustomStorageKey<S extends ContainerOrValueShape>(
  shape: S | MigratableContainerShape<S>,
): boolean {
  if (isMigratable(shape)) {
    return shape._storageKey !== undefined
  }
  return false
}
