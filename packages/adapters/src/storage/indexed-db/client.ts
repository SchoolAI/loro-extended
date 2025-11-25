import {
  type Chunk,
  StorageAdapter,
  type StorageKey,
} from "@loro-extended/repo"
import { type IDBPDatabase, openDB } from "idb"

const DB_NAME = "loro-todo-app"
const DB_VERSION = 1
const STORE_NAME = "chunks"
const KEY_SEP = "::"

export class IndexedDBStorageAdapter extends StorageAdapter {
  #dbPromise: Promise<IDBPDatabase>

  constructor() {
    super({ adapterId: "indexeddb" })
    this.#dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      },
    })
  }

  private keyToString(key: StorageKey): string {
    return key.join(KEY_SEP)
  }

  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    const db = await this.#dbPromise
    return await db.get(STORE_NAME, this.keyToString(key))
  }

  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    console.log("save", key, data)
    const db = await this.#dbPromise
    await db.put(STORE_NAME, data, this.keyToString(key))
  }

  async remove(key: StorageKey): Promise<void> {
    const db = await this.#dbPromise
    await db.delete(STORE_NAME, this.keyToString(key))
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    const db = await this.#dbPromise
    const prefix = this.keyToString(keyPrefix)
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`, false, true)
    let cursor = await db.transaction(STORE_NAME).store.openCursor(range)
    const chunks: Chunk[] = []
    while (cursor) {
      chunks.push({
        key: (cursor.key as string).split(KEY_SEP),
        data: cursor.value,
      })
      cursor = await cursor.continue()
    }
    return chunks
  }

  async removeRange(keyPrefix: StorageKey): Promise<void> {
    const db = await this.#dbPromise
    const prefix = this.keyToString(keyPrefix)
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`, false, true)
    const tx = db.transaction(STORE_NAME, "readwrite")
    let cursor = await tx.store.openCursor(range)
    while (cursor) {
      cursor.delete()
      cursor = await cursor.continue()
    }
    await tx.done
  }
}
