import { describe, expect, it } from "vitest"
import { getDocIdFromHash, parseHash } from "../create-hooks"

describe("use-doc-id-from-hash", () => {
  // ==========================================================================
  // Pure Functions
  // ==========================================================================

  describe("parseHash", () => {
    it("removes leading # from hash string", () => {
      expect(parseHash("#my-doc-id")).toBe("my-doc-id")
    })

    it("returns string unchanged if no # prefix", () => {
      expect(parseHash("my-doc-id")).toBe("my-doc-id")
    })

    it("handles empty string", () => {
      expect(parseHash("")).toBe("")
    })

    it("handles hash with only #", () => {
      expect(parseHash("#")).toBe("")
    })

    it("only removes first # character", () => {
      expect(parseHash("#hash#with#hashes")).toBe("hash#with#hashes")
    })
  })

  describe("getDocIdFromHash", () => {
    const defaultDocId = "default-doc-id" as const

    it("returns parsed hash when hash is present", () => {
      expect(getDocIdFromHash("#existing-id", defaultDocId)).toBe("existing-id")
    })

    it("returns parsed hash without # prefix", () => {
      expect(getDocIdFromHash("existing-id", defaultDocId)).toBe("existing-id")
    })

    it("returns default when hash is empty string", () => {
      expect(getDocIdFromHash("", defaultDocId)).toBe("default-doc-id")
    })

    it("returns default when hash is only #", () => {
      expect(getDocIdFromHash("#", defaultDocId)).toBe("default-doc-id")
    })

    it("preserves hash with special characters", () => {
      expect(getDocIdFromHash("#chat-abc123-xyz", defaultDocId)).toBe(
        "chat-abc123-xyz",
      )
    })
  })

  // ==========================================================================
  // Behavior Scenarios (documenting expected behavior)
  // ==========================================================================

  describe("expected behaviors", () => {
    it("scenario: fresh load with no hash → uses default and writes hash", () => {
      // Given: empty hash
      const hash = ""
      const defaultDocId = "generated-id" as const

      // When: getDocIdFromHash is called
      const docId = getDocIdFromHash(hash, defaultDocId)

      // Then: returns the default
      expect(docId).toBe("generated-id")

      // (The hook's useEffect will write this to window.location.hash)
    })

    it("scenario: load with existing hash → uses hash value", () => {
      // Given: hash exists in URL
      const hash = "#shared-link-id"
      const defaultDocId = "should-not-use" as const

      // When: getDocIdFromHash is called
      const docId = getDocIdFromHash(hash, defaultDocId)

      // Then: returns the hash value, not the default
      expect(docId).toBe("shared-link-id")
    })

    it("scenario: hash changes externally → new docId is derived", () => {
      // Given: initial state
      const defaultDocId = "initial-id" as const
      const initialDocId = getDocIdFromHash("", defaultDocId)
      expect(initialDocId).toBe("initial-id")

      // When: hash changes (simulating browser navigation)
      const newHash = "#navigated-to"
      const newDocId = getDocIdFromHash(newHash, defaultDocId)

      // Then: new docId is derived from the new hash
      expect(newDocId).toBe("navigated-to")
    })

    it("scenario: empty hash change is handled gracefully", () => {
      // Given: current docId
      const defaultDocId = "my-doc" as const

      // When: hash becomes empty (edge case)
      const docId = getDocIdFromHash("", defaultDocId)

      // Then: falls back to default
      expect(docId).toBe("my-doc")
    })
  })
})
