import { type Container, LoroDoc, type VersionVector } from "loro-crdt"
import type { ChannelMeta } from "./channel.js"

export type DocId = string
export type ChannelId = number
export type PeerId = string
export type AdapterId = string
export type DocContent = Record<string, Container>

export type LoroDocMutator<T extends DocContent> = (doc: LoroDoc<T>) => void

export type PeerIdentityDetails = {
  name: string // peer can give itself a name; this is not unique
  // uuid: string // globally unique
  // publicKey: Uint8Array // TODO: let's use public key signing
}

export type LoadingState =
  | { state: "initial" }
  | { state: "requesting" }
  | { state: "found"; version: VersionVector }
  | { state: "not-found" }
  | { state: "error"; error: Error }

export type ReadyState = {
  channelMeta: ChannelMeta
  loading: LoadingState
}

export type AwarenessState = "unknown" | "has-doc" | "no-doc"

export type DocState = {
  doc: LoroDoc
  docId: DocId
  channelState: Map<ChannelId, DocChannelState>
}

export function createDocState({ docId }: { docId: DocId }): DocState {
  return {
    doc: new LoroDoc(),
    docId,
    channelState: new Map(),
  }
}

/**
 * DocChannelState is like a join table--it holds state specific to document-channel pairs.
 *
 * Why is `awareness` separate from `loading`?
 * - we track `loading` state when:
 *   - THIS repo makes a sync request related to a docId through the channel to the other repo
 * - we track `awareness` state when:
 *   - THIS repo OR the OTHER repo makes any request related to a docId through the channel
 *
 * This distinction allows us to retain clarity around the circumstances in which a
 * docId and a channelId are related, and current state. For example, `awareness` is useful
 * to determine if the other repo is aware of a docId by any means--whether we revealed it
 * to the other repo, or it revealed it knows about the docId to us. This helps us to not
 * leak information that we shouldn't, such as when a repo requests a directory listing of
 * our docIds, but our permission manager forbids revealing certain docIds.
 *
 */
export type DocChannelState = {
  awareness: AwarenessState
  loading: LoadingState
}

export function createDocChannelState(
  status: Partial<DocChannelState> = {},
): DocChannelState {
  return {
    awareness: "unknown",
    loading: { state: "initial" },
    ...status,
  }
}
