import { PostgresStorageAdapter } from "@loro-extended/adapter-postgres/server"
import { Repo, Shape } from "@loro-extended/repo"
import { describe, expect, it } from "vitest"

describe("example-postgres imports", () => {
  it("imports PostgresStorageAdapter from @loro-extended/adapter-postgres/server", () => {
    expect(PostgresStorageAdapter).toBeDefined()
    expect(typeof PostgresStorageAdapter).toBe("function")
  })

  it("imports Repo from @loro-extended/repo", () => {
    expect(Repo).toBeDefined()
    expect(typeof Repo).toBe("function")
  })

  it("imports Shape from @loro-extended/repo", () => {
    expect(Shape).toBeDefined()
  })

  it("can define a document schema", () => {
    const DocSchema = Shape.doc({
      root: Shape.struct({
        message: Shape.plain.string(),
        timestamp: Shape.plain.number(),
      }),
    })
    expect(DocSchema).toBeDefined()
  })
})
