import Emittery from "emittery"
import { LoroDoc, type LoroEventBatch } from "loro-crdt"
import type { DocContent, DocumentId, LoroDocMutator, PeerId } from "./types.js"

/** Peer status for a specific document */
export type DocPeerStatus = {
  hasDoc: boolean
  isAwareOfDoc: boolean
  isSyncingNow: boolean
  lastSyncTime?: Date
}

/** Ready state information for flexible readiness API */
export type ReadyState = {
  source:
    | { type: "storage"; storageId: string }
    | { type: "network"; peerId: string }
  state:
    | { type: "requesting" }
    | { type: "not-found" }
    | { type: "found"; containsNewOperations: boolean }
}

/** Custom predicate for determining readiness */
export type ReadinessCheck = (readyStates: ReadyState[]) => boolean

/** A dictionary of functions that the DocHandle can use to perform side effects. */
export interface DocHandleServices<T extends DocContent> {
  /** A function that loads document data from storage into the provided doc. */
  loadFromStorage?: (documentId: DocumentId, doc: LoroDoc<T>) => Promise<void>
  /** A function that saves the document to storage after changes. */
  saveToStorage?: (
    documentId: DocumentId,
    doc: LoroDoc<T>,
    event: LoroEventBatch,
  ) => Promise<void>
  /** A function that requests document data from the network into the provided doc. */
  requestFromNetwork?: (
    documentId: DocumentId,
    doc: LoroDoc<T>,
    timeout: number,
  ) => Promise<void>
}

// The events that the DocHandle can emit
type DocHandleEvents<T extends DocContent> = {
  "doc-change": {
    doc: LoroDoc<T>
    event: LoroEventBatch
  }
  "doc-local-change": Uint8Array
  "ready-state-changed": {
    readyStates: ReadyState[]
  }
}

/**
 * A simplified handle to a Loro document that is always available.
 * 
 * This class embraces CRDT semantics where documents are always-mergeable
 * and operations are idempotent. Instead of complex loading states, it
 * provides a flexible readiness API that allows applications to define
 * what "ready" means for their specific use case.
 *
 * @typeParam T - The plain JavaScript object schema for the document.
 */
export class DocHandle<T extends DocContent> {
  public readonly documentId: DocumentId
  public readonly doc: LoroDoc<T> = new LoroDoc<T>() // Always available
  
  #services: DocHandleServices<T>
  #peers = new Map<PeerId, DocPeerStatus>()
  #readyStates = new Map<string, ReadyState>()
  #isLoadingFromStorage = false
  #isRequestingFromNetwork = false

  /** @internal */
  _emitter = new Emittery<DocHandleEvents<T>>()

  // Public event API
  public on = this._emitter.on.bind(this._emitter)
  public once = this._emitter.once.bind(this._emitter)
  public off = this._emitter.off.bind(this._emitter)

  constructor(
    documentId: DocumentId,
    services: DocHandleServices<T> = {},
    options: { autoLoad?: boolean } = {},
  ) {
    this.documentId = documentId
    this.#services = services

    // Set up document event subscriptions
    this.#setupDocumentSubscriptions()

    // Start background loading immediately (unless disabled)
    if (options.autoLoad !== false) {
      this.#loadFromStorage()
      this.#requestFromNetwork()
    }
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // PUBLIC API - Always-available document access
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  /**
   * The primary method for an application to mutate the document.
   * The document is always available for mutations.
   * @param mutator A function that receives the document to modify.
   */
  public change(mutator: LoroDocMutator<T>): DocHandle<T> {
    mutator(this.doc)
    this.doc.commit()
    return this // Useful for chaining
  }

  /**
   * Applies a sync message from a remote peer to this document.
   * This is intended for internal use by the network subsystem.
   * @param message The binary sync message.
   * @internal
   */
  public applySyncMessage(message: Uint8Array): void {
    this.doc.import(message)
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // FLEXIBLE READINESS API
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  /**
   * Wait until the document meets custom readiness criteria.
   * @param predicate Function that determines if the document is ready
   * @param timeout Optional timeout in milliseconds
   */
  async waitUntilReady(
    predicate: ReadinessCheck,
    timeout?: number
  ): Promise<void> {
    // Check if already ready
    if (predicate(Array.from(this.#readyStates.values()))) {
      return
    }

    // Wait for ready state changes
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined
      let isResolved = false

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId)
        this._emitter.off("ready-state-changed", checkReadiness)
      }

      if (timeout) {
        timeoutId = setTimeout(() => {
          if (!isResolved) {
            isResolved = true
            cleanup()
            reject(new Error(`Readiness timeout after ${timeout}ms`))
          }
        }, timeout)
      }

      const checkReadiness = ({ readyStates }: { readyStates: ReadyState[] }) => {
        if (!isResolved && predicate(readyStates)) {
          isResolved = true
          cleanup()
          resolve()
        }
      }

      this._emitter.on("ready-state-changed", checkReadiness)
    })
  }

  /**
   * Convenience method: wait for storage to load.
   */
  async waitForStorage(timeout?: number): Promise<void> {
    // Trigger storage loading if not already in progress
    if (!this.#isLoadingFromStorage) {
      this.#loadFromStorage()
    }
    
    return this.waitUntilReady(
      (readyStates) =>
        readyStates.some(
          (s) => s.source.type === "storage" && s.state.type === "found"
        ),
      timeout
    )
  }

  /**
   * Convenience method: wait for a specific peer to provide the document.
   */
  async waitForPeer(peerId: PeerId, timeout?: number): Promise<void> {
    return this.waitUntilReady(
      (readyStates) =>
        readyStates.some(
          (s) =>
            s.source.type === "network" &&
            s.source.peerId === peerId &&
            s.state.type === "found"
        ),
      timeout
    )
  }

