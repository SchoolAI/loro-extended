import {
  StorageAdapter,
  type Chunk,
  type StorageKey,
} from "@loro-extended/repo"
import { ClassicLevel } from "classic-level"

const KEY_SEP = "::"

export class LevelDBStorageAdapter extends StorageAdapter {
  #db: ClassicLevel<string, Uint8Array>

  constructor(dbPath: string) {
    super({ adapterId: `leveldb:${dbPath}` })
    this.#db = new ClassicLevel(dbPath, {
      valueEncoding: "binary",
    })
  }

  private keyToString(key: StorageKey): string {
    return key.join(KEY_SEP)
  }

  private stringToKey(str: string): StorageKey {
    return str.split(KEY_SEP)
  }

  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    try {
      return await this.#db.get(this.keyToString(key))
    } catch (error: any) {
      if (error.code === "LEVEL_NOT_FOUND") {
        return undefined
      }
      throw error
    }
  }

  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    await this.#db.put(this.keyToString(key), data)
  }

  async remove(key: StorageKey): Promise<void> {
    await this.#db.del(this.keyToString(key))
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    const prefix = this.keyToString(keyPrefix)
    const chunks: Chunk[] = []
    for await (const [key, data] of this.#db.iterator({
      gte: prefix,
      lt: prefix + "\xff",
    })) {
      chunks.push({
        key: this.stringToKey(key),
        data,
      })
    }
    return chunks
  }

  async removeRange(keyPrefix: StorageKey): Promise<void> {
    const prefix = this.keyToString(keyPrefix)
    const keysToDelete: string[] = []
    for await (const key of this.#db.keys({
      gte: prefix,
      lt: prefix + "\xff",
    })) {
      keysToDelete.push(key)
    }
    await this.#db.batch(keysToDelete.map(key => ({ type: "del", key })))
  }
}
