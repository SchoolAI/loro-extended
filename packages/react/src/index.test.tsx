import { describe, expect, it } from "vitest"
import {
  CursorRegistry,
  CursorRegistryContext,
  change,
  getLoroDoc,
  RepoContext,
  RepoProvider,
  Shape,
  useCollaborativeText,
  useCursorRegistry,
  useDoc,
  useEphemeral,
  useHandle,
  useRefValue,
  useRepo,
  useUndoManager,
} from "./index.js"

describe("@loro-extended/react exports", () => {
  it("exports RepoProvider component", () => {
    expect(RepoProvider).toBeDefined()
    expect(typeof RepoProvider).toBe("function")
  })

  it("exports RepoContext", () => {
    expect(RepoContext).toBeDefined()
  })

  it("exports CursorRegistry class", () => {
    expect(CursorRegistry).toBeDefined()
    expect(typeof CursorRegistry).toBe("function")
  })

  it("exports CursorRegistryContext", () => {
    expect(CursorRegistryContext).toBeDefined()
  })

  it("exports useCursorRegistry hook", () => {
    expect(useCursorRegistry).toBeDefined()
    expect(typeof useCursorRegistry).toBe("function")
  })

  it("exports useRepo hook", () => {
    expect(useRepo).toBeDefined()
    expect(typeof useRepo).toBe("function")
  })

  it("exports useHandle hook", () => {
    expect(useHandle).toBeDefined()
    expect(typeof useHandle).toBe("function")
  })

  it("exports useDoc hook", () => {
    expect(useDoc).toBeDefined()
    expect(typeof useDoc).toBe("function")
  })

  it("exports useEphemeral hook", () => {
    expect(useEphemeral).toBeDefined()
    expect(typeof useEphemeral).toBe("function")
  })

  it("exports useRefValue hook", () => {
    expect(useRefValue).toBeDefined()
    expect(typeof useRefValue).toBe("function")
  })

  it("exports useCollaborativeText hook", () => {
    expect(useCollaborativeText).toBeDefined()
    expect(typeof useCollaborativeText).toBe("function")
  })

  it("exports useUndoManager hook", () => {
    expect(useUndoManager).toBeDefined()
    expect(typeof useUndoManager).toBe("function")
  })

  it("exports Shape from @loro-extended/change", () => {
    expect(Shape).toBeDefined()
  })

  it("exports change from @loro-extended/change", () => {
    expect(change).toBeDefined()
    expect(typeof change).toBe("function")
  })

  it("exports getLoroDoc from @loro-extended/change", () => {
    expect(getLoroDoc).toBeDefined()
    expect(typeof getLoroDoc).toBe("function")
  })
})
