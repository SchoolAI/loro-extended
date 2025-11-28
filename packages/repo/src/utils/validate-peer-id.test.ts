import { describe, expect, it } from "vitest"
import { validatePeerId } from "./validate-peer-id.js"

describe("validatePeerId", () => {
  describe("valid peerIds", () => {
    it("accepts '0'", () => {
      expect(() => validatePeerId("0")).not.toThrow()
    })

    it("accepts positive integers", () => {
      expect(() => validatePeerId("1")).not.toThrow()
      expect(() => validatePeerId("123")).not.toThrow()
      expect(() => validatePeerId("123456789")).not.toThrow()
    })

    it("accepts large numbers within uint64 range", () => {
      expect(() => validatePeerId("9007199254740991")).not.toThrow() // Number.MAX_SAFE_INTEGER
      expect(() => validatePeerId("18446744073709551615")).not.toThrow() // 2^64 - 1 (max uint64)
    })
  })

  describe("invalid peerIds", () => {
    it("rejects empty string", () => {
      expect(() => validatePeerId("")).toThrow(/Invalid peerId/)
    })

    it("rejects leading zeros", () => {
      expect(() => validatePeerId("01")).toThrow(/Invalid peerId/)
      expect(() => validatePeerId("007")).toThrow(/Invalid peerId/)
      expect(() => validatePeerId("0123")).toThrow(/Invalid peerId/)
    })

    it("rejects negative numbers", () => {
      expect(() => validatePeerId("-1")).toThrow(/Invalid peerId/)
      expect(() => validatePeerId("-123")).toThrow(/Invalid peerId/)
    })

    it("rejects non-numeric strings", () => {
      expect(() => validatePeerId("abc")).toThrow(/Invalid peerId/)
      expect(() => validatePeerId("123abc")).toThrow(/Invalid peerId/)
      expect(() => validatePeerId("abc123")).toThrow(/Invalid peerId/)
    })

    it("rejects floating point numbers", () => {
      expect(() => validatePeerId("1.5")).toThrow(/Invalid peerId/)
      expect(() => validatePeerId("123.456")).toThrow(/Invalid peerId/)
    })

    it("rejects whitespace", () => {
      expect(() => validatePeerId(" 123")).toThrow(/Invalid peerId/)
      expect(() => validatePeerId("123 ")).toThrow(/Invalid peerId/)
      expect(() => validatePeerId(" 123 ")).toThrow(/Invalid peerId/)
    })

    it("rejects numbers exceeding uint64 max", () => {
      expect(() => validatePeerId("18446744073709551616")).toThrow(
        /Invalid peerId/,
      ) // 2^64 (one over max)
      expect(() => validatePeerId("99999999999999999999999")).toThrow(
        /Invalid peerId/,
      )
    })
  })
})
