import Emittery from "emittery"
import { LoroDoc } from "loro-crdt"
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

// The events that the DocHandle can emit
type DocHandleEvents = {
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
  #peers = new Map<PeerId, DocPeerStatus>()
  #readyStates = new Map<string, ReadyState>()

  /** @internal */
  _emitter = new Emittery<DocHandleEvents>()

  // Public event API
  public on = this._emitter.on.bind(this._emitter)
  public once = this._emitter.once.bind(this._emitter)
  public off = this._emitter.off.bind(this._emitter)

  constructor(
    public readonly documentId: DocumentId,
    public readonly doc: LoroDoc<T> = new LoroDoc<T>(),
  ) {}

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
  async waitUntilReady(predicate: ReadinessCheck): Promise<DocHandle<T>> {
    for await (const { readyStates } of this._emitter.events(
      "ready-state-changed",
    )) {
      if (predicate(readyStates)) return this
    }
    throw new Error("unreachable wait state")
  }

  /**
   * Convenience method: wait for storage to load.
   */
  async waitForStorage(): Promise<DocHandle<T>> {
    return this.waitUntilReady(readyStates =>
      readyStates.some(
        s => s.source.type === "storage" && s.state.type === "found",
      ),
    )
  }

  /**
   * Convenience method: wait for any network source to provide the document.
   */
  async waitForNetwork(): Promise<DocHandle<T>> {
    return this.waitUntilReady(readyStates =>
      readyStates.some(
        s => s.source.type === "network" && s.state.type === "found",
      ),
    )
  }

  /**
   * Convenience method: wait for a specific peer to provide the document.
   */
  async waitForPeer(peerId: PeerId): Promise<DocHandle<T>> {
    return this.waitUntilReady(readyStates =>
      readyStates.some(
        s =>
          s.source.type === "network" &&
          s.source.peerId === peerId &&
          s.state.type === "found",
      ),
    )
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // PEER STATE MANAGEMENT
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  /**
   * Update the status of a peer for this document.
   */
  public updatePeerStatus(
    peerId: PeerId,
    status: Partial<DocPeerStatus>,
  ): void {
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

  /**
   * Update a source's ready state. Source could be storage or network.
   * @param key Unique key for the source of data
   * @param readyState
   */
  public updateReadyState(key: string, readyState: ReadyState): void {
    this.#readyStates.set(key, readyState)
    this._emitter.emit("ready-state-changed", {
      readyStates: Array.from(this.#readyStates.values()),
    })
  }
}
