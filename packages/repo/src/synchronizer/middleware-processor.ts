import type { Logger } from "@logtape/logtape"
import type { PeerID } from "loro-crdt"
import type { BatchableMsg, Channel, ChannelMsg } from "../channel.js"
import { isEstablished } from "../channel.js"
import type { Middleware, MiddlewareContext, MiddlewareResult } from "../middleware.js"
import { runMiddleware } from "../middleware.js"
import type { DocContext, PeerContext } from "../permissions.js"
import type { ChannelId, DocId, DocState, PeerState } from "../types.js"

/**
 * Read-only accessor for model data needed by middleware.
 * This provides a clean interface without exposing the full model.
 */
export type ModelAccessor = {
  readonly channels: ReadonlyMap<ChannelId, Channel>
  readonly peers: ReadonlyMap<PeerID, PeerState>
  readonly documents: ReadonlyMap<DocId, DocState>
}

/**
 * Result of processing a message through middleware.
 */
export type ProcessResult =
  | { type: "allowed"; message: ChannelMsg }
  | { type: "allowed-batch"; messages: BatchableMsg[] }
  | { type: "rejected" }
  | { type: "no-middleware" }

/**
 * MiddlewareProcessor - Handles middleware execution for incoming messages
 *
 * Encapsulates the logic for:
 * - Building peer context from channels
 * - Extracting document and transmission context from messages
 * - Running middleware on single messages and batches
 *
 * @example
 * ```typescript
 * const processor = new MiddlewareProcessor(middleware, contextProvider, logger)
 *
 * // Process a single message
 * const result = await processor.processMessage(channelId, message)
 * if (result.type === 'allowed') {
 *   dispatch(result.message)
 * }
 *
 * // Process a batch
 * const batchResult = await processor.processBatch(channelId, messages)
 * ```
 */
export class MiddlewareProcessor {
  readonly #middleware: Middleware[]
  readonly #getModel: () => ModelAccessor
  readonly #logger: Logger

  constructor(
    middleware: Middleware[],
    getModel: () => ModelAccessor,
    logger: Logger,
  ) {
    this.#middleware = middleware
    this.#getModel = getModel
    this.#logger = logger
  }

  /**
   * Check if middleware is configured.
   */
  get hasMiddleware(): boolean {
    return this.#middleware.length > 0
  }

  /**
   * Get the number of middleware configured.
   */
  get count(): number {
    return this.#middleware.length
  }

  /**
   * Process a single message through middleware.
   *
   * @param channelId - The channel the message came from
   * @param message - The message to process
   * @returns Processing result
   */
  async processMessage(
    channelId: ChannelId,
    message: ChannelMsg,
  ): Promise<ProcessResult> {
    if (!this.hasMiddleware) {
      return { type: "no-middleware" }
    }

    const model = this.#getModel()
    const channel = model.channels.get(channelId)
    if (!channel) {
      return { type: "no-middleware" }
    }

    const peerContext = this.#buildPeerContextFromChannel(model, channel)
    if (!peerContext) {
      return { type: "no-middleware" }
    }

    const middlewareCtx = this.#buildMiddlewareContext(model, message, peerContext)
    const result = await runMiddleware(this.#middleware, middlewareCtx, this.#logger)

    if (result.allow) {
      return { type: "allowed", message }
    }
    return { type: "rejected" }
  }

  /**
   * Process a batch of messages through middleware.
   * Each message is checked individually; only allowed messages are returned.
   *
   * @param channelId - The channel the messages came from
   * @param messages - The messages to process
   * @returns Processing result with allowed messages
   */
  async processBatch(
    channelId: ChannelId,
    messages: BatchableMsg[],
  ): Promise<ProcessResult> {
    if (!this.hasMiddleware) {
      return { type: "no-middleware" }
    }

    const model = this.#getModel()
    const channel = model.channels.get(channelId)
    if (!channel) {
      return { type: "no-middleware" }
    }

    const peerContext = this.#buildPeerContextFromChannel(model, channel)
    if (!peerContext) {
      return { type: "no-middleware" }
    }

    // Process each message through middleware
    const results = await Promise.all(
      messages.map(async msg => {
        const middlewareCtx = this.#buildMiddlewareContext(model, msg, peerContext)
        const result = await runMiddleware(this.#middleware, middlewareCtx, this.#logger)
        return { msg, allowed: result.allow }
      }),
    )

    const allowedMessages = results.filter(r => r.allowed).map(r => r.msg)

    if (allowedMessages.length === 0) {
      return { type: "rejected" }
    }

    if (allowedMessages.length === 1) {
      return { type: "allowed", message: allowedMessages[0] }
    }

    return { type: "allowed-batch", messages: allowedMessages }
  }

  /**
   * Build peer context from a channel for middleware.
   * Returns undefined if channel is not established or peer state not found.
   */
  #buildPeerContextFromChannel(model: ModelAccessor, channel: Channel): PeerContext | undefined {
    if (!isEstablished(channel)) {
      return undefined
    }

    const peerState = model.peers.get(channel.peerId)
    if (!peerState) {
      return undefined
    }

    return {
      peerId: peerState.identity.peerId,
      peerName: peerState.identity.name,
      peerType: peerState.identity.type,
      channelId: channel.channelId,
      channelKind: channel.kind,
    }
  }

  /**
   * Build the full middleware context for a message.
   */
  #buildMiddlewareContext(
    model: ModelAccessor,
    message: ChannelMsg,
    peerContext: PeerContext,
  ): MiddlewareContext {
    const { docId, transmission } = this.#extractContextFromMessage(message)

    let docContext: DocContext | undefined
    if (docId) {
      const doc = model.documents.get(docId)
      if (doc) {
        docContext = { id: docId, doc: doc.doc }
      }
    }

    return {
      message,
      peer: peerContext,
      document: docContext,
      transmission,
    }
  }

  /**
   * Extract document and transmission context from a channel message.
   * Used to provide full context to middleware.
   */
  #extractContextFromMessage(message: ChannelMsg): {
    docId?: DocId
    transmission?: { type: "snapshot" | "update"; sizeBytes: number }
  } {
    // Handle messages with docId field
    if ("docId" in message && typeof message.docId === "string") {
      const docId = message.docId as DocId

      // Handle sync-response and update messages with transmission data
      if (
        (message.type === "channel/sync-response" ||
          message.type === "channel/update") &&
        "transmission" in message
      ) {
        const t = message.transmission
        if (
          (t.type === "snapshot" || t.type === "update") &&
          "data" in t &&
          t.data instanceof Uint8Array
        ) {
          return {
            docId,
            transmission: { type: t.type, sizeBytes: t.data.length },
          }
        }
      }

      return { docId }
    }

    // Handle sync-request (has docs array, not single docId)
    // For middleware, we don't provide document context for multi-doc messages
    // Middleware can inspect message.docs directly if needed

    return {}
  }
}
