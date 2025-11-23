import { getLogger, type Logger } from "@logtape/logtape"
import type { LoroDoc } from "loro-crdt"
import type { Synchronizer } from "./synchronizer.js"
import type { DocContent, DocId, LoroDocMutator, ReadyState } from "./types.js"

/** Custom predicate for determining readiness */
export type ReadinessCheck = (readyStates: ReadyState[]) => boolean

type DocHandleParams = {
  docId: DocId
  synchronizer: Synchronizer
  logger?: Logger
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
export class DocHandle<T extends DocContent = DocContent> {
  private readonly synchronizer: Synchronizer
  public readonly docId: DocId
  private readonly logger: Logger

  constructor({ docId, synchronizer, logger }: DocHandleParams) {
    this.docId = docId
    this.synchronizer = synchronizer
    this.synchronizer.getOrCreateDocumentState(this.docId)
    this.logger = (logger ?? getLogger(["@loro-extended", "repo"])).with({
      docId,
    })

    // Initialize ephemeral handle
    // We capture 'this' as 'docHandle' to avoid 'this' context issues in getters
    // biome-ignore lint/style/noNonNullAssertion: initialized in constructor
    const docHandle = this
    this.ephemeral = {
      set: (key: string, value: any) => {
        const myPeerId = docHandle.synchronizer.identity.peerId
        const store = docHandle.synchronizer.getEphemeral(docHandle.docId)
        const currentSelfState = store[myPeerId] || {}
        const newSelfState = { ...currentSelfState, [key]: value }
        docHandle.synchronizer.setEphemeral(
          docHandle.docId,
          myPeerId,
          newSelfState,
        )
      },

      get: (key: string) => {
        const myPeerId = docHandle.synchronizer.identity.peerId
        const store = docHandle.synchronizer.getEphemeral(docHandle.docId)
        return store[myPeerId]?.[key]
      },

      get self() {
        const myPeerId = docHandle.synchronizer.identity.peerId
        return (
          docHandle.synchronizer.getEphemeral(docHandle.docId)[myPeerId] || {}
        )
      },

      get all() {
        return docHandle.synchronizer.getEphemeral(docHandle.docId)
      },

      setRaw: (key: string, value: any) => {
        docHandle.synchronizer.setEphemeral(docHandle.docId, key, value)
      },

      subscribe: (cb: () => void) => {
        return docHandle.synchronizer.emitter.on("ephemeral-change", event => {
          if (event.docId === docHandle.docId) {
            cb()
          }
        })
      },
    }

    this.logger.trace("new DocHandle")
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
   * Get the peer ID of the local peer.
   */
  get peerId(): string {
    return this.synchronizer.identity.peerId
  }

  /**
   * Ephemeral state management for presence, cursors, and other transient data.
   */
  public readonly ephemeral: {
    set: (key: string, value: any) => void
    get: (key: string) => any
    readonly self: any
    readonly all: any
    setRaw: (key: string, value: any) => void
    subscribe: (cb: () => void) => () => void
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
   * Actively requests the latest version of the document from all
   * connected peers and storage. This is useful when you want to
   * ensure you have the most up-to-date version of a document.
   */
  // public sync(): DocHandle<T> {
  //   this.synchronizer.sync(this.docId)
  //   return this // Useful for chaining
  // }

  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=
  // FLEXIBLE READINESS API
  // =-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=

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
        s => s.channelMeta.kind === "storage" && s.loading.state === "found",
      ),
    )
  }

  /**
   * Convenience method: wait for any network source to provide the document.
   */
  async waitForNetwork(): Promise<DocHandle<T>> {
    return this.waitUntilReady(readyStates => {
      this.logger.info("wait-for-network", { readyStates })
      return readyStates.some(
        s => s.channelMeta.kind === "network" && s.loading.state === "found",
      )
    })
  }
}
