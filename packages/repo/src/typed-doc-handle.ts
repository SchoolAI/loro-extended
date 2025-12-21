import type { DocShape, Mutable, ValueShape } from "@loro-extended/change"
import {
  compileToJsonPath,
  createPathBuilder,
  createTypedDoc,
  evaluatePath,
  hasWildcard,
  type PathBuilder,
  type PathSelector,
  type TypedDoc,
  TypedPresence,
} from "@loro-extended/change"
import type { Listener } from "loro-crdt"
import type { ReadyState } from "./types.js"
import type { ReadinessCheck, UntypedDocHandle } from "./untyped-doc-handle.js"
import { equal } from "./utils/equal.js"

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

  private readonly _docShape: D

  constructor(
    public readonly untyped: UntypedDocHandle,
    docShape: D,
    presenceShape: P,
  ) {
    this.docId = untyped.docId
    this.peerId = untyped.peerId
    this._doc = createTypedDoc(docShape, untyped.doc)
    this._presence = new TypedPresence(presenceShape, untyped.presence)
    this._docShape = docShape
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
   * Subscribe to all changes on the document.
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
  subscribe(listener: Listener): () => void

  /**
   * Subscribe to changes at a specific path using the type-safe DSL.
   *
   * The callback receives:
   * - `value`: The current value at the path (properly typed)
   * - `prev`: The previous value (undefined on first call)
   *
   * This uses two-stage filtering:
   * 1. WASM-side: subscribeJsonpath for efficient path matching
   * 2. JS-side: Deep equality check to filter false positives
   *
   * @param selector - Path selector function using the DSL
   * @param listener - Callback receiving the typed value and previous value
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * handle.subscribe(
   *   p => p.books.$each.title,
   *   (titles, prev) => {
   *     console.log("Titles changed from", prev, "to", titles)
   *   }
   * )
   * ```
   */
  subscribe<T>(
    selector: (path: PathBuilder<D>) => PathSelector<T>,
    listener: (value: T, prev: T | undefined) => void,
  ): () => void

  /**
   * Subscribe to changes that may affect a JSONPath query (escape hatch).
   *
   * Use this for complex queries not expressible in the DSL (filters, etc.).
   * Note: No type safety - callback receives unknown[].
   *
   * @param jsonpath - JSONPath expression (e.g., "$.users[*].name")
   * @param listener - Callback receiving the query result
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * // Subscribe to changes affecting books with price > 10
   * const unsubscribe = handle.subscribe(
   *   "$.books[?@.price>10].title",
   *   (titles) => {
   *     console.log("Expensive book titles:", titles);
   *   }
   * );
   * ```
   */
  subscribe(jsonpath: string, listener: (value: unknown[]) => void): () => void

  // Implementation of subscribe overloads
  subscribe(
    listenerOrSelectorOrJsonpath:
      | Listener
      | ((path: PathBuilder<D>) => PathSelector<unknown>)
      | string,
    pathListener?:
      | ((value: unknown, prev: unknown | undefined) => void)
      | ((value: unknown[]) => void),
  ): () => void {
    // Case 1: Regular subscription (all changes)
    // A regular Listener takes 1 argument and has no second argument
    // A path selector function also takes 1 argument but MUST have a second argument (the listener)
    if (typeof listenerOrSelectorOrJsonpath === "function" && !pathListener) {
      return this._doc.$.loroDoc.subscribe(
        listenerOrSelectorOrJsonpath as Listener,
      )
    }

    // Case 2: Raw JSONPath string (escape hatch)
    if (typeof listenerOrSelectorOrJsonpath === "string") {
      const jsonpath = listenerOrSelectorOrJsonpath
      const loroDoc = this._doc.$.loroDoc

      if (!pathListener) {
        throw new Error("JSONPath subscription requires a listener callback")
      }

      const wrappedCallback = () => {
        const value = loroDoc.JSONPath(jsonpath)
        ;(pathListener as (value: unknown[]) => void)(value)
      }

      return loroDoc.subscribeJsonpath(jsonpath, wrappedCallback)
    }

    // Case 3: Type-safe path selector DSL
    const selectorFn = listenerOrSelectorOrJsonpath as (
      path: PathBuilder<D>,
    ) => PathSelector<unknown>
    const listener = pathListener as (
      value: unknown,
      prev: unknown | undefined,
    ) => void

    if (!listener) {
      throw new Error("Path selector subscription requires a listener callback")
    }

    const pathBuilder = createPathBuilder(this._docShape)
    const selector = selectorFn(pathBuilder)
    const jsonpath = compileToJsonPath(selector.__segments)
    const needsDeepEqual = hasWildcard(selector.__segments)

    // Establish initial previousValue baseline synchronously
    // This is critical for detecting if the first signaled event is a genuine change
    let previousValue: unknown = evaluatePath(this._doc, selector)

    const wrappedCallback = () => {
      const newValue = evaluatePath(this._doc, selector)

      // For paths with wildcards, we need deep equality to filter false positives
      // For exact paths, subscribeJsonpath is already precise
      if (needsDeepEqual && equal(newValue, previousValue)) {
        return // False positive, skip callback
      }

      const prev = previousValue
      previousValue = newValue
      listener(newValue, prev)
    }

    return this._doc.$.loroDoc.subscribeJsonpath(jsonpath, wrappedCallback)
  }

  /**
   * Execute a JSONPath query against the document.
   *
   * This is a general-purpose method for querying the document with full
   * JSONPath expressiveness. Use this for ad-hoc queries or within callbacks.
   *
   * @example
   * ```typescript
   * const expensiveBooks = handle.jsonPath("$.books[?@.price>10]")
   * const allTitles = handle.jsonPath("$..title")
   * ```
   */
  jsonPath(path: string): unknown[] {
    return this._doc.$.loroDoc.JSONPath(path)
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
