import type { LoroDoc } from "loro-crdt"
import type { ChannelId, DocChannelState, DocId } from "./types.js"

export type RuleContext = {
  doc: LoroDoc
  docId: DocId
  docChannelState: DocChannelState
  peerName: string
  channelId: ChannelId
}

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
   * @returns `true` if listing the document is permitted, `false` otherwise.
   */
  canList(context: RuleContext): boolean

  /**
   * Determines if we should accept a sync message from a remote peer for a
   * given document. This is called every time we receive a sync message. If
   * this returns false, the sync message will be ignored.
   *
   * @returns `true` if writing is permitted, `false` otherwise.
   */
  canWrite(context: RuleContext): boolean

  /**
   * Determines if a peer is allowed to delete a document.
   *
   * @returns `true` if deletion is permitted, `false` otherwise.
   */
  canDelete(context: RuleContext): boolean
}

const defaultPermission = () => true

export function createPermissions(
  permissions: Partial<Rules> = {},
): Rules {
  return {
    canBeginSync: permissions?.canBeginSync ?? defaultPermission,
    canList: permissions?.canList ?? defaultPermission,
    canWrite: permissions?.canWrite ?? defaultPermission,
    canDelete: permissions?.canDelete ?? defaultPermission,
  }
}
