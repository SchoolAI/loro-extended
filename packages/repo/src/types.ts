import {
  type Container,
  LoroDoc,
  type PeerID,
  type VersionVector,
} from "loro-crdt"
import type { ChannelMeta } from "./channel.js"

export type { PeerID } from "loro-crdt"

export type DocId = string
export type ChannelId = number
export type AdapterType = string
export type DocContent = Record<string, Container>

export type LoroDocMutator<T extends DocContent> = (doc: LoroDoc<T>) => void

export type PeerIdentityDetails = {
  peerId: PeerID // Globally unique, stable identifier (not generated per-connection)
  name?: string // Optional - peer can give itself a name; this is not unique
  type: "user" | "bot" | "service"
  // publicKey?: Uint8Array // Future: For cryptographic identity
}

export type ReadyStateChannelMeta = ChannelMeta & {
  state: "established" | "connected"
}

type ReadyStateBase = {
  docId: DocId
  identity: PeerIdentityDetails
}

type ReadyStateAware = ReadyStateBase & {
  state: "aware"
  channels: ReadyStateChannelMeta[]
}

type ReadyStateLoaded = ReadyStateBase & {
  state: "loaded"
  channels: ReadyStateChannelMeta[]
}

type ReadyStateAbsent = ReadyStateBase & {
  state: "absent"
}

export type ReadyState = ReadyStateAware | ReadyStateLoaded | ReadyStateAbsent

/**
 * Discriminated union for peer document awareness.
 * - "unknown": We don't know if the peer has this document
 * - "no-doc": Peer explicitly doesn't have this document
 * - "has-doc-unknown-version": Peer has this document but we don't know their version yet
 *   (e.g., they announced via new-doc but we haven't synced yet)
 * - "has-doc": Peer has this document with a known version
 */
export type PeerDocumentAwareness =
  | { awareness: "unknown"; lastUpdated: Date }
  | { awareness: "no-doc"; lastUpdated: Date }
  | { awareness: "has-doc-unknown-version"; lastUpdated: Date }
  | { awareness: "has-doc"; lastKnownVersion: VersionVector; lastUpdated: Date }

export type PeerState = {
  identity: PeerIdentityDetails
  documentAwareness: Map<DocId, PeerDocumentAwareness>
  subscriptions: Set<DocId>
  lastSeen: Date
  channels: Set<ChannelId>
}

export type DocState = {
  doc: LoroDoc
  docId: DocId
}

export function createDocState({ docId }: { docId: DocId }): DocState {
  return {
    doc: new LoroDoc(),
    docId,
  }
}
