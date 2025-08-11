export type StorageKey = string[]
export type StorageId = string

export type Chunk = {
  key: StorageKey
  data: Uint8Array
}

/**
 * An adapter for persisting Loro documents and repo metadata.
 */
export interface StorageAdapter {
  /** Load a binary blob for a given key. */
  load(key: StorageKey): Promise<Uint8Array | undefined>

  /** Save a binary blob to a given key. */
  save(key: StorageKey, data: Uint8Array): Promise<void>

  /** Remove a binary blob from a given key. */
  remove(key: StorageKey): Promise<void>

  /** Load all chunks whose keys begin with the given prefix. */
  loadRange(keyPrefix: StorageKey): Promise<Chunk[]>

  /** Remove all chunks whose keys begin with the given prefix. */
  removeRange(keyPrefix: StorageKey): Promise<void>
}
