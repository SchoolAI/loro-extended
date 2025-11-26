import { LoroDoc } from "loro-crdt"
import type { Record } from "./db.js"

export class DocumentReconstructor {
  private records: Record[]

  constructor(records: Record[]) {
    this.records = records
  }

  getStateAt(index: number): unknown {
    if (index < 0 || index >= this.records.length) {
      return null
    }

    const doc = new LoroDoc()

    // Apply all updates up to the specified index
    const updatesToApply = this.records.slice(0, index + 1)

    try {
      const batch = updatesToApply.map(r => r.data)
      doc.importBatch(batch)
      return doc.toJSON()
    } catch (error) {
      console.error("Error reconstructing document:", error)
      return { error: String(error) }
    }
  }
}
