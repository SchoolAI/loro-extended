/**
 * Constants for the Loro Syncing Protocol.
 */

/**
 * Magic bytes identifying the CRDT type.
 * These are the first 4 bytes of every protocol message.
 */
export const MAGIC_BYTES = {
  /** Loro Document - for persistent document data */
  loro: new Uint8Array([0x25, 0x4c, 0x4f, 0x52]), // "%LOR"
  /** Ephemeral Store - for transient presence/cursor data */
  ephemeral: new Uint8Array([0x25, 0x45, 0x50, 0x48]), // "%EPH"
  /** Persisted Ephemeral - for ephemeral data that should be persisted */
  ephemeralPersisted: new Uint8Array([0x25, 0x45, 0x50, 0x53]), // "%EPS"
} as const

/**
 * Magic byte strings for comparison.
 */
export const MAGIC_STRINGS = {
  loro: "%LOR",
  ephemeral: "%EPH",
  ephemeralPersisted: "%EPS",
} as const

/**
 * Message type codes.
 */
export const MESSAGE_TYPE = {
  JoinRequest: 0x00,
  JoinResponseOk: 0x01,
  JoinError: 0x02,
  DocUpdate: 0x03,
  UpdateError: 0x06,
  Leave: 0x07,
} as const

/**
 * Join error codes.
 */
export const JOIN_ERROR_CODE = {
  /** Unknown error */
  Unknown: 0x00,
  /** Server doesn't recognize the client's version */
  VersionUnknown: 0x01,
  /** Authentication failed */
  AuthFailed: 0x02,
  /** Application-specific error */
  AppError: 0x7f,
} as const

/**
 * Update error codes.
 */
export const UPDATE_ERROR_CODE = {
  /** Unknown error */
  Unknown: 0x00,
  /** Permission denied */
  PermissionDenied: 0x03,
  /** Invalid update data */
  InvalidUpdate: 0x04,
  /** Payload too large */
  PayloadTooLarge: 0x05,
  /** Rate limited */
  RateLimited: 0x06,
  /** Application-specific error */
  AppError: 0x7f,
} as const

/**
 * Permission levels for room access.
 */
export const PERMISSION = {
  Read: 0x00,
  Write: 0x01,
} as const

/**
 * Text encoder/decoder for string operations.
 */
export const textEncoder = new TextEncoder()
export const textDecoder = new TextDecoder()