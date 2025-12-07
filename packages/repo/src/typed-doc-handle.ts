import type {
  DeepReadonly,
  DocShape,
  Draft,
  Infer,
  ValueShape,
} from "@loro-extended/change"
import { TypedDoc, TypedPresence } from "@loro-extended/change"
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
    this._doc = new TypedDoc(docShape, untyped.doc)
    this._presence = new TypedPresence(presenceShape, untyped.presence)
  }

  /**
   * The strongly-typed document.
   * Use `.value` for read access, `.change()` for mutations.
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
   * Convenience method: Get the current document value.
   */
  get value(): DeepReadonly<Infer<D>> {
    return this._doc.value
  }

  /**
   * Convenience method: Mutate the document.
   */
  change(fn: (draft: Draft<D>) => void): Infer<D> {
    return this._doc.change(fn)
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
