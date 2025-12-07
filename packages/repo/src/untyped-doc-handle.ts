import { getLogger, type Logger } from "@logtape/logtape"
import type { ObjectValue, PresenceInterface } from "@loro-extended/change"
import type { LoroDoc, Value } from "loro-crdt"
import type { Synchronizer } from "./synchronizer.js"
import type { DocContent, DocId, LoroDocMutator, ReadyState } from "./types.js"

/** Custom predicate for determining readiness */
export type ReadinessCheck = (readyStates: ReadyState[]) => boolean

type UntypedDocHandleParams = {
  docId: DocId
  synchronizer: Synchronizer
  logger?: Logger
}

/**
 * An untyped handle to a Loro document (that is always available), and
 * associated presence for ephemeral data.
 *
 * This class embraces CRDT semantics where documents are always-mergeable
 * and operations are idempotent. Instead of complex loading states, it
 * provides a flexible readiness API that allows applications to define
 * what "ready" means for their specific use case.
 *
 * For typed access, use `Repo.get()` with docShape and presenceShape parameters
 * to get a `TypedDocHandle`.
 */
export class UntypedDocHandle {
  /**
   * The document ID of the underlying LoroDoc represented by this UntypedDocHandle
   */
  public readonly docId: DocId

  /**
   * The Synchronizer whose document operations we are wrapping via this UntypedDocHandle API
   */
  private readonly synchronizer: Synchronizer

  /**
   * Presence interface for ephemeral state management.
   * Implements PresenceInterface from @loro-extended/change.
   */
  public readonly presence: PresenceInterface

  /**
   * A LogTape logger for logging
   */
  private readonly logger: Logger

  constructor({ docId, synchronizer, logger }: UntypedDocHandleParams) {
    this.docId = docId
    this.synchronizer = synchronizer
    this.synchronizer.getOrCreateDocumentState(this.docId)
    this.logger = (logger ?? getLogger(["@loro-extended", "repo"])).with({
      docId,
    })

    this.presence = this.initializePresenceInterface()

    this.logger.trace("new UntypedDocHandle")
  }

  initializePresenceInterface(): PresenceInterface {
    const docId = this.docId
    const synchronizer = this.synchronizer
    const myPeerId = this.synchronizer.identity.peerId

    return {
      set: (values: ObjectValue) => {
        synchronizer.setEphemeralValues(docId, values)
      },

      get: (key: string) => {
        return synchronizer.getEphemeralValues(docId, myPeerId)[key]
      },

      get self() {
        return synchronizer.getEphemeralValues(docId, myPeerId)
      },

      get all() {
        // Return all peers' presence data aggregated by peerId
        return synchronizer.getAllEphemeralStates(docId)
      },

      setRaw: (key: string, value: Value) => {
        // For backward compatibility, set a key directly on my store
        // This is an escape hatch for setting arbitrary keys
        return synchronizer.getMyEphemeralStore(docId).set(key, value)
      },

      subscribe: (cb: (values: ObjectValue) => void) => {
        // Call immediately with current state
        const initialValues = synchronizer.getAllEphemeralStates(docId)
        cb(initialValues)

        return synchronizer.emitter.on("ephemeral-change", event => {
          if (event.docId === docId) {
            const values = synchronizer.getAllEphemeralStates(docId)
            cb(values)
          }
        })
      },
    }
  }

  get doc(): LoroDoc {
    const docState = this.synchronizer.getOrCreateDocumentState(this.docId)

    return docState.doc
  }

  /**
   * Get the current ready states for this document.
   * This provides visibility into the sync status of the document across all channels.
   */
  get readyStates(): ReadyState[] {
    return this.synchronizer.readyStates.get(this.docId) ?? []
  }

  /**
   * Subscribe to ready state changes.
   * @param cb Callback that receives the new ready states
   * @returns Unsubscribe function
   */
  onReadyStateChange(cb: (readyStates: ReadyState[]) => void): () => void {
    return this.synchronizer.emitter.on("ready-state-changed", event => {
      if (event.docId === this.docId) {
        cb(event.readyStates)
      }
    })
  }

  /**
   * Get the peer ID of the local peer.
   */
  get peerId(): string {
    return this.synchronizer.identity.peerId
  }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // PUBLIC API - Always-available document access
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

  /**
   * The primary method for an application to mutate the document.
   * The document is always available for mutations.
   * @param mutator A function that receives the document to modify.
   */
  public change(mutator: LoroDocMutator<DocContent>): UntypedDocHandle {
    this.logger.trace("change")

    mutator(this.doc)
    this.doc.commit()
    return this // Useful for chaining
  }

  /**
   * Wait until the document meets custom readiness criteria.
   * @param predicate Function that determines if the document is ready
   * @param timeout Optional timeout in milliseconds
   */
  async waitUntilReady(predicate: ReadinessCheck): Promise<UntypedDocHandle> {
    await this.synchronizer.waitUntilReady(this.docId, predicate)
    return this
  }

  /**
   * Convenience method: wait for storage to load.
   */
  async waitForStorage(): Promise<UntypedDocHandle> {
    return this.waitUntilReady(readyStates =>
      readyStates.some(
        s => s.state === "loaded" && s.channels.some(c => c.kind === "storage"),
      ),
    )
  }

  /**
   * Convenience method: wait for any network source to provide the document.
   */
  async waitForNetwork(): Promise<UntypedDocHandle> {
    return this.waitUntilReady(readyStates => {
      return readyStates.some(
        s => s.state === "loaded" && s.channels.some(c => c.kind === "network"),
      )
    })
  }
}
