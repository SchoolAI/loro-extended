import type { LoroDoc, LoroEventBatch } from "loro-crdt"
import type { NetworkAdapter } from "./network/network-adapter.js"
import type { AddressedChannelMsg, ChannelMsg } from "./channel.js"
import type { StorageAdapter } from "./storage/storage-adapter.js"
import type { DocContent, DocId, ChannelId } from "./types.js"

export class DataSourceCoordinator {
  constructor(
    private peerId: ChannelId,
    private storageAdapters: Map<string, StorageAdapter>,
    private networkAdapters: Map<string, NetworkAdapter>,
  ) {}

  async loadFromStorage<T extends DocContent>(
    documentId: DocId,
    doc: LoroDoc<T>,
    storageId: string,
  ): Promise<void> {
    const adapter = this.storageAdapters.get(storageId)
    if (!adapter) throw new Error(`Storage adapter ${storageId} not found`)
    // Load all data for this document using loadRange
    const chunks = await adapter.loadRange([documentId])

    if (chunks.length === 0) {
      return
    }

    // Get all updates and sort them by version key
    const updateChunks = chunks
      .filter(chunk => chunk.key.length === 3 && chunk.key[1] === "update")
      .sort((a, b) => {
        // Sort by version key (third element)
        const versionA = a.key[2] as string
        const versionB = b.key[2] as string
        return versionA.localeCompare(versionB)
      })

    if (updateChunks.length === 0) {
      return
    }

    // Apply all updates in order to the existing doc
    for (const updateChunk of updateChunks) {
      doc.import(updateChunk.data)
    }
  }

  async saveToStorage<T extends DocContent>(
    documentId: DocId,
    doc: LoroDoc<T>,
    event: LoroEventBatch,
  ) {
    const storageId = "default"
    const adapter = this.storageAdapters.get(storageId)
    if (!adapter) throw new Error(`Storage adapter ${storageId} not found`)
    // Only save actual changes, not checkouts
    if (event.by === "local" || event.by === "import") {
      // Use the 'to' frontiers as the unique key for this update
      const frontiersKey = this.frontiersToKey(event.to)

      // Convert frontiers to version vectors for the export
      // This gives us the incremental update between the two states
      const fromVersion = doc.frontiersToVV(event.from)
      const update = doc.export({
        mode: "update",
        from: fromVersion,
      })

      try {
        // Store with unique key based on frontiers
        await adapter.save([documentId, "update", frontiersKey], update)
      } catch (error) {
        console.error(
          `[Repo] Failed to save update for document ${documentId}:`,
          error,
        )
        throw error // Re-throw to let DocHandle handle it
      }
    }
  }

  send(message: AddressedChannelMsg) {
    for (const networkAdapter of this.networkAdapters.values()) {
      networkAdapter.send({ ...message, senderId: this.peerId } as ChannelMsg)
    }
  }

  frontiersToKey(frontiers: any[]): string {
    // Convert frontiers to a JSON string then base64 encode for compactness
    const jsonStr = JSON.stringify(frontiers)
    // Use browser-compatible base64 encoding instead of Node.js Buffer
    const base64 = btoa(jsonStr)
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "") // Remove padding
  }
}
