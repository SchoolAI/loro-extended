import { describe, expect, it } from "vitest"
import { Shape } from "./shape.js"
import { validateValue } from "./validation.js"

describe("String Literal Shape", () => {
  it("should support type inference for string unions", () => {
    const schema = Shape.plain.string<"user" | "ai">()

    // This is a type-level check, we can't easily assert it at runtime without options
    // But we can check that it validates strings
    expect(validateValue("user", schema)).toBe("user")
    expect(validateValue("ai", schema)).toBe("ai")
    expect(validateValue("other", schema)).toBe("other") // No runtime validation without options
  })

  it("should support runtime validation when options are provided", () => {
    const schema = Shape.plain.string("user", "ai")

    expect(validateValue("user", schema)).toBe("user")
    expect(validateValue("ai", schema)).toBe("ai")

    expect(() => validateValue("other", schema)).toThrow(
      "Schema violation at root: expected one of [user, ai], got string",
    )
  })

  it("should work with single option", () => {
    const schema = Shape.plain.string("fixed")

    expect(validateValue("fixed", schema)).toBe("fixed")
    expect(() => validateValue("other", schema)).toThrow(
      "Schema violation at root: expected one of [fixed], got string",
    )
  })

  it("should maintain backward compatibility", () => {
    const schema = Shape.plain.string()

    expect(validateValue("any", schema)).toBe("any")
    expect(validateValue("", schema)).toBe("")
  })
})
