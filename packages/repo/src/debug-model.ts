import { LoroDoc, type LoroList, type LoroMap } from "loro-crdt"
import type { Patch } from "mutative"
import type { DocumentId, PeerId } from "./types.js"

/**
 * Debug model that mirrors the synchronizer state using LoroDoc.
 * This provides observability and time-travel debugging capabilities.
 */
export class DebugModel {
  public readonly doc: LoroDoc
  private readonly peersMap: LoroMap
  private readonly localDocsList: LoroList

  constructor() {
    this.doc = new LoroDoc()

    // Initialize the containers
    this.peersMap = this.doc.getMap("peers")
    this.localDocsList = this.doc.getList("localDocs")
  }

  /**
   * Apply patches from the synchronizer to the debug model.
   */
  public applyPatches(patches: Patch[]): void {
    for (const patch of patches) {
      this.applyPatch(patch)
    }
  }

  private applyPatch(patch: Patch): void {
    const path = patch.path

    try {
      // Handle peer changes
      if (path[0] === "peers") {
        const peerId = path[1] as PeerId

        if (patch.op === "add" || patch.op === "replace") {
          this.peersMap.set(peerId, patch.value)
        } else if (patch.op === "remove") {
          this.peersMap.delete(peerId)
        }
      }

      // Handle localDocs changes
      else if (path[0] === "localDocs") {
        if (patch.op === "add") {
          // For Set operations, we need to check if the document is already in the list
          const docId = patch.value as DocumentId
          const currentDocs = this.localDocsList.toArray()
          if (!currentDocs.includes(docId)) {
            this.localDocsList.push(docId)
          }
        } else if (patch.op === "remove") {
          // Remove the document from the list
          const docId = patch.value as DocumentId
          const currentDocs = this.localDocsList.toArray()
          const index = currentDocs.indexOf(docId)
          if (index !== -1) {
            this.localDocsList.delete(index, 1)
          }
        }
      }

      // Handle syncStates changes (simplified - just track document IDs)
      else if (path[0] === "syncStates") {
        const syncStatesMap = this.doc.getMap("syncStates")
        const documentId = path[1] as DocumentId

        if (patch.op === "add" || patch.op === "replace") {
          syncStatesMap.set(documentId, patch.value)
        } else if (patch.op === "remove") {
          syncStatesMap.delete(documentId)
        }
      }

      // Handle remoteDocs changes (simplified)
      else if (path[0] === "remoteDocs") {
        const remoteDocsMap = this.doc.getMap("remoteDocs")

        if (path[1] === "peersWithDoc") {
          const peersWithDocMap = this.doc.getMap("peersWithDoc")
          const documentId = path[2] as DocumentId

          if (patch.op === "add" || patch.op === "replace") {
            // Convert Set to Array for LoroDoc storage
            const peers = Array.from(patch.value as Set<PeerId>)
            peersWithDocMap.set(documentId, peers)
          } else if (patch.op === "remove") {
            peersWithDocMap.delete(documentId)
          }
        } else if (path[1] === "peersAwareOfDoc") {
          const peersAwareOfDocMap = this.doc.getMap("peersAwareOfDoc")
          const documentId = path[2] as DocumentId

          if (patch.op === "add" || patch.op === "replace") {
            // Convert Set to Array for LoroDoc storage
            const peers = Array.from(patch.value as Set<PeerId>)
            peersAwareOfDocMap.set(documentId, peers)
          } else if (patch.op === "remove") {
            peersAwareOfDocMap.delete(documentId)
          }
        }
      }
    } catch (error) {
      console.warn("Failed to apply patch to debug model:", patch, error)
    }
  }

  /**
   * Get the current peers as a plain object.
   */
  public getPeers(): Record<PeerId, any> {
    return this.peersMap.toJSON() as Record<PeerId, any>
  }

  /**
   * Get the current local documents as an array.
   */
  public getLocalDocs(): DocumentId[] {
    return this.localDocsList.toArray() as DocumentId[]
  }

  /**
   * Get the current sync states as a plain object.
   */
  public getSyncStates(): Record<DocumentId, any> {
    const syncStatesMap = this.doc.getMap("syncStates")
    return syncStatesMap.toJSON() as Record<DocumentId, any>
  }

  /**
   * Subscribe to changes in the peers map.
   */
  public subscribeToPeers(callback: () => void): () => void {
    return this.peersMap.subscribe(callback)
  }

  /**
   * Subscribe to changes in the local documents list.
   */
  public subscribeToLocalDocs(callback: () => void): () => void {
    return this.localDocsList.subscribe(callback)
  }

  /**
   * Subscribe to changes in the sync states.
   */
  public subscribeToSyncStates(callback: () => void): () => void {
    const syncStatesMap = this.doc.getMap("syncStates")
    return syncStatesMap.subscribe(callback)
  }

  /**
   * Get a snapshot of the entire debug state.
   */
  public getSnapshot(): any {
    return this.doc.toJSON()
  }

  /**
   * Export the debug model for time-travel debugging.
   */
  public export(): Uint8Array {
    return this.doc.export({ mode: "snapshot" })
  }

  /**
   * Import a debug model state for time-travel debugging.
   */
  public import(data: Uint8Array): void {
    this.doc.import(data)
  }
}
