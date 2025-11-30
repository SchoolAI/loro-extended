/**
 * Tests for the Loro Syncing Protocol encoding/decoding.
 */

import { describe, expect, it } from "vitest"
import {
  decodeMessage,
  encodeMessage,
  MESSAGE_TYPE,
} from "../protocol/index.js"
import type {
  DocUpdate,
  JoinError,
  JoinRequest,
  JoinResponseOk,
  Leave,
  UpdateError,
} from "../protocol/types.js"
import { JOIN_ERROR_CODE, UPDATE_ERROR_CODE } from "../protocol/constants.js"
import { decodeULEB128, encodeULEB128, uleb128Size } from "../protocol/leb128.js"

describe("LEB128 encoding", () => {
  it("encodes small numbers", () => {
    expect(encodeULEB128(0)).toEqual(new Uint8Array([0x00]))
    expect(encodeULEB128(1)).toEqual(new Uint8Array([0x01]))
    expect(encodeULEB128(127)).toEqual(new Uint8Array([0x7f]))
  })

  it("encodes numbers requiring multiple bytes", () => {
    expect(encodeULEB128(128)).toEqual(new Uint8Array([0x80, 0x01]))
    expect(encodeULEB128(255)).toEqual(new Uint8Array([0xff, 0x01]))
    expect(encodeULEB128(300)).toEqual(new Uint8Array([0xac, 0x02]))
    expect(encodeULEB128(16384)).toEqual(new Uint8Array([0x80, 0x80, 0x01]))
  })

  it("decodes small numbers", () => {
    expect(decodeULEB128(new Uint8Array([0x00]), 0)).toEqual([0, 1])
    expect(decodeULEB128(new Uint8Array([0x01]), 0)).toEqual([1, 1])
    expect(decodeULEB128(new Uint8Array([0x7f]), 0)).toEqual([127, 1])
  })

  it("decodes numbers requiring multiple bytes", () => {
    expect(decodeULEB128(new Uint8Array([0x80, 0x01]), 0)).toEqual([128, 2])
    expect(decodeULEB128(new Uint8Array([0xff, 0x01]), 0)).toEqual([255, 2])
    expect(decodeULEB128(new Uint8Array([0xac, 0x02]), 0)).toEqual([300, 2])
    expect(decodeULEB128(new Uint8Array([0x80, 0x80, 0x01]), 0)).toEqual([16384, 3])
  })

  it("decodes from offset", () => {
    const data = new Uint8Array([0x00, 0x00, 0xac, 0x02, 0x00])
    expect(decodeULEB128(data, 2)).toEqual([300, 4])
  })

  it("calculates correct size", () => {
    expect(uleb128Size(0)).toBe(1)
    expect(uleb128Size(127)).toBe(1)
    expect(uleb128Size(128)).toBe(2)
    expect(uleb128Size(16383)).toBe(2)
    expect(uleb128Size(16384)).toBe(3)
  })

  it("roundtrips correctly", () => {
    const values = [0, 1, 127, 128, 255, 300, 16383, 16384, 1000000]
    for (const value of values) {
      const encoded = encodeULEB128(value)
      const [decoded] = decodeULEB128(encoded, 0)
      expect(decoded).toBe(value)
    }
  })
})

