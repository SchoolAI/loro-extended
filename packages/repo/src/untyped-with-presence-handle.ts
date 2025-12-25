import type { ValueShape } from "@loro-extended/change"
import { TypedPresence } from "@loro-extended/change"
import type { LoroDoc } from "loro-crdt"
import type { ReadyState } from "./types.js"
import type { ReadinessCheck, UntypedDocHandle } from "./untyped-doc-handle.js"

/**
 * A handle for documents where the document structure is untyped (Shape.any())
 * but presence is typed.
 *
 * This is useful when integrating with external libraries like loro-prosemirror
 * that manage their own document structure, but you still want typed presence.
 *
 * @typeParam P - The presence shape
 */
export class UntypedWithPresenceHandle<P extends ValueShape = ValueShape> {
  /**
   * The document ID.
   */
  public readonly docId: string

  /**
   * The peer ID of the local peer.
   */
  public readonly peerId: string

  private readonly _presence: TypedPresence<P>

  constructor(
    public readonly untyped: UntypedDocHandle,
    presenceShape: P,
  ) {
    this.docId = untyped.docId
    this.peerId = untyped.peerId
    this._presence = new TypedPresence(presenceShape, untyped.presence)
  }

  /**
   * The raw LoroDoc - use this to interact with the document directly.
   * This is the escape hatch for when Shape.any() is used at the document level.
   */
  get doc(): LoroDoc {
    return this.untyped.doc
  }

  /**
   * The strongly-typed presence state.
   */
  get presence(): TypedPresence<P> {
    return this._presence
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // Proxy sync methods from UntypedDocHandle
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  /**
   * Get the current ready states for this document.
   */
  get readyStates(): ReadyState[] {
    return this.untyped.readyStates
  }

  /**
   * Subscribe to ready state changes.
   * @param cb Callback that receives the new ready states
   * @returns Unsubscribe function
   */
  onReadyStateChange(cb: (readyStates: ReadyState[]) => void): () => void {
    return this.untyped.onReadyStateChange(cb)
  }

  /**
   * Wait until the document meets custom readiness criteria.
   * @param predicate Function that determines if the document is ready
   */
  async waitUntilReady(
    predicate: ReadinessCheck,
  ): Promise<UntypedWithPresenceHandle<P>> {
    await this.untyped.waitUntilReady(predicate)
    return this
  }

  /**
   * Convenience method: wait for storage to load.
   */
  async waitForStorage(): Promise<UntypedWithPresenceHandle<P>> {
    await this.untyped.waitForStorage()
    return this
  }

  /**
   * Convenience method: wait for any network source to provide the document.
   */
  async waitForNetwork(): Promise<UntypedWithPresenceHandle<P>> {
    await this.untyped.waitForNetwork()
    return this
  }
}
