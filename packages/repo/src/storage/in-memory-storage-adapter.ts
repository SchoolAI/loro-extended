import {
  StorageAdapter,
  type Chunk,
  type StorageKey,
} from "./storage-adapter.js"

export class InMemoryStorageAdapter extends StorageAdapter {
  #data = new Map<string, Uint8Array>()

  constructor() {
    super({ adapterId: "in-memory" })
  }

  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    return this.#data.get(this.#keyToString(key))
  }

  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    this.#data.set(this.#keyToString(key), data)
  }

  async remove(key: StorageKey): Promise<void> {
    this.#data.delete(this.#keyToString(key))
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    const results: Chunk[] = []
    for (const [keyStr, data] of this.#data.entries()) {
      const key = this.#stringToKey(keyStr)
      if (this.#isPrefix(keyPrefix, key)) {
        results.push({ key, data })
      }
    }
    return results
  }

  async removeRange(keyPrefix: StorageKey): Promise<void> {
    for (const keyStr of this.#data.keys()) {
      const key = this.#stringToKey(keyStr)
      if (this.#isPrefix(keyPrefix, key)) {
        this.#data.delete(keyStr)
      }
    }
  }

  #isPrefix(prefix: StorageKey, key: StorageKey): boolean {
    if (prefix.length > key.length) {
      return false
    }
    return prefix.every((val, i) => val === key[i])
  }

  #keyToString(key: StorageKey): string {
    return JSON.stringify(key)
  }

  #stringToKey(key: string): StorageKey {
    return JSON.parse(key)
  }
}