describe("JoinRequest encoding/decoding", () => {
  it("encodes and decodes a basic JoinRequest", () => {
    const msg: JoinRequest = {
      type: MESSAGE_TYPE.JoinRequest,
      crdtType: "loro",
      roomId: "test-room",
      authPayload: new Uint8Array([1, 2, 3]),
      requesterVersion: new Uint8Array([4, 5, 6, 7]),
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })

  it("handles empty auth payload", () => {
    const msg: JoinRequest = {
      type: MESSAGE_TYPE.JoinRequest,
      crdtType: "loro",
      roomId: "room",
      authPayload: new Uint8Array(0),
      requesterVersion: new Uint8Array([1]),
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })

  it("handles ephemeral CRDT type", () => {
    const msg: JoinRequest = {
      type: MESSAGE_TYPE.JoinRequest,
      crdtType: "ephemeral",
      roomId: "presence-room",
      authPayload: new Uint8Array(0),
      requesterVersion: new Uint8Array(0),
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })

  it("handles unicode room IDs", () => {
    const msg: JoinRequest = {
      type: MESSAGE_TYPE.JoinRequest,
      crdtType: "loro",
      roomId: "房间-🚀-test",
      authPayload: new Uint8Array(0),
      requesterVersion: new Uint8Array(0),
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })
})

describe("JoinResponseOk encoding/decoding", () => {
  it("encodes and decodes with read permission", () => {
    const msg: JoinResponseOk = {
      type: MESSAGE_TYPE.JoinResponseOk,
      crdtType: "loro",
      roomId: "test-room",
      permission: "read",
      receiverVersion: new Uint8Array([1, 2, 3]),
      metadata: new Uint8Array([4, 5]),
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })

  it("encodes and decodes with write permission", () => {
    const msg: JoinResponseOk = {
      type: MESSAGE_TYPE.JoinResponseOk,
      crdtType: "loro",
      roomId: "test-room",
      permission: "write",
      receiverVersion: new Uint8Array([1, 2, 3]),
      metadata: new Uint8Array(0),
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })
})

describe("JoinError encoding/decoding", () => {
  it("encodes and decodes unknown error", () => {
    const msg: JoinError = {
      type: MESSAGE_TYPE.JoinError,
      crdtType: "loro",
      roomId: "test-room",
      code: JOIN_ERROR_CODE.Unknown,
      message: "Something went wrong",
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })

  it("encodes and decodes auth failed error", () => {
    const msg: JoinError = {
      type: MESSAGE_TYPE.JoinError,
      crdtType: "loro",
      roomId: "test-room",
      code: JOIN_ERROR_CODE.AuthFailed,
      message: "Invalid token",
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })

  it("encodes and decodes version unknown error with receiver version", () => {
    const msg: JoinError = {
      type: MESSAGE_TYPE.JoinError,
      crdtType: "loro",
      roomId: "test-room",
      code: JOIN_ERROR_CODE.VersionUnknown,
      message: "Version not recognized",
      receiverVersion: new Uint8Array([1, 2, 3, 4]),
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })

  it("encodes and decodes app error with app code", () => {
    const msg: JoinError = {
      type: MESSAGE_TYPE.JoinError,
      crdtType: "loro",
      roomId: "test-room",
      code: JOIN_ERROR_CODE.AppError,
      message: "Custom error",
      appCode: 42,
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })
})

describe("DocUpdate encoding/decoding", () => {
  it("encodes and decodes single update", () => {
    const msg: DocUpdate = {
      type: MESSAGE_TYPE.DocUpdate,
      crdtType: "loro",
      roomId: "test-room",
      updates: [new Uint8Array([1, 2, 3, 4, 5])],
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })

  it("encodes and decodes multiple updates", () => {
    const msg: DocUpdate = {
      type: MESSAGE_TYPE.DocUpdate,
      crdtType: "loro",
      roomId: "test-room",
      updates: [
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6, 7]),
        new Uint8Array([8]),
      ],
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })

  it("encodes and decodes empty updates array", () => {
    const msg: DocUpdate = {
      type: MESSAGE_TYPE.DocUpdate,
      crdtType: "loro",
      roomId: "test-room",
      updates: [],
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })

  it("handles ephemeral updates", () => {
    const msg: DocUpdate = {
      type: MESSAGE_TYPE.DocUpdate,
      crdtType: "ephemeral",
      roomId: "presence-room",
      updates: [new Uint8Array([1, 2, 3])],
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })
})

describe("UpdateError encoding/decoding", () => {
  it("encodes and decodes permission denied error", () => {
    const msg: UpdateError = {
      type: MESSAGE_TYPE.UpdateError,
      crdtType: "loro",
      roomId: "test-room",
      code: UPDATE_ERROR_CODE.PermissionDenied,
      message: "Write access required",
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })

  it("encodes and decodes rate limited error", () => {
    const msg: UpdateError = {
      type: MESSAGE_TYPE.UpdateError,
      crdtType: "loro",
      roomId: "test-room",
      code: UPDATE_ERROR_CODE.RateLimited,
      message: "Too many requests",
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })

  it("encodes and decodes app error with app code", () => {
    const msg: UpdateError = {
      type: MESSAGE_TYPE.UpdateError,
      crdtType: "loro",
      roomId: "test-room",
      code: UPDATE_ERROR_CODE.AppError,
      message: "Custom error",
      appCode: 123,
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })
})

describe("Leave encoding/decoding", () => {
  it("encodes and decodes Leave message", () => {
    const msg: Leave = {
      type: MESSAGE_TYPE.Leave,
      crdtType: "loro",
      roomId: "test-room",
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })

  it("handles ephemeral Leave", () => {
    const msg: Leave = {
      type: MESSAGE_TYPE.Leave,
      crdtType: "ephemeral",
      roomId: "presence-room",
    }

    const encoded = encodeMessage(msg)
    const decoded = decodeMessage(encoded)

    expect(decoded).toEqual(msg)
  })
})

describe("Error handling", () => {
  it("throws on message too short", () => {
    expect(() => decodeMessage(new Uint8Array([1, 2, 3]))).toThrow(
      "Message too short",
    )
  })

  it("throws on unknown magic bytes", () => {
    expect(() =>
      decodeMessage(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00])),
    ).toThrow("Unknown magic bytes")
  })

  it("throws on unknown message type", () => {
    // Valid magic bytes (%LOR) but invalid message type (0xFF)
    expect(() =>
      decodeMessage(new Uint8Array([0x25, 0x4c, 0x4f, 0x52, 0xff])),
    ).toThrow("Unknown message type")
  })
})