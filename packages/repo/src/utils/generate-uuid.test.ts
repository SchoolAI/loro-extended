import { describe, expect, it, vi } from "vitest"
import { generateUUID } from "./generate-uuid.js"

describe("generateUUID", () => {
  it("returns a valid UUID v4 format", () => {
    const uuid = generateUUID()
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    // where y is one of 8, 9, a, or b
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    expect(uuid).toMatch(uuidRegex)
  })

  it("generates unique UUIDs", () => {
    const uuids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      uuids.add(generateUUID())
    }
    expect(uuids.size).toBe(100)
  })

  it("uses crypto.randomUUID when available", () => {
    const mockUUID =
      "12345678-1234-4123-8123-123456789abc" as `${string}-${string}-${string}-${string}-${string}`
    const originalRandomUUID = crypto.randomUUID
    crypto.randomUUID = vi.fn(() => mockUUID) as typeof crypto.randomUUID

    try {
      const uuid = generateUUID()
      expect(uuid).toBe(mockUUID)
      expect(crypto.randomUUID).toHaveBeenCalled()
    } finally {
      crypto.randomUUID = originalRandomUUID
    }
  })

  it("falls back to getRandomValues when randomUUID is not available", () => {
    const originalRandomUUID = crypto.randomUUID
    // @ts-expect-error - intentionally removing randomUUID to test fallback
    delete crypto.randomUUID

    try {
      const uuid = generateUUID()
      // Should still produce a valid UUID format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      expect(uuid).toMatch(uuidRegex)
    } finally {
      crypto.randomUUID = originalRandomUUID
    }
  })
})
