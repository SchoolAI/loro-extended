import { describe, expect, it } from "vitest"
import { change } from "./functional-helpers.js"
import { mergeValue } from "./overlay.js"
import { Shape } from "./shape.js"
import { createTypedDoc } from "./typed-doc.js"
import { validateValue } from "./validation.js"

describe("discriminatedUnion", () => {
  // Define variant shapes
  const ClientPresenceShape = Shape.plain.struct({
    type: Shape.plain.string("client"),
    name: Shape.plain.string(),
    input: Shape.plain.struct({
      force: Shape.plain.number(),
      angle: Shape.plain.number(),
    }),
  })

  const ServerPresenceShape = Shape.plain.struct({
    type: Shape.plain.string("server"),
    cars: Shape.plain.record(
      Shape.plain.struct({
        x: Shape.plain.number(),
        y: Shape.plain.number(),
      }),
    ),
    tick: Shape.plain.number(),
  })

  const GamePresenceSchema = Shape.plain.discriminatedUnion("type", {
    client: ClientPresenceShape,
    server: ServerPresenceShape,
  })

  const EmptyClientPresence = {
    type: "client" as const,
    name: "",
    input: { force: 0, angle: 0 },
  }

  const EmptyServerPresence = {
    type: "server" as const,
    cars: {},
    tick: 0,
  }

  it("should create a discriminated union shape", () => {
    expect(GamePresenceSchema._type).toBe("value")
    expect(GamePresenceSchema.valueType).toBe("discriminatedUnion")
    expect(GamePresenceSchema.discriminantKey).toBe("type")
    expect(GamePresenceSchema.variants).toHaveProperty("client")
    expect(GamePresenceSchema.variants).toHaveProperty("server")
  })

  it("should merge client variant with defaults", () => {
    const crdtValue = {
      type: "client",
      name: "Alice",
      // input is missing - should use defaults
    }

    const result = mergeValue(
      GamePresenceSchema,
      crdtValue,
      EmptyClientPresence,
    )

    expect(result).toEqual({
      type: "client",
      name: "Alice",
      input: { force: 0, angle: 0 },
    })
  })

  it("should merge server variant with defaults", () => {
    const crdtValue = {
      type: "server",
      cars: {
        "peer-1": { x: 100, y: 200 },
      },
      // tick is missing - should use defaults
    }

    const result = mergeValue(
      GamePresenceSchema,
      crdtValue,
      EmptyServerPresence,
    )

    expect(result).toEqual({
      type: "server",
      cars: {
        "peer-1": { x: 100, y: 200 },
      },
      tick: 0,
    })
  })

  it("should use empty state discriminant when CRDT has no discriminant", () => {
    const crdtValue = {
      // No type field
      name: "Bob",
    }

    const result = mergeValue(
      GamePresenceSchema,
      crdtValue,
      EmptyClientPresence,
    )

    // Should use client variant based on placeholder's type
    expect(result).toEqual({
      type: "client",
      name: "Bob",
      input: { force: 0, angle: 0 },
    })
  })

  it("should return empty state when no discriminant is available", () => {
    const crdtValue = undefined
    const emptyValue = EmptyClientPresence

    const result = mergeValue(GamePresenceSchema, crdtValue, emptyValue)

    expect(result).toEqual(EmptyClientPresence)
  })

  it("should handle nested object merging within variants", () => {
    const crdtValue = {
      type: "client",
      name: "Charlie",
      input: {
        force: 0.5,
        // angle is missing
      },
    }

    const result = mergeValue(
      GamePresenceSchema,
      crdtValue,
      EmptyClientPresence,
    )

    expect(result).toEqual({
      type: "client",
      name: "Charlie",
      input: {
        force: 0.5,
        angle: 0, // Default from empty state
      },
    })
  })

  it("should preserve full CRDT values when all fields are present", () => {
    const crdtValue = {
      type: "server",
      cars: {
        "peer-1": { x: 50, y: 75 },
        "peer-2": { x: 200, y: 300 },
      },
      tick: 42,
    }

    const result = mergeValue(
      GamePresenceSchema,
      crdtValue,
      EmptyServerPresence,
    )

    expect(result).toEqual(crdtValue)
  })
  describe("validation", () => {
    it("should validate a correct value for client variant", () => {
      const value = {
        type: "client",
        name: "Alice",
        input: { force: 1, angle: 90 },
      }
      expect(validateValue(value, GamePresenceSchema)).toEqual(value)
    })

    it("should validate a correct value for server variant", () => {
      const value = {
        type: "server",
        cars: { p1: { x: 10, y: 20 } },
        tick: 100,
      }
      expect(validateValue(value, GamePresenceSchema)).toEqual(value)
    })

    it("should throw an error for an invalid discriminant value", () => {
      const value = { type: "unknown", name: "Bob" }
      expect(() => validateValue(value, GamePresenceSchema)).toThrow(
        "Schema violation at root.type: expected one of [client, server], got string",
      )
    })

    it("should throw an error for a missing discriminant key", () => {
      const value = { name: "Bob" }
      expect(() => validateValue(value, GamePresenceSchema)).toThrow(
        "Schema violation at root.type: expected string (discriminant), got undefined",
      )
    })

    it("should throw an error if the value does not match the variant schema", () => {
      const value = {
        type: "client",
        name: "Alice",
        input: { force: "invalid", angle: 90 }, // force should be number
      }
      expect(() => validateValue(value, GamePresenceSchema)).toThrow(
        "Schema violation at root.input.force: expected number, got string",
      )
    })

    describe("TypedDoc integration", () => {
      it("should allow setting a discriminated union property in a MapDraftNode", () => {
        const DocSchema = Shape.doc({
          state: Shape.struct({
            presence: GamePresenceSchema.placeholder(EmptyClientPresence),
          }),
        })

        const doc = createTypedDoc(DocSchema)

        change(doc, draft => {
          // This should work now that MapDraftNode recognizes discriminatedUnion as a value shape
          draft.state.presence.set({
            type: "server",
            cars: { p1: { x: 10, y: 20 } },
            tick: 100,
          })
        })

        expect(doc.toJSON().state.presence).toEqual({
          type: "server",
          cars: { p1: { x: 10, y: 20 } },
          tick: 100,
        })
      })
    })
  })
})
