/**
 * Wire format constants for loro-extended network protocol.
 *
 * Version 2 introduces:
 * - 6-byte header (up from 4 bytes)
 * - Uint32 payload length (up from Uint16, fixes 64KB limit)
 */

/** Current wire protocol version */
export const WIRE_VERSION = 2

/** Header size in bytes (version 2) */
export const HEADER_SIZE = 6

/** Wire format flags */
export const WireFlags = {
  NONE: 0x00,
  BATCH: 0x01, // Payload is array of messages
  COMPRESSED: 0x02, // Reserved for future compression support
} as const

/** Message type discriminators */
export const MessageType = {
  EstablishRequest: 0x01,
  EstablishResponse: 0x02,
  SyncRequest: 0x10,
  SyncResponse: 0x11,
  Update: 0x12,
  DirectoryRequest: 0x20,
  DirectoryResponse: 0x21,
  NewDoc: 0x22,
  DeleteRequest: 0x30,
  DeleteResponse: 0x31,
  Ephemeral: 0x40,
  Batch: 0x50,
} as const

/** Transmission type discriminators */
export const TransmissionType = {
  UpToDate: 0x00,
  Snapshot: 0x01,
  Update: 0x02,
  Unavailable: 0x03,
} as const
