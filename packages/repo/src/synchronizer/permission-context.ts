import type { EstablishedChannel } from "../channel.js"
import { isEstablished } from "../channel.js"
import type { DocContext, PeerContext } from "../permissions.js"
import type { SynchronizerModel } from "../synchronizer-program.js"
import type { DocState } from "../types.js"

/**
 * Result of getting permission context.
 * Contains both DocContext and PeerContext for permission checks.
 */
export type PermissionContext = {
  doc: DocContext
  peer: PeerContext
}

/**
 * Get permission context for permission checks.
 *
 * @returns PermissionContext if successful, Error if context cannot be built
 */
export function getPermissionContext({
  channel,
  docState,
  model,
}: {
  channel: EstablishedChannel | undefined
  docState: DocState | undefined
  model?: SynchronizerModel
}): PermissionContext | Error {
  if (!channel || !isEstablished(channel)) {
    return new Error("can't get permission context for non-established channel")
  }

  if (!docState) {
    return new Error("can't get permission context for undefined docState")
  }

  // Get peer state from model if available
  const peerState = model?.peers.get(channel.peerId)
  if (!peerState) {
    return new Error(`can't get peer state for peerId ${channel.peerId}`)
  }

  return {
    doc: {
      id: docState.docId,
      doc: docState.doc,
    },
    peer: {
      peerId: peerState.identity.peerId,
      peerName: peerState.identity.name,
      peerType: peerState.identity.type,
      channelId: channel.channelId,
      channelKind: channel.kind,
    },
  }
}

/**
 * Get peer context only (for creation checks where doc doesn't exist yet).
 *
 * @returns PeerContext if successful, Error if context cannot be built
 */
export function getPeerContext({
  channel,
  model,
}: {
  channel: EstablishedChannel | undefined
  model?: SynchronizerModel
}): PeerContext | Error {
  if (!channel || !isEstablished(channel)) {
    return new Error("can't get peer context for non-established channel")
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
    channelKind: channel.kind,
  }
}
