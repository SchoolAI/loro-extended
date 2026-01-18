import { Shape } from "@loro-extended/change"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  createRepoWrapper,
  createTestDocumentId,
  useHandle,
  useRefValue,
} from "../test-utils"

const testSchema = Shape.doc({
  title: Shape.text().placeholder("Untitled"),
  description: Shape.text(),
  count: Shape.counter(),
  items: Shape.list(Shape.text()),
})

describe("useRefValue", () => {
  describe("with TextRef", () => {
    it("should return value and placeholder for TextRef with placeholder", () => {
      const documentId = createTestDocumentId()
      const RepoWrapper = createRepoWrapper()

      const { result } = renderHook(
        () => {
          const handle = useHandle(documentId, testSchema)
          return useRefValue(handle.doc.title)
        },
        { wrapper: RepoWrapper },
      )

      // Should return the placeholder as value (since CRDT is empty)
      // and also expose the placeholder separately
      expect(result.current.value).toBe("")
      expect(result.current.placeholder).toBe("Untitled")
    })

    it("should return value without placeholder for TextRef without placeholder", () => {
      const documentId = createTestDocumentId()
      const RepoWrapper = createRepoWrapper()

      const { result } = renderHook(
        () => {
          const handle = useHandle(documentId, testSchema)
          return useRefValue(handle.doc.description)
        },
        { wrapper: RepoWrapper },
      )

      expect(result.current.value).toBe("")
      expect(result.current.placeholder).toBeUndefined()
    })

    it("should update when TextRef value changes", () => {
      const documentId = createTestDocumentId()
      const RepoWrapper = createRepoWrapper()

      const { result } = renderHook(
        () => {
          const handle = useHandle(documentId, testSchema)
          const refValue = useRefValue(handle.doc.title)
          return { handle, refValue }
        },
        { wrapper: RepoWrapper },
      )

      expect(result.current.refValue.value).toBe("")

      // Mutate the text
      act(() => {
        result.current.handle.doc.title.update("Hello World")
      })

      expect(result.current.refValue.value).toBe("Hello World")
      expect(result.current.refValue.placeholder).toBe("Untitled")
    })
  })

  describe("with CounterRef", () => {
    it("should return counter value", () => {
      const documentId = createTestDocumentId()
      const RepoWrapper = createRepoWrapper()

      const { result } = renderHook(
        () => {
          const handle = useHandle(documentId, testSchema)
          return useRefValue(handle.doc.count)
        },
        { wrapper: RepoWrapper },
      )

      expect(result.current.value).toBe(0)
    })

    it("should update when counter changes", () => {
      const documentId = createTestDocumentId()
      const RepoWrapper = createRepoWrapper()

      const { result } = renderHook(
        () => {
          const handle = useHandle(documentId, testSchema)
          const refValue = useRefValue(handle.doc.count)
          return { handle, refValue }
        },
        { wrapper: RepoWrapper },
      )

      expect(result.current.refValue.value).toBe(0)

      act(() => {
        result.current.handle.doc.count.increment(5)
      })

      expect(result.current.refValue.value).toBe(5)

      act(() => {
        result.current.handle.doc.count.decrement(2)
      })

      expect(result.current.refValue.value).toBe(3)
    })
  })

  describe("with ListRef", () => {
    it("should return list value", () => {
      const documentId = createTestDocumentId()
      const RepoWrapper = createRepoWrapper()

      const { result } = renderHook(
        () => {
          const handle = useHandle(documentId, testSchema)
          return useRefValue(handle.doc.items)
        },
        { wrapper: RepoWrapper },
      )

      expect(result.current.value).toEqual([])
    })

    it("should update when list changes", () => {
      const documentId = createTestDocumentId()
      const RepoWrapper = createRepoWrapper()

      const { result } = renderHook(
        () => {
          const handle = useHandle(documentId, testSchema)
          const refValue = useRefValue(handle.doc.items)
          return { handle, refValue }
        },
        { wrapper: RepoWrapper },
      )

      expect(result.current.refValue.value).toEqual([])

      act(() => {
        result.current.handle.change(d => {
          d.items.push("Item 1")
          d.items.push("Item 2")
        })
      })

      expect(result.current.refValue.value).toEqual(["Item 1", "Item 2"])
    })
  })

  describe("multiple refs", () => {
    it("should track multiple refs independently", () => {
      const documentId = createTestDocumentId()
      const RepoWrapper = createRepoWrapper()

      const { result } = renderHook(
        () => {
          const handle = useHandle(documentId, testSchema)
          const titleValue = useRefValue(handle.doc.title)
          const countValue = useRefValue(handle.doc.count)
          return { handle, titleValue, countValue }
        },
        { wrapper: RepoWrapper },
      )

      // Initial values
      expect(result.current.titleValue.value).toBe("")
      expect(result.current.countValue.value).toBe(0)

      // Change only the title
      act(() => {
        result.current.handle.doc.title.update("New Title")
      })

      expect(result.current.titleValue.value).toBe("New Title")
      expect(result.current.countValue.value).toBe(0)

      // Change only the counter
      act(() => {
        result.current.handle.doc.count.increment(10)
      })

      expect(result.current.titleValue.value).toBe("New Title")
      expect(result.current.countValue.value).toBe(10)
    })
  })
})
