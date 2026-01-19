import { describe, expect, it } from "vitest"
import {
  ChatEphemeralDeclarations,
  ChatSchema,
  EmptyPresence,
  MessageSchema,
  PreferenceSchema,
  PresenceSchema,
} from "./types.js"

describe("chat shared types", () => {
  describe("schemas", () => {
    it("defines MessageSchema", () => {
      expect(MessageSchema).toBeDefined()
    })

    it("defines PreferenceSchema", () => {
      expect(PreferenceSchema).toBeDefined()
    })

    it("defines ChatSchema", () => {
      expect(ChatSchema).toBeDefined()
    })

    it("defines PresenceSchema", () => {
      expect(PresenceSchema).toBeDefined()
    })

    it("defines ChatEphemeralDeclarations", () => {
      expect(ChatEphemeralDeclarations).toBeDefined()
      expect(ChatEphemeralDeclarations.presence).toBe(PresenceSchema)
    })
  })

  describe("EmptyPresence", () => {
    it("has correct default values", () => {
      expect(EmptyPresence.type).toBe("user")
      expect(EmptyPresence.name).toBe("Anonymous")
    })
  })
})
