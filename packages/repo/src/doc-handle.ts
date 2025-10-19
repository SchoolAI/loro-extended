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

    this.logger.trace("new DocHandle")
  }

  get doc(): LoroDoc<T> {
    const docState = this.synchronizer.getOrCreateDocumentState(this.docId)

    return docState.doc as LoroDoc<T>
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
