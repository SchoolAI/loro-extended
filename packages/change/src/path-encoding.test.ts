import { describe, expect, it } from "vitest"
import {
  buildRootContainerName,
  escapePathSegment,
  parseRootContainerName,
} from "./path-encoding.js"

describe("Path Encoding", () => {
  describe("escapePathSegment", () => {
    it("should not escape simple segments", () => {
      expect(escapePathSegment("data")).toBe("data")
      expect(escapePathSegment("items")).toBe("items")
      expect(escapePathSegment("nested")).toBe("nested")
    })

    it("should escape hyphens in segments", () => {
      expect(escapePathSegment("my-key")).toBe("my\\-key")
      expect(escapePathSegment("api-url")).toBe("api\\-url")
      expect(escapePathSegment("-")).toBe("\\-")
    })

    it("should escape backslashes in segments", () => {
      expect(escapePathSegment("path\\to")).toBe("path\\\\to")
      expect(escapePathSegment("\\")).toBe("\\\\")
    })

    it("should escape backslashes before hyphens", () => {
      // Key "a\-b" should become "a\\\-b"
      expect(escapePathSegment("a\\-b")).toBe("a\\\\\\-b")
    })

    it("should handle multiple consecutive hyphens", () => {
      expect(escapePathSegment("a--b")).toBe("a\\-\\-b")
    })

    it("should handle empty segments", () => {
      expect(escapePathSegment("")).toBe("")
    })
  })

  describe("buildRootContainerName", () => {
    it("should join simple segments with hyphens", () => {
      expect(buildRootContainerName(["data", "nested", "items"])).toBe(
        "data-nested-items",
      )
    })

    it("should escape hyphens in keys", () => {
      expect(buildRootContainerName(["data", "my-key", "value"])).toBe(
        "data-my\\-key-value",
      )
      expect(buildRootContainerName(["config", "api-url"])).toBe(
        "config-api\\-url",
      )
    })

    it("should handle single segment", () => {
      expect(buildRootContainerName(["data"])).toBe("data")
    })

    it("should handle empty array", () => {
      expect(buildRootContainerName([])).toBe("")
    })

    it("should handle key that is just a hyphen", () => {
      expect(buildRootContainerName(["data", "-", "value"])).toBe(
        "data-\\--value",
      )
    })

    it("should handle keys with backslashes", () => {
      expect(buildRootContainerName(["data", "path\\to", "value"])).toBe(
        "data-path\\\\to-value",
      )
    })
  })

  describe("parseRootContainerName", () => {
    it("should parse simple paths", () => {
      expect(parseRootContainerName("data-nested-items")).toEqual([
        "data",
        "nested",
        "items",
      ])
    })

    it("should parse escaped hyphens", () => {
      expect(parseRootContainerName("data-my\\-key-value")).toEqual([
        "data",
        "my-key",
        "value",
      ])
      expect(parseRootContainerName("config-api\\-url")).toEqual([
        "config",
        "api-url",
      ])
    })

    it("should parse single segment", () => {
      expect(parseRootContainerName("data")).toEqual(["data"])
    })

    it("should parse empty string", () => {
      expect(parseRootContainerName("")).toEqual([""])
    })

    it("should parse key that is just a hyphen", () => {
      expect(parseRootContainerName("data-\\--value")).toEqual([
        "data",
        "-",
        "value",
      ])
    })

    it("should parse keys with multiple consecutive hyphens", () => {
      expect(parseRootContainerName("data-a\\-\\-b-value")).toEqual([
        "data",
        "a--b",
        "value",
      ])
    })

    it("should parse keys with backslashes", () => {
      expect(parseRootContainerName("data-path\\\\to-value")).toEqual([
        "data",
        "path\\to",
        "value",
      ])
    })

    it("should parse keys with backslash followed by hyphen", () => {
      expect(parseRootContainerName("data-a\\\\\\-b-value")).toEqual([
        "data",
        "a\\-b",
        "value",
      ])
    })

    it("should handle invalid escape sequences gracefully", () => {
      // Backslash followed by something other than - or \
      // Should treat as literal backslash
      expect(parseRootContainerName("data-a\\x-value")).toEqual([
        "data",
        "a\\x",
        "value",
      ])
    })

    it("should handle trailing backslash", () => {
      // Backslash at end of string
      expect(parseRootContainerName("data-value\\")).toEqual([
        "data",
        "value\\",
      ])
    })
  })

  describe("round-trip encoding", () => {
    it("should round-trip simple paths", () => {
      const segments = ["data", "nested", "items"]
      const encoded = buildRootContainerName(segments)
      const decoded = parseRootContainerName(encoded)
      expect(decoded).toEqual(segments)
    })

    it("should round-trip paths with hyphens", () => {
      const segments = ["data", "my-key", "value"]
      const encoded = buildRootContainerName(segments)
      const decoded = parseRootContainerName(encoded)
      expect(decoded).toEqual(segments)
    })

    it("should round-trip paths with backslashes", () => {
      const segments = ["data", "path\\to", "value"]
      const encoded = buildRootContainerName(segments)
      const decoded = parseRootContainerName(encoded)
      expect(decoded).toEqual(segments)
    })

    it("should round-trip paths with backslash-hyphen", () => {
      const segments = ["data", "a\\-b", "value"]
      const encoded = buildRootContainerName(segments)
      const decoded = parseRootContainerName(encoded)
      expect(decoded).toEqual(segments)
    })

    it("should round-trip complex paths", () => {
      const segments = ["root", "my-key", "path\\to\\file", "a\\-b--c", "end"]
      const encoded = buildRootContainerName(segments)
      const decoded = parseRootContainerName(encoded)
      expect(decoded).toEqual(segments)
    })

    it("should round-trip empty segments", () => {
      const segments = ["data", "", "value"]
      const encoded = buildRootContainerName(segments)
      const decoded = parseRootContainerName(encoded)
      expect(decoded).toEqual(segments)
    })
  })
})
