import { LoroDoc } from "loro-crdt"

import type { DocumentId } from "../types.js"
import type { StorageAdapter } from "./storage-adapter.js"

export class StorageSubsystem {
  #storageAdapter: StorageAdapter

  constructor(storageAdapter: StorageAdapter) {
    this.#storageAdapter = storageAdapter
  }

  async loadDoc(documentId: DocumentId): Promise<LoroDoc | null> {
    const data = await this.#storageAdapter.load([documentId])
    if (!data) {
      return null
    }
    return LoroDoc.fromSnapshot(data)
  }

  async saveDoc(documentId: DocumentId, doc: LoroDoc): Promise<void> {
    const data = doc.exportSnapshot()
    await this.#storageAdapter.save([documentId], data)
  }

  async removeDoc(documentId: DocumentId): Promise<void> {
    await this.#storageAdapter.remove([documentId])
  }
}