  /**
   * Convenience method: wait for any network source to provide the document.
   */
  async waitForNetwork(timeout?: number): Promise<void> {
    // Trigger network loading if not already in progress
    if (!this.#isRequestingFromNetwork) {
      this.#requestFromNetwork()
    }
    
    return this.waitUntilReady(
      (readyStates) =>
        readyStates.some(
          (s) => s.source.type === "network" && s.state.type === "found"
        ),
      timeout
    )
  }

  /**
   * Get current ready states for inspection.
   */
  public getReadyStates(): ReadyState[] {
    return Array.from(this.#readyStates.values())
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // PEER STATE MANAGEMENT
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  /**
   * Update the status of a peer for this document.
   */
  public updatePeerStatus(peerId: PeerId, status: Partial<DocPeerStatus>): void {
    const current = this.#peers.get(peerId) || {
      hasDoc: false,
      isAwareOfDoc: false,
      isSyncingNow: false,
    }
    
    this.#peers.set(peerId, { ...current, ...status })
  }

  /**
   * Get the status of a specific peer for this document.
   */
  public getPeerStatus(peerId: PeerId): DocPeerStatus | undefined {
    return this.#peers.get(peerId)
  }

  /**
   * Get all peer statuses for this document.
   */
  public getAllPeerStatuses(): Map<PeerId, DocPeerStatus> {
    return new Map(this.#peers)
  }

  /**
   * Remove a peer from tracking.
   */
  public removePeer(peerId: PeerId): void {
    this.#peers.delete(peerId)
  }

  /**
   * Get peers that have this document.
   */
  public getPeersWithDoc(): PeerId[] {
    return Array.from(this.#peers.entries())
      .filter(([, status]) => status.hasDoc)
      .map(([peerId]) => peerId)
  }

  /**
   * Get peers that are aware of this document.
   */
  public getPeersAwareOfDoc(): PeerId[] {
    return Array.from(this.#peers.entries())
      .filter(([, status]) => status.isAwareOfDoc)
      .map(([peerId]) => peerId)
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // INTERNAL IMPLEMENTATION
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  #setupDocumentSubscriptions(): void {
    // Listen for all document changes
    this.doc.subscribe((event) => {
      this._emitter.emit("doc-change", {
        doc: this.doc,
        event,
      })

      // Trigger storage save if service is available
      if (
        this.#services.saveToStorage &&
        (event.by === "local" || event.by === "import")
      ) {
        const savePromise = this.#services.saveToStorage(this.documentId, this.doc, event)
        // Only attach catch handler if saveToStorage returns a promise
        if (savePromise && typeof savePromise.catch === "function") {
          savePromise.catch((error) => {
            console.error(
              `Failed to save document ${this.documentId} to storage:`,
              error
            )
          })
        }
      }
    })

    // Listen for local updates for network synchronization
    this.doc.subscribeLocalUpdates((syncMessage) => {
      this._emitter.emit("doc-local-change", syncMessage)
    })
  }

  async #loadFromStorage(): Promise<void> {
    if (!this.#services.loadFromStorage || this.#isLoadingFromStorage) {
      return
    }

    this.#isLoadingFromStorage = true
    const storageId = "default" // Could be made configurable

    // Update ready state to requesting
    this.#updateReadyState(`storage-${storageId}`, {
      source: { type: "storage", storageId },
      state: { type: "requesting" },
    })

    try {
      const hadContentBefore = this.#hasContent()
      await this.#services.loadFromStorage(this.documentId, this.doc)
      const hasNewContent = this.#hasContent() && !hadContentBefore

      // Update ready state to found
      this.#updateReadyState(`storage-${storageId}`, {
        source: { type: "storage", storageId },
        state: { type: "found", containsNewOperations: hasNewContent },
      })
    } catch (error) {
      // Update ready state to not found
      this.#updateReadyState(`storage-${storageId}`, {
        source: { type: "storage", storageId },
        state: { type: "not-found" },
      })
    } finally {
      this.#isLoadingFromStorage = false
    }
  }

  async #requestFromNetwork(timeout = 5000): Promise<void> {
    if (!this.#services.requestFromNetwork || this.#isRequestingFromNetwork) {
      return
    }

    this.#isRequestingFromNetwork = true
    const networkId = "network-request" // Could include peer info

    // Update ready state to requesting
    this.#updateReadyState(networkId, {
      source: { type: "network", peerId: "unknown" }, // Could be more specific
      state: { type: "requesting" },
    })

    try {
      const hadContentBefore = this.#hasContent()
      await this.#services.requestFromNetwork(this.documentId, this.doc, timeout)
      const hasNewContent = this.#hasContent() && !hadContentBefore

      // Update ready state to found
      this.#updateReadyState(networkId, {
        source: { type: "network", peerId: "unknown" },
        state: { type: "found", containsNewOperations: hasNewContent },
      })
    } catch (error) {
      // Update ready state to not found
      this.#updateReadyState(networkId, {
        source: { type: "network", peerId: "unknown" },
        state: { type: "not-found" },
      })
    } finally {
      this.#isRequestingFromNetwork = false
    }
  }

  #updateReadyState(key: string, readyState: ReadyState): void {
    this.#readyStates.set(key, readyState)
    this._emitter.emit("ready-state-changed", {
      readyStates: Array.from(this.#readyStates.values()),
    })
  }

  #hasContent(): boolean {
    // Check if the document has any operations by examining the version vector
    const vv = this.doc.oplogVersion()
    // If any peer has a counter > 0, the document has content
    for (const [, counter] of vv.toJSON()) {
      if (counter > 0) {
        return true
      }
    }
    return false
  }
}
