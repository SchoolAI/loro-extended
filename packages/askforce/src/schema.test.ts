import { Shape } from "@loro-extended/change"
import { describe, expect, it } from "vitest"
import { createAskforceSchema } from "./schema.js"

describe("createAskforceSchema", () => {
  it("creates a record schema with the correct structure", () => {
    const schema = createAskforceSchema(
      Shape.plain.struct({ query: Shape.plain.string() }),
      Shape.plain.struct({ result: Shape.plain.string() }),
    )

    expect(schema._type).toBe("record")
    expect(schema.shape._type).toBe("struct")
  })

  it("includes all required fields in the ask entry schema", () => {
    const schema = createAskforceSchema(
      Shape.plain.struct({ query: Shape.plain.string() }),
      Shape.plain.struct({ result: Shape.plain.string() }),
    )

    const entryShape = schema.shape
    expect(entryShape.shapes).toHaveProperty("id")
    expect(entryShape.shapes).toHaveProperty("question")
    expect(entryShape.shapes).toHaveProperty("askedAt")
    expect(entryShape.shapes).toHaveProperty("askedBy")
    expect(entryShape.shapes).toHaveProperty("answers")
  })

  it("creates answers as a record of discriminated unions", () => {
    const schema = createAskforceSchema(
      Shape.plain.struct({ query: Shape.plain.string() }),
      Shape.plain.struct({ result: Shape.plain.string() }),
    )

    const answersShape = schema.shape.shapes.answers
    expect(answersShape._type).toBe("record")
    expect(answersShape.shape._type).toBe("value")
    expect(answersShape.shape.valueType).toBe("discriminatedUnion")
  })

  it("discriminated union has pending, answered, and failed variants", () => {
    const schema = createAskforceSchema(
      Shape.plain.struct({ query: Shape.plain.string() }),
      Shape.plain.struct({ result: Shape.plain.string() }),
    )

    const answersShape = schema.shape.shapes.answers
    const unionShape = answersShape.shape as any

    expect(unionShape.discriminantKey).toBe("status")
    expect(unionShape.variants).toHaveProperty("pending")
    expect(unionShape.variants).toHaveProperty("answered")
    expect(unionShape.variants).toHaveProperty("failed")
  })

  it("pending variant has claimedAt field", () => {
    const schema = createAskforceSchema(
      Shape.plain.struct({ query: Shape.plain.string() }),
      Shape.plain.struct({ result: Shape.plain.string() }),
    )

    const unionShape = schema.shape.shapes.answers.shape as any
    const pendingVariant = unionShape.variants.pending

    expect(pendingVariant.shape).toHaveProperty("status")
    expect(pendingVariant.shape).toHaveProperty("claimedAt")
  })

  it("answered variant has data and answeredAt fields", () => {
    const schema = createAskforceSchema(
      Shape.plain.struct({ query: Shape.plain.string() }),
      Shape.plain.struct({ result: Shape.plain.string() }),
    )

    const unionShape = schema.shape.shapes.answers.shape as any
    const answeredVariant = unionShape.variants.answered

    expect(answeredVariant.shape).toHaveProperty("status")
    expect(answeredVariant.shape).toHaveProperty("data")
    expect(answeredVariant.shape).toHaveProperty("answeredAt")
  })

  it("failed variant has reason and failedAt fields", () => {
    const schema = createAskforceSchema(
      Shape.plain.struct({ query: Shape.plain.string() }),
      Shape.plain.struct({ result: Shape.plain.string() }),
    )

    const unionShape = schema.shape.shapes.answers.shape as any
    const failedVariant = unionShape.variants.failed

    expect(failedVariant.shape).toHaveProperty("status")
    expect(failedVariant.shape).toHaveProperty("reason")
    expect(failedVariant.shape).toHaveProperty("failedAt")
  })
})
