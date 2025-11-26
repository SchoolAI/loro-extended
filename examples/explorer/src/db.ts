import { ClassicLevel } from "classic-level"

export interface Record {
  key: string
  docId: string
  type: string
  timestamp: string
  data: Uint8Array
}

const KEY_SEP = "::"

export class LevelDBReader {
  #db: ClassicLevel<string, Uint8Array>

  constructor(dbPath: string) {
    this.#db = new ClassicLevel(dbPath, {
      valueEncoding: "binary",
    })
  }

  async listDocIds(): Promise<string[]> {
    const docIds = new Set<string>()

    for await (const key of this.#db.keys()) {
      const parts = key.split(KEY_SEP)
      if (parts.length > 0) {
        docIds.add(parts[0])
      }
    }

    return Array.from(docIds).sort()
  }

  async getRecords(docId: string): Promise<Record[]> {
    const records: Record[] = []
    const prefix = docId + KEY_SEP

    for await (const [key, data] of this.#db.iterator({
      gte: prefix,
      lt: `${prefix}\xff`,
    })) {
      const parts = key.split(KEY_SEP)
      // Expected format: [docId, type, timestamp]
      if (parts.length >= 3) {
        records.push({
          key,
          docId: parts[0],
          type: parts[1],
          timestamp: parts[2],
          data,
        })
      }
    }

    // Sort by timestamp
    return records.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }

  async close() {
    await this.#db.close()
  }
}
