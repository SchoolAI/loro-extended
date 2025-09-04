import { LoroShape } from "@loro-extended/change"
import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { createMockDocHandle } from "../test-utils.js"
import { useLoroDocChanger } from "./use-loro-doc-changer.js"

// Test schema and empty state
const testSchema = LoroShape.doc({
  title: LoroShape.text(),
  count: LoroShape.counter(),
})

const testEmptyState = {
  title: "Test Document",
  count: 0,
}

describe("useLoroDocChanger", () => {
  it("should return a change function", () => {
    const mockHandle = createMockDocHandle()

    const { result } = renderHook(() => useLoroDocChanger(mockHandle, testSchema, testEmptyState))

    expect(typeof result.current).toBe("function")
  })

  it("should call handle.change when change function is invoked", () => {
    const mockHandle = createMockDocHandle()

    const { result } = renderHook(() => useLoroDocChanger(mockHandle, testSchema, testEmptyState))

    const changeFn = vi.fn()
    result.current(changeFn)

    expect(mockHandle.change).toHaveBeenCalledWith(expect.any(Function))
  })

  it("should warn and return early when handle is null", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { result } = renderHook(() => useLoroDocChanger(null, testSchema, testEmptyState))

    const changeFn = vi.fn()
    result.current(changeFn)

    expect(consoleSpy).toHaveBeenCalledWith(
      "doc handle not available for change",
    )
    expect(changeFn).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it("should return stable function reference", () => {
    const mockHandle = createMockDocHandle()

    const { result, rerender } = renderHook(() => useLoroDocChanger(mockHandle, testSchema, testEmptyState))

    const firstFunction = result.current
    rerender()
    const secondFunction = result.current

    expect(firstFunction).toBe(secondFunction)
  })

  it("should update function when handle changes", () => {
    const mockHandle1 = createMockDocHandle()
    const mockHandle2 = createMockDocHandle()

    const { result, rerender } = renderHook(
      ({ handle }) => useLoroDocChanger(handle, testSchema, testEmptyState),
      { initialProps: { handle: mockHandle1 } },
    )

    const firstFunction = result.current

    rerender({ handle: mockHandle2 })

    const secondFunction = result.current

    // Functions should be different when handle changes
    expect(firstFunction).not.toBe(secondFunction)
  })
})
