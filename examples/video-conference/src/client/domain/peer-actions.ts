import type { PeerID } from "@loro-extended/repo"
import { shouldInitiate } from "../../shared/webrtc-protocol"

/**
 * Actions to take on the peer connection set.
 */
export type PeerActions = {
  /** Peer IDs to create new connections for */
  toCreate: PeerID[]
  /** Peer IDs to destroy existing connections for */
  toDestroy: PeerID[]
}

/**
 * Computes which peer connections to create and destroy based on the current
 * state and target participant list.
 *
 * This is a pure function that implements the peer lifecycle decision logic:
 *
 * 1. **Create** a peer when:
 *    - They're in the target set but not currently connected
 *    - We are the initiator (our peerId < their peerId)
 *    - We have a local media stream ready
 *
 * 2. **Destroy** a peer when:
 *    - They're no longer in the target set
 *    - They were NOT created from incoming signals (signal-created peers
 *      manage their own lifecycle)
 *
 * ## Why initiator-only creation?
 *
 * WebRTC requires exactly one side to create an offer. We use deterministic
 * ordering (smaller peerId initiates) to avoid "glare" where both sides
 * try to initiate simultaneously.
 *
 * ## Why not destroy signal-created peers?
 *
 * When we receive a signal (offer) from a remote peer, we create a peer to
 * handle it. These peers shouldn't be destroyed just because the participant
 * list changes—the remote peer controls their lifecycle.
 *
 * @param currentPeers - Set of peer IDs we currently have connections for
 * @param targetPeers - Set of peer IDs we should be connected to (excluding self)
 * @param signalCreatedPeers - Set of peer IDs created from incoming signals
 * @param myPeerId - Our own peer ID
 * @param hasLocalStream - Whether we have a local media stream ready
 * @returns Actions to take: which peers to create and destroy
 */
export function computePeerActions(
  currentPeers: ReadonlySet<PeerID>,
  targetPeers: ReadonlySet<PeerID>,
  signalCreatedPeers: ReadonlySet<PeerID>,
  myPeerId: PeerID,
  hasLocalStream: boolean,
): PeerActions {
  const toCreate: PeerID[] = []
  const toDestroy: PeerID[] = []

  // Find peers to create: in target but not current, we're initiator, and we have stream
  for (const peerId of targetPeers) {
    if (peerId === myPeerId) continue // Skip self
    if (currentPeers.has(peerId)) continue // Already connected

    const weAreInitiator = shouldInitiate(myPeerId, peerId)
    if (weAreInitiator && hasLocalStream) {
      toCreate.push(peerId)
    }
  }

  // Find peers to destroy: in current but not target, and not signal-created
  for (const peerId of currentPeers) {
    if (targetPeers.has(peerId)) continue // Still in target
    if (signalCreatedPeers.has(peerId)) continue // Signal-created, don't destroy

    toDestroy.push(peerId)
  }

  return { toCreate, toDestroy }
}
