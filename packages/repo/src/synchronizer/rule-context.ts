import type { EstablishedChannel } from "../channel.js"
import { isEstablished } from "../channel.js"
import type { RuleContext } from "../rules.js"
import type { SynchronizerModel } from "../synchronizer-program.js"
import type { DocState } from "../types.js"

/**
 * Get rule context for permission checks
 */
export function getRuleContext({
  channel,
  docState,
  model,
}: {
  channel: EstablishedChannel | undefined
  docState: DocState | undefined
  model?: SynchronizerModel
}): RuleContext | Error {
  if (!channel || !isEstablished(channel)) {
    return new Error(`can't get rules context for non-established channel`)
  }

  if (!docState) {
    return new Error(`can't get rules context for undefined docState`)
  }

  // Get peer state from model if available
  const peerState = model?.peers.get(channel.peerId)
  if (!peerState) {
    return new Error(`can't get peer state for peerId ${channel.peerId}`)
  }

  return {
    peerId: peerState.identity.peerId,
    peerName: peerState.identity.name,
    peerType: peerState.identity.type,
    channelId: channel.channelId,
    doc: docState.doc,
    docId: docState.docId,
    channelKind: channel.kind,
  }
}
