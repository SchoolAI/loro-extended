import * as fs from "node:fs"
import * as path from "node:path"
import type { Chunk, StorageAdapter, StorageKey } from "./storage-adapter.js"

// Simple file-based storage adapter for testing
export class SimpleFileStorageAdapter implements StorageAdapter {
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(dbPath, { recursive: true })
    }
  }

  private keyToPath(key: StorageKey): string {
    return path.join(this.dbPath, key.join("-") + ".bin")
  }

  async load(key: StorageKey): Promise<Uint8Array | undefined> {
    const filePath = this.keyToPath(key)
    if (fs.existsSync(filePath)) {
      return new Uint8Array(fs.readFileSync(filePath))
    }
    return undefined
  }

  async save(key: StorageKey, data: Uint8Array): Promise<void> {
    const filePath = this.keyToPath(key)
    fs.writeFileSync(filePath, data)
  }

  async remove(key: StorageKey): Promise<void> {
    const filePath = this.keyToPath(key)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }

  async loadRange(keyPrefix: StorageKey): Promise<Chunk[]> {
    const chunks: Chunk[] = []
    const prefix = keyPrefix.join("-")

    if (fs.existsSync(this.dbPath)) {
      const files = fs.readdirSync(this.dbPath)
      for (const file of files) {
        if (file.startsWith(prefix) && file.endsWith(".bin")) {
          const keyStr = file.slice(0, -4) // Remove .bin
          const key = keyStr.split("-")
          const data = new Uint8Array(
            fs.readFileSync(path.join(this.dbPath, file)),
          )
          chunks.push({ key, data })
        }
      }
    }

    return chunks
  }

  async removeRange(keyPrefix: StorageKey): Promise<void> {
    const prefix = keyPrefix.join("-")

    if (fs.existsSync(this.dbPath)) {
      const files = fs.readdirSync(this.dbPath)
      for (const file of files) {
        if (file.startsWith(prefix) && file.endsWith(".bin")) {
          fs.unlinkSync(path.join(this.dbPath, file))
        }
      }
    }
  }
}
