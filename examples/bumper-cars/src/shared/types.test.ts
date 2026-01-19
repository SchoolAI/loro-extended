import { describe, expect, it } from "vitest"
import {
  ARENA_DOC_ID,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  ArenaSchema,
  CAR_COLORS,
  CAR_RADIUS,
  ClientPresenceSchema,
  GameEphemeralDeclarations,
  GamePresenceSchema,
  MAX_SPEED,
  PlayerScoreSchema,
  ServerPresenceSchema,
  TICK_RATE,
} from "./types.js"

describe("bumper-cars shared types", () => {
  describe("constants", () => {
    it("defines arena dimensions", () => {
      expect(ARENA_WIDTH).toBe(800)
      expect(ARENA_HEIGHT).toBe(600)
    })

    it("defines car properties", () => {
      expect(CAR_RADIUS).toBe(25)
      expect(MAX_SPEED).toBe(8)
    })

    it("defines tick rate", () => {
      expect(TICK_RATE).toBe(60)
    })

    it("defines car colors", () => {
      expect(CAR_COLORS).toHaveLength(10)
      expect(CAR_COLORS[0]).toBe("#FF6B6B")
    })

    it("defines arena doc ID", () => {
      expect(ARENA_DOC_ID).toBe("bumper-cars-arena")
    })
  })

  describe("schemas", () => {
    it("defines PlayerScoreSchema", () => {
      expect(PlayerScoreSchema).toBeDefined()
    })

    it("defines ArenaSchema", () => {
      expect(ArenaSchema).toBeDefined()
    })

    it("defines ClientPresenceSchema", () => {
      expect(ClientPresenceSchema).toBeDefined()
    })

    it("defines ServerPresenceSchema", () => {
      expect(ServerPresenceSchema).toBeDefined()
    })

    it("defines GamePresenceSchema", () => {
      expect(GamePresenceSchema).toBeDefined()
    })

    it("defines GameEphemeralDeclarations", () => {
      expect(GameEphemeralDeclarations).toBeDefined()
      expect(GameEphemeralDeclarations.presence).toBe(GamePresenceSchema)
    })
  })
})
