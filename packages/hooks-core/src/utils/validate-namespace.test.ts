import { describe, expect, it, vi } from "vitest"
import {
  isValidNamespace,
  validateNamespace,
  validateNamespaceSafe,
} from "./validate-namespace"

describe("validateNamespace", () => {
  describe("valid namespaces", () => {
    it("accepts simple lowercase names", () => {
      expect(() => validateNamespace("header")).not.toThrow()
      expect(() => validateNamespace("body")).not.toThrow()
      expect(() => validateNamespace("footer")).not.toThrow()
    })

    it("accepts names with hyphens", () => {
      expect(() => validateNamespace("body-content")).not.toThrow()
      expect(() => validateNamespace("main-section")).not.toThrow()
    })

    it("accepts names with underscores", () => {
      expect(() => validateNamespace("section_1")).not.toThrow()
      expect(() => validateNamespace("header_main")).not.toThrow()
    })

    it("accepts names with numbers (not at start)", () => {
      expect(() => validateNamespace("section1")).not.toThrow()
      expect(() => validateNamespace("field123")).not.toThrow()
    })

    it("accepts uppercase letters", () => {
      expect(() => validateNamespace("Header")).not.toThrow()
      expect(() => validateNamespace("BODY")).not.toThrow()
      expect(() => validateNamespace("MainSection")).not.toThrow()
    })

    it("accepts single letter", () => {
      expect(() => validateNamespace("a")).not.toThrow()
      expect(() => validateNamespace("Z")).not.toThrow()
    })

    it("accepts maximum length (64 characters)", () => {
      const maxLength = "a" + "b".repeat(63)
      expect(maxLength.length).toBe(64)
      expect(() => validateNamespace(maxLength)).not.toThrow()
    })
  })

  describe("invalid namespaces", () => {
    it("rejects empty string", () => {
      expect(() => validateNamespace("")).toThrow(/Invalid namespace/)
    })

    it("rejects names starting with number", () => {
      expect(() => validateNamespace("123")).toThrow(/Invalid namespace/)
      expect(() => validateNamespace("1section")).toThrow(/Invalid namespace/)
    })

    it("rejects names starting with underscore", () => {
      expect(() => validateNamespace("_header")).toThrow(/Invalid namespace/)
    })

    it("rejects names starting with hyphen", () => {
      expect(() => validateNamespace("-header")).toThrow(/Invalid namespace/)
    })

    it("rejects names with spaces", () => {
      expect(() => validateNamespace("has spaces")).toThrow(/Invalid namespace/)
      expect(() => validateNamespace("header section")).toThrow(
        /Invalid namespace/,
      )
    })

    it("rejects names with special characters", () => {
      expect(() => validateNamespace("header!")).toThrow(/Invalid namespace/)
      expect(() => validateNamespace("section@1")).toThrow(/Invalid namespace/)
      expect(() => validateNamespace("body.content")).toThrow(
        /Invalid namespace/,
      )
    })

    it("rejects names exceeding 64 characters", () => {
      const tooLong = "a".repeat(65)
      expect(tooLong.length).toBe(65)
      expect(() => validateNamespace(tooLong)).toThrow(/Invalid namespace/)
    })
  })
})

describe("isValidNamespace", () => {
  it("returns true for valid namespaces", () => {
    expect(isValidNamespace("header")).toBe(true)
    expect(isValidNamespace("body-content")).toBe(true)
    expect(isValidNamespace("section_1")).toBe(true)
  })

  it("returns false for invalid namespaces", () => {
    expect(isValidNamespace("")).toBe(false)
    expect(isValidNamespace("123")).toBe(false)
    expect(isValidNamespace("has spaces")).toBe(false)
  })
})

describe("validateNamespaceSafe", () => {
  it("warns for invalid namespace", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(() => validateNamespaceSafe("123")).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[validateNamespace]"),
    )

    warnSpy.mockRestore()
  })

  it("does not warn for valid namespace", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(() => validateNamespaceSafe("header")).not.toThrow()
    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })
})
