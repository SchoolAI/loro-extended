import { getLogger, type Logger } from "@logtape/logtape"
import type {
  AnyContainerShape,
  DocShape,
  ValueShape,
} from "@loro-extended/change"
import type { AnyAdapter } from "./adapter/adapter.js"
import { createRules, type Rules } from "./rules.js"
import { type HandleUpdateFn, Synchronizer } from "./synchronizer.js"
import { TypedDocHandle } from "./typed-doc-handle.js"
import type { DocId, PeerIdentityDetails } from "./types.js"
import { UntypedDocHandle } from "./untyped-doc-handle.js"
import { UntypedWithPresenceHandle } from "./untyped-with-presence-handle.js"
import { generatePeerId } from "./utils/generate-peer-id.js"
import { validatePeerId } from "./utils/validate-peer-id.js"

export interface RepoParams {
  identity: Omit<PeerIdentityDetails, "peerId"> & { peerId?: `${number}` }
  adapters: AnyAdapter[]
  rules?: Partial<Rules>
  onUpdate?: HandleUpdateFn
}

/**
 * The Repo class is the central orchestrator for the Loro state synchronization system.
 * It manages the lifecycle of documents, coordinates subsystems, and provides the main
 * public API for document operations.
 *
 * With the simplified DocHandle architecture, Repo becomes a simpler orchestrator
 * that wires together the various subsystems without complex state management.
 *
 * Adapters are used to indicate how to retrieve doc state (updates, sync, etc.) from
 * storage or network systems.
 */
export class Repo {
  readonly logger: Logger
  readonly identity: PeerIdentityDetails

  // Subsystems
  readonly #synchronizer: Synchronizer
  readonly #untypedHandles: Map<DocId, UntypedDocHandle> = new Map()

  constructor({ identity, adapters, rules, onUpdate }: RepoParams) {
    // Validate peerId if provided, otherwise generate one
    const peerId = identity.peerId ?? generatePeerId()
    validatePeerId(peerId)

    // Ensure identity has both peerId and name
    this.identity = { ...identity, peerId }

    const logger = getLogger(["@loro-extended", "repo"]).with({
      identity: this.identity,
    })
    this.logger = logger

    logger.debug("new Repo: {identity}", { identity: this.identity })

    // Instantiate synchronizer
    const synchronizer = new Synchronizer({
      identity: this.identity,
      adapters,
      rules: createRules(rules),
      logger,
      onUpdate,
    })

    this.#synchronizer = synchronizer
  }

  //
  // PUBLIC API - Document access with flexible typing
  //

  /**
   * Gets (or creates) a typed document handle with the given shapes.
   *
   * The document is immediately available for use. The returned handle provides
   * type-safe access to the document and presence data.
   *
   * @param docId The document ID
   * @param docShape The shape of the document
   * @param presenceShape The shape of the presence data (optional)
   * @returns A TypedDocHandle with typed document and presence access
   *
   * @example
   * ```typescript
   * const handle = repo.get('my-doc', MyDocSchema, MyPresenceSchema)
   * handle.doc.change(draft => {
   *   draft.title = 'Hello'
   * })
   * ```
   */
  get<D extends DocShape, P extends ValueShape>(
    docId: DocId,
    docShape: D,
    presenceShape: P,
  ): TypedDocHandle<D, P>

  /**
   * Gets (or creates) a typed document handle with the given doc shape.
   *
   * @param docId The document ID
   * @param docShape The shape of the document
   * @returns A TypedDocHandle with typed document access
   */
  get<D extends DocShape>(
    docId: DocId,
    docShape: D,
  ): TypedDocHandle<D, ValueShape>

  /**
   * Gets (or creates) an untyped document handle with typed presence.
   *
   * Use this when integrating with external libraries (like loro-prosemirror)
   * that manage their own document structure, but you still want typed presence.
   *
   * @param docId The document ID
   * @param docShape Shape.any() - indicates the document is untyped
   * @param presenceShape The shape of the presence data
   * @returns An UntypedWithPresenceHandle with raw LoroDoc and typed presence
   *
   * @example
   * ```typescript
   * const handle = repo.get('my-doc', Shape.any(), CursorPresenceSchema)
   * // Document is raw LoroDoc
   * handle.doc.getMap('doc').set('key', 'value')
   * // Presence is typed
   * handle.presence.set({ cursor: { x: 100, y: 200 } })
   * ```
   */
  get<P extends ValueShape>(
    docId: DocId,
    docShape: AnyContainerShape,
    presenceShape: P,
  ): UntypedWithPresenceHandle<P>

  /**
   * Gets (or creates) an untyped document handle.
   *
   * This overload maintains backward compatibility with existing code that
   * calls `repo.get(docId)` without a schema.
   *
   * @param docId The document ID
   * @returns An UntypedDocHandle with direct LoroDoc access
   *
   * @example
   * ```typescript
   * const handle = repo.get('my-doc')
   * handle.change(doc => {
   *   doc.getMap('root').set('key', 'value')
   * })
   * ```
   */
  get(docId: DocId): UntypedDocHandle

  // Implementation
  get<D extends DocShape, P extends ValueShape>(
    docId: DocId,
    docShape?: D | AnyContainerShape,
    presenceShape?: P,
  ): TypedDocHandle<D, P> | UntypedDocHandle | UntypedWithPresenceHandle<P> {
    const untypedHandle = this.getUntyped(docId)

    // If no docShape provided, return untyped handle (backward compatible)
    if (!docShape) {
      return untypedHandle
    }

    // If docShape is AnyContainerShape (Shape.any()), return UntypedWithPresenceHandle
    if ("_type" in docShape && docShape._type === "any") {
      const pShape = presenceShape ?? ({} as unknown as P)
      return new UntypedWithPresenceHandle(untypedHandle, pShape)
    }

    // Default to empty object shape if presence shape not provided
    const pShape = presenceShape ?? ({} as unknown as P)

    return new TypedDocHandle(untypedHandle, docShape as D, pShape)
  }

  //
  // PUBLIC API - Untyped document access (for advanced use cases)
  //

  /**
   * Gets (or creates) an untyped document handle.
   *
   * Use this when you need direct access to the underlying LoroDoc,
   * or when working with dynamic schemas.
   *
   * @param docId The document ID
   * @returns An UntypedDocHandle with direct LoroDoc access
   */
  getUntyped(docId: DocId): UntypedDocHandle {
    let handle = this.#untypedHandles.get(docId)

    if (!handle) {
      handle = new UntypedDocHandle({
        docId,
        synchronizer: this.#synchronizer,
        logger: this.logger,
      })
      this.#untypedHandles.set(docId, handle)
    }

    return handle
  }

  has(docId: DocId): boolean {
    // Check both handles and synchronizer's document state
    // This allows has() to return true for documents discovered via directory-response
    const hasHandle = this.#untypedHandles.has(docId)
    const hasDocState = this.#synchronizer.getDocumentState(docId) !== undefined
    return hasHandle || hasDocState
  }

  /**
   * Deletes a document from the repo.
   * @param documentId The ID of the document to delete
   */
  async delete(docId: DocId): Promise<void> {
    this.#untypedHandles.delete(docId)
    await this.#synchronizer.removeDocument(docId)
  }

  /**
   * Disconnects all network adapters and cleans up resources.
   * This should be called when the Repo is no longer needed.
   */
  reset(): void {
    // Clear synchronizer model
    this.#synchronizer.reset()
  }

  // For debugging/testing purposes
  get synchronizer() {
    return this.#synchronizer
  }
}
