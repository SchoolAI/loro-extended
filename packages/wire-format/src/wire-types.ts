/**
 * Wire message types - compact representation for network transmission.
 *
 * These types use short field names and numeric type discriminators
 * to minimize payload size over the wire.
 */

import type { PeerID } from "loro-crdt"
import type { MessageType, TransmissionType } from "./constants.js"

/**
 * Union of all wire message types.
 */
export type WireMessage =
  | WireEstablishRequest
  | WireEstablishResponse
  | WireSyncRequest
  | WireSyncResponse
  | WireUpdate
  | WireDirectoryRequest
  | WireDirectoryResponse
  | WireNewDoc
  | WireDeleteRequest
  | WireDeleteResponse
  | WireEphemeral
  | WireBatch

/**
 * Establish request (client → server handshake initiation)
 */
export type WireEstablishRequest = {
  t: typeof MessageType.EstablishRequest
  id: PeerID // identity.peerId
  n?: string // identity.name
  y: "user" | "bot" | "service" // identity.type
}

/**
 * Establish response (server → client handshake confirmation)
 */
export type WireEstablishResponse = {
  t: typeof MessageType.EstablishResponse
  id: PeerID
  n?: string
  y: "user" | "bot" | "service"
}

/**
 * Wire transmission types - document data transfer variants.
 * VersionVector is encoded as Uint8Array on the wire.
 */
export type WireTransmission =
  | { k: typeof TransmissionType.UpToDate; v: Uint8Array }
  | { k: typeof TransmissionType.Snapshot; d: Uint8Array; v: Uint8Array }
  | { k: typeof TransmissionType.Update; d: Uint8Array; v: Uint8Array }
  | { k: typeof TransmissionType.Unavailable }

/**
 * Ephemeral store data on the wire.
 */
export type WireEphemeralStore = {
  p: PeerID // peerId
  d: Uint8Array // data
  ns: string // namespace
}

/**
 * Sync request - request to synchronize a document.
 */
export type WireSyncRequest = {
  t: typeof MessageType.SyncRequest
  doc: string // docId
  v: Uint8Array // requesterDocVersion (encoded VersionVector)
  e?: WireEphemeralStore[] // ephemeral
  bi: boolean // bidirectional
}

/**
 * Sync response - response with document data.
 */
export type WireSyncResponse = {
  t: typeof MessageType.SyncResponse
  doc: string
  tx: WireTransmission // transmission
  e?: WireEphemeralStore[]
}

/**
 * Update - push document changes.
 */
export type WireUpdate = {
  t: typeof MessageType.Update
  doc: string
  tx: WireTransmission
}

/**
 * Directory request - request list of available documents.
 */
export type WireDirectoryRequest = {
  t: typeof MessageType.DirectoryRequest
  docs?: string[] // docIds filter
}

/**
 * Directory response - response with document list.
 */
export type WireDirectoryResponse = {
  t: typeof MessageType.DirectoryResponse
  docs: string[]
}

/**
 * New doc announcement - announce new document creation.
 */
export type WireNewDoc = {
  t: typeof MessageType.NewDoc
  docs: string[]
}

/**
 * Delete request - request to delete a document.
 */
export type WireDeleteRequest = {
  t: typeof MessageType.DeleteRequest
  doc: string
}

/**
 * Delete response - deletion result.
 */
export type WireDeleteResponse = {
  t: typeof MessageType.DeleteResponse
  doc: string
  s: "deleted" | "ignored" // status
}

/**
 * Ephemeral message - transient data (presence, cursors, etc.).
 */
export type WireEphemeral = {
  t: typeof MessageType.Ephemeral
  doc: string
  h: number // hopsRemaining
  st: WireEphemeralStore[] // stores
}

/**
 * Batch message - multiple messages in one frame.
 */
export type WireBatch = {
  t: typeof MessageType.Batch
  m: WireMessage[] // messages (excluding nested batches)
}
