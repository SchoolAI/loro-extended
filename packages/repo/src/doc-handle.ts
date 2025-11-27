import { getLogger, type Logger } from "@logtape/logtape"
import type { LoroDoc, Value } from "loro-crdt"
import type { ObjectValue, Synchronizer } from "./synchronizer.js"
import type { DocContent, DocId, LoroDocMutator, ReadyState } from "./types.js"

/** Custom predicate for determining readiness */
export type ReadinessCheck = (readyStates: ReadyState[]) => boolean

type DocHandleParams = {
  docId: DocId
  synchronizer: Synchronizer
  logger?: Logger
}

type PresenceInterface = {
  set: (values: ObjectValue) => void
  get: (key: string) => Value
  readonly self: ObjectValue
  readonly all: ObjectValue
  setRaw: (key: string, value: Value) => void
  subscribe: (cb: (values: ObjectValue) => void) => () => void
}

/**
 * A simplified handle to a Loro document (that is always available), and
 * associated presence for ephemeral data.
 *
 * This class embraces CRDT semantics where documents are always-mergeable
 * and operations are idempotent. Instead of complex loading states, it
 * provides a flexible readiness API that allows applications to define
 * what "ready" means for their specific use case.
 *
 * @typeParam T - The plain JavaScript object schema for the document.
 */
export class DocHandle<T extends DocContent = DocContent> {
  /**
   * The document ID of the underlying LoroDoc represented by this DocHandle
   */
  public readonly docId: DocId

  /**
   * The Synchronizer whose document operations we are wrapping via this DocHandle API
   */
  private readonly synchronizer: Synchronizer

  /**
   * Ephemeral state management for presence, cursors, and other transient data.
   */
  public readonly presence: PresenceInterface

  /**
   * A LogTape logger for logging
   */
  private readonly logger: Logger

  constructor({ docId, synchronizer, logger }: DocHandleParams) {
    this.docId = docId
    this.synchronizer = synchronizer
    this.synchronizer.getOrCreateDocumentState(this.docId)
    this.logger = (logger ?? getLogger(["@loro-extended", "repo"])).with({
      docId,
    })

    this.presence = this.initializePresenceInterface()

    this.logger.trace("new DocHandle")
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
        return synchronizer.getOrCreateEphemeralStore(docId).getAllStates()
      },

      setRaw: (key: string, value: Value) => {
        return synchronizer.getOrCreateEphemeralStore(docId).set(key, value)
      },

      subscribe: (cb: (values: ObjectValue) => void) => {
        // Call immediately with current state
        const initialValues = synchronizer
          .getOrCreateEphemeralStore(docId)
          .getAllStates()
        cb(initialValues)

        return synchronizer.emitter.on("ephemeral-change", event => {
          if (event.docId === docId) {
            const values = synchronizer
              .getOrCreateEphemeralStore(docId)
              .getAllStates()
            cb(values)
          }
        })
      },
    }
  }

  get doc(): LoroDoc<T> {
    const docState = this.synchronizer.getOrCreateDocumentState(this.docId)

    return docState.doc as LoroDoc<T>
  }

  /**
   * Get the current ready states for this document.
   * This provides visibility into the sync status of the document across all channels.
   */
  get readyStates(): ReadyState[] {
    return this.synchronizer.getReadyStates(this.docId)
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
  public change(mutator: LoroDocMutator<T>): DocHandle<T> {
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
  async waitUntilReady(predicate: ReadinessCheck): Promise<DocHandle<T>> {
    await this.synchronizer.waitUntilReady(this.docId, predicate)
    return this
  }

  /**
   * Convenience method: wait for storage to load.
   */
  async waitForStorage(): Promise<DocHandle<T>> {
    return this.waitUntilReady(readyStates =>
      readyStates.some(
        s => s.state === "loaded" && s.channels.some(c => c.kind === "storage"),
      ),
    )
  }

  /**
   * Convenience method: wait for any network source to provide the document.
   */
  async waitForNetwork(): Promise<DocHandle<T>> {
    return this.waitUntilReady(readyStates => {
      return readyStates.some(
        s => s.state === "loaded" && s.channels.some(c => c.kind === "network"),
      )
    })
  }
}
