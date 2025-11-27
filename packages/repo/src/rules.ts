import type { LoroDoc } from "loro-crdt"
import type { ChannelKind } from "./channel.js"
import type { ChannelId, DocId } from "./types.js"

export type RuleContext = {
  doc: LoroDoc
  docId: DocId
  peerName: string
  channelId: ChannelId
  channelKind: ChannelKind // "storage" | "network" | "other"
}

/**
 * Example: Storage always gets updates, network peers only for public docs
 *
 * ```typescript
 * const rules = {
 *   canReveal: (context) => {
 *     if (context.channelKind === "storage") {
 *       return true  // Storage always receives updates for persistence
 *     }
 *     return context.docId.startsWith("public-")  // Network peers only for public docs
 *   }
 * }
 * ```
 */
export interface Rules {
  /**
   * @returns `true` if we should send a sync request immediately upon channel establishment
   */
  canBeginSync(context: RuleContext): boolean

  /**
   * Determines if this repo can share the existence of a document with a remote
   * peer. This is called when we first connect to a peer, and any time a new
   * document is created. If this returns false, the remote peer will not be
   * told about the document.
   *
   * NOTE: If the remote peer already knows about the document, this has no effect.
   *
   * @returns `true` if listing the document is permitted, `false` otherwise.
   */
  canReveal(context: RuleContext): boolean

  /**
   * Determines if we should accept a sync message from a remote peer for a
   * given document. This is called every time we receive a sync message. If
   * this returns false, the sync message will be ignored.
   *
   * @returns `true` if writing is permitted, `false` otherwise.
   */
  canUpdate(context: RuleContext): boolean

  /**
   * Determines if a peer is allowed to delete a document.
   *
   * @returns `true` if deletion is permitted, `false` otherwise.
   */
  canDelete(context: RuleContext): boolean

  /**
   * Determines if a peer is allowed to create a new document.
   * This is called when a peer requests a document that doesn't exist locally.
   *
   * @returns `true` if creation is permitted, `false` otherwise.
   */
  canCreate(context: Omit<RuleContext, "doc">): boolean
}

// Default rule is to "allow" everything
const defaultAllowed = () => true

export function createRules(rules: Partial<Rules> = {}): Rules {
  return {
    canBeginSync: rules?.canBeginSync ?? defaultAllowed,
    canReveal: rules?.canReveal ?? defaultAllowed,
    canUpdate: rules?.canUpdate ?? defaultAllowed,
    canDelete: rules?.canDelete ?? defaultAllowed,
    canCreate: rules?.canCreate ?? defaultAllowed,
  }
}
