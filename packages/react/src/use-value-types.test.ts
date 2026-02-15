import { type Infer, Shape, type TypedDoc } from "@loro-extended/change"
import type { Doc } from "@loro-extended/repo"
import { describe, expectTypeOf, it } from "vitest"

// Test schema
const TestSchema = Shape.doc({
  title: Shape.text(),
  count: Shape.counter(),
  items: Shape.list(
    Shape.struct({
      name: Shape.plain.string(),
      value: Shape.plain.number(),
    }),
  ),
})

type TestSchemaType = typeof TestSchema

// Expected inferred type for the test schema
type ExpectedInferredType = {
  title: string
  count: number
  items: { name: string; value: number }[]
}

describe("useValue type inference", () => {
  describe("Infer type helper", () => {
    it("should infer correct type from schema", () => {
      type Actual = Infer<TestSchemaType>

      expectTypeOf<Actual>().toEqualTypeOf<ExpectedInferredType>()
    })
  })

  describe("Doc and TypedDoc toJSON return types", () => {
    it("Doc<D> should have toJSON returning Infer<D>", () => {
      type DocType = Doc<TestSchemaType>

      // Verify Doc has toJSON that returns Infer<D>
      type ToJSONResult = ReturnType<DocType["toJSON"]>
      expectTypeOf<ToJSONResult>().toEqualTypeOf<ExpectedInferredType>()
    })

    it("TypedDoc<D> should have toJSON returning Infer<D>", () => {
      type TypedDocType = TypedDoc<TestSchemaType>

      type ToJSONResult = ReturnType<TypedDocType["toJSON"]>
      expectTypeOf<ToJSONResult>().toEqualTypeOf<ExpectedInferredType>()
    })

    it("Doc<D> and TypedDoc<D> toJSON return same type", () => {
      type DocType = Doc<TestSchemaType>
      type TypedDocType = TypedDoc<TestSchemaType>

      type DocToJSON = ReturnType<DocType["toJSON"]>
      type TypedDocToJSON = ReturnType<TypedDocType["toJSON"]>

      expectTypeOf<DocToJSON>().toEqualTypeOf<TypedDocToJSON>()
    })
  })

  describe("useValue signature compatibility", () => {
    it("ReturnType<T['toJSON']> works for Doc and TypedDoc", () => {
      // This is the pattern useValue uses: ReturnType<T["toJSON"]>
      // It should work for both Doc<D> and TypedDoc<D>

      type GetToJSONReturn<T extends { toJSON(): unknown }> = ReturnType<
        T["toJSON"]
      >

      type DocResult = GetToJSONReturn<Doc<TestSchemaType>>
      type TypedDocResult = GetToJSONReturn<TypedDoc<TestSchemaType>>

      expectTypeOf<DocResult>().toEqualTypeOf<ExpectedInferredType>()
      expectTypeOf<TypedDocResult>().toEqualTypeOf<ExpectedInferredType>()
    })

    it("result should not be empty object or unknown", () => {
      type DocType = Doc<TestSchemaType>
      type Result = ReturnType<DocType["toJSON"]>

      // Verify it has specific properties (not just {})
      type HasTitle = Result extends { title: string } ? true : false
      type HasCount = Result extends { count: number } ? true : false
      type HasItems = Result extends { items: unknown[] } ? true : false

      expectTypeOf<HasTitle>().toEqualTypeOf<true>()
      expectTypeOf<HasCount>().toEqualTypeOf<true>()
      expectTypeOf<HasItems>().toEqualTypeOf<true>()

      // Verify it's not an empty object type
      type IsNotEmptyRecord = Result extends Record<string, never>
        ? false
        : true
      expectTypeOf<IsNotEmptyRecord>().toEqualTypeOf<true>()
    })
  })
})
