/**
 * Document metadata utilities for loro-extended.
 *
 * This module provides utilities for reading and writing document metadata
 * stored in a reserved `_loro_extended_meta_` root container.
 *
 * @module metadata
 */

import type { LoroDoc, LoroMap } from "loro-crdt"

/**
 * Reserved prefix for all loro-extended internal root containers.
 * Any root container key starting with this prefix is reserved for internal use
 * and will be excluded from `toJSON()` output.
 */
export const LORO_EXTENDED_PREFIX = "_loro_extended"

/**
 * The name of the metadata container.
 * Uses leading underscore (internal), `loro_extended` namespace, and trailing underscore for disambiguation.
 */
export const META_CONTAINER_NAME = "_loro_extended_meta_"

/**
 * Document metadata stored in the `_loro_extended_meta_` container.
 */
export interface LoroExtendedMeta {
  /**
   * Whether the document uses mergeable (flattened) storage.
   * When true, containers are stored at the document root with path-based names.
   */
  mergeable?: boolean

  /**
   * Schema version for migration support (reserved for future use).
   */
  schemaVersion?: string
}

/**
 * Checks if a root container key is reserved for loro-extended internal use.
 *
 * @param key - The root container key to check
 * @returns true if the key starts with `_loro_extended`
 */
export function isLoroExtendedReservedKey(key: string): boolean {
  return key.startsWith(LORO_EXTENDED_PREFIX)
}

/**
 * Checks if the document has metadata stored.
 *
 * @param doc - The LoroDoc to check
 * @returns true if the metadata container exists and has content
 */
export function hasMetadata(doc: LoroDoc): boolean {
  const map = doc.getMap(META_CONTAINER_NAME)
  if (!map) return false
  const keys = map.keys()
  return keys.length > 0
}

/**
 * Reads metadata from the document.
 *
 * @param doc - The LoroDoc to read metadata from
 * @returns The metadata object, or an empty object if no metadata exists
 */
export function readMetadata(doc: LoroDoc): LoroExtendedMeta {
  const map = doc.getMap(META_CONTAINER_NAME)
  if (!map) return {}

  const result: LoroExtendedMeta = {}

  const mergeable = map.get("mergeable")
  if (typeof mergeable === "boolean") {
    result.mergeable = mergeable
  }

  const schemaVersion = map.get("schemaVersion")
  if (typeof schemaVersion === "string") {
    result.schemaVersion = schemaVersion
  }

  return result
}

/**
 * Writes metadata to the document.
 * This should only be called once when the document is first created.
 *
 * @param doc - The LoroDoc to write metadata to
 * @param meta - The metadata to write
 */
export function writeMetadata(doc: LoroDoc, meta: LoroExtendedMeta): void {
  const map = doc.getMap(META_CONTAINER_NAME) as LoroMap

  if (meta.mergeable !== undefined) {
    map.set("mergeable", meta.mergeable)
  }

  if (meta.schemaVersion !== undefined) {
    map.set("schemaVersion", meta.schemaVersion)
  }

  doc.commit()
}
