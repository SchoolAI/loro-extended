import type { DocShape, Mutable, ValueShape } from "@loro-extended/change"
import {
  createTypedDoc,
  type TypedDoc,
  TypedPresence,
} from "@loro-extended/change"
import type { Listener } from "loro-crdt"
import type { ReadyState } from "./types.js"
import type { ReadinessCheck, UntypedDocHandle } from "./untyped-doc-handle.js"

/**
 * A strongly-typed handle to a Loro document with typed presence.
 *
 * This class wraps an UntypedDocHandle and provides:
 * - Type-safe document access via `.doc` (a TypedDoc)
 * - Type-safe presence access via `.presence` (a TypedPresence)
 * - Convenience methods for common operations
 *
 * @typeParam D - The document shape
 * @typeParam P - The presence shape (optional)
 */
export class TypedDocHandle<
  D extends DocShape,
  P extends ValueShape = ValueShape,
> {
  /**
   * The document ID.
   */
  public readonly docId: string

  /**
   * The peer ID of the local peer.
   */
  public readonly peerId: string

  private readonly _doc: TypedDoc<D>
  private readonly _presence: TypedPresence<P>

  constructor(
    public readonly untyped: UntypedDocHandle,
    docShape: D,
    presenceShape: P,
  ) {
    this.docId = untyped.docId
    this.peerId = untyped.peerId
    this._doc = createTypedDoc(docShape, untyped.doc)
    this._presence = new TypedPresence(presenceShape, untyped.presence)
  }

  /**
   * The strongly-typed document.
   * Access schema properties directly on doc, use doc.$ for meta operations.
   */
  get doc(): TypedDoc<D> {
    return this._doc
  }

  /**
   * The strongly-typed presence state.
   */
  get presence(): TypedPresence<P> {
    return this._presence
  }

  /**
   * Convenience method: change a set of mutations in a single commit
   */
  change(fn: (draft: Mutable<D>) => void): TypedDoc<D> {
    return this._doc.$.change(fn)
  }

  /**
   * Convenience method: subscribe to all changes on the document.
   *
   * The listener receives a `LoroEventBatch` from loro-crdt containing:
   * - `by`: The origin of the change ("local", "import", or "checkout")
   * - `origin`: Optional string identifying the change source
   * - `currentTarget`: The container ID of the event receiver (undefined for root doc)
   * - `events`: Array of `LoroEvent` objects with container diffs
   * - `from`: The frontiers before the change
   * - `to`: The frontiers after the change
   *
   * @param listener - Callback invoked on each document change
   * @returns Unsubscribe function
   */
  subscribe(listener: Listener): () => void {
    return this._doc.$.loroDoc.subscribe(listener)
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
  ): Promise<TypedDocHandle<D, P>> {
    await this.untyped.waitUntilReady(predicate)
    return this
  }

  /**
   * Convenience method: wait for storage to load.
   */
  async waitForStorage(): Promise<TypedDocHandle<D, P>> {
    await this.untyped.waitForStorage()
    return this
  }

  /**
   * Convenience method: wait for any network source to provide the document.
   */
  async waitForNetwork(): Promise<TypedDocHandle<D, P>> {
    await this.untyped.waitForNetwork()
    return this
  }
}
