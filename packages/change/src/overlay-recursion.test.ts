import { LoroDoc, LoroList, LoroMap } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { change } from "./functional-helpers.js"
import { mergeValue } from "./overlay.js"
import { Shape } from "./shape.js"
import { createTypedDoc } from "./typed-doc.js"

/**
 * Regression tests for overlay/mergeValue functionality.
 *
 * Tests placeholder recursion in nested structures and null value preservation.
 */
describe("Overlay and Placeholder Handling", () => {
  describe("TypedDoc.toJSON() - uses overlayPlaceholder/mergeValue", () => {
    it("should apply placeholders in nested Maps within a Map", () => {
      const schema = Shape.doc({
        user: Shape.struct({
          profile: Shape.struct({
            name: Shape.plain.string(),
            role: Shape.plain.string().placeholder("guest"), // Default value
          }),
        }),
      })

      const typedDoc = createTypedDoc(schema)

      // Set only the name, 'role' should default to 'guest'
      change(typedDoc, draft => {
        draft.user.profile.set("name", "Alice")
      })

      const json = typedDoc.toJSON()

      expect(json.user.profile.name).toBe("Alice")
      expect(json.user.profile.role).toBe("guest")
    })

    it("should apply placeholders to nested map properties inside list items", () => {
      const schema = Shape.doc({
        users: Shape.list(
          Shape.struct({
            name: Shape.plain.string(),
            role: Shape.plain.string().placeholder("guest"),
          }),
        ),
      })

      // Create a LoroDoc with partial data (missing 'role')
      const loroDoc = new LoroDoc()
      const usersList = loroDoc.getList("users")
      const userMap = usersList.insertContainer(0, new LoroMap())
      userMap.set("name", "Alice")
      // Note: 'role' is NOT set - should default to "guest"

      const typedDoc = createTypedDoc(schema, loroDoc)
      const json = typedDoc.toJSON()

      expect(json.users[0].name).toBe("Alice")
      expect(json.users[0].role).toBe("guest")
    })

    it("should apply placeholders in deeply nested structures: list → map → list → map", () => {
      const schema = Shape.doc({
        departments: Shape.list(
          Shape.struct({
            name: Shape.plain.string(),
            employees: Shape.list(
              Shape.struct({
                name: Shape.plain.string(),
                level: Shape.plain.number().placeholder(1),
                status: Shape.plain.string().placeholder("active"),
              }),
            ),
          }),
        ),
      })

      // Create a LoroDoc with deeply nested partial data
      const loroDoc = new LoroDoc()
      const deptList = loroDoc.getList("departments")

      // Add a department
      const deptMap = deptList.insertContainer(0, new LoroMap())
      deptMap.set("name", "Engineering")

      // Add employees list to department
      const empList = deptMap.setContainer("employees", new LoroList())

      // Add an employee with partial data
      const empMap = empList.insertContainer(0, new LoroMap())
      empMap.set("name", "Bob")
      // Note: 'level' and 'status' are NOT set

      const typedDoc = createTypedDoc(schema, loroDoc)
      const json = typedDoc.toJSON()

      expect(json.departments[0].name).toBe("Engineering")
      expect(json.departments[0].employees[0].name).toBe("Bob")
      expect(json.departments[0].employees[0].level).toBe(1)
      expect(json.departments[0].employees[0].status).toBe("active")
    })

    it("should apply placeholders to counter values inside list items", () => {
      const schema = Shape.doc({
        articles: Shape.list(
          Shape.struct({
            title: Shape.text(),
            views: Shape.counter().placeholder(100),
          }),
        ),
      })

      // Create a LoroDoc with partial data (counter not incremented)
      const loroDoc = new LoroDoc()
      const articlesList = loroDoc.getList("articles")
      const articleMap = articlesList.insertContainer(0, new LoroMap())
      // Only set title, don't touch the counter
      const _titleText = articleMap.setContainer(
        "title",
        loroDoc.getText("temp"),
      )
      // Actually we need to create a text container properly

      const typedDoc = createTypedDoc(schema, loroDoc)
      const json = typedDoc.toJSON()

      // The counter should default to 100 if not set
      // Note: This test may need adjustment based on how counters are created
      expect(json.articles[0].views).toBe(100)
    })

    it("should apply placeholders to movableList items", () => {
      const schema = Shape.doc({
        tasks: Shape.movableList(
          Shape.struct({
            title: Shape.plain.string(),
            priority: Shape.plain.number().placeholder(5),
            completed: Shape.plain.boolean().placeholder(false),
          }),
        ),
      })

      // Create a LoroDoc with partial data
      const loroDoc = new LoroDoc()
      const tasksList = loroDoc.getMovableList("tasks")
      const taskMap = tasksList.insertContainer(0, new LoroMap())
      taskMap.set("title", "Important Task")
      // Note: 'priority' and 'completed' are NOT set

      const typedDoc = createTypedDoc(schema, loroDoc)
      const json = typedDoc.toJSON()

      expect(json.tasks[0].title).toBe("Important Task")
      expect(json.tasks[0].priority).toBe(5)
      expect(json.tasks[0].completed).toBe(false)
    })
  })

  describe("TypedRef.toJSON() - individual ref serialization", () => {
    it("should apply placeholders when calling toJSON() on a list ref directly", () => {
      const schema = Shape.doc({
        items: Shape.list(
          Shape.struct({
            name: Shape.plain.string(),
            count: Shape.plain.number().placeholder(0),
          }),
        ),
      })

      // Create a LoroDoc with partial data
      const loroDoc = new LoroDoc()
      const itemsList = loroDoc.getList("items")
      const itemMap = itemsList.insertContainer(0, new LoroMap())
      itemMap.set("name", "Widget")
      // Note: 'count' is NOT set

      const typedDoc = createTypedDoc(schema, loroDoc)

      // Access the list ref directly and call toJSON()
      const listJson = typedDoc.items.toJSON()

      expect(listJson[0].name).toBe("Widget")
      expect(listJson[0].count).toBe(0)
    })
  })

  describe("Edge cases", () => {
    it("should handle empty lists correctly", () => {
      const schema = Shape.doc({
        items: Shape.list(
          Shape.struct({
            name: Shape.plain.string(),
            value: Shape.plain.number().placeholder(42),
          }),
        ),
      })

      const typedDoc = createTypedDoc(schema)
      const json = typedDoc.toJSON()

      expect(json.items).toEqual([])
    })

    it("should handle lists with plain value items (no nested placeholders)", () => {
      const schema = Shape.doc({
        numbers: Shape.list(Shape.plain.number()),
        strings: Shape.list(Shape.plain.string()),
      })

      const loroDoc = new LoroDoc()
      const numbersList = loroDoc.getList("numbers")
      numbersList.insert(0, 1)
      numbersList.insert(1, 2)
      numbersList.insert(2, 3)

      const typedDoc = createTypedDoc(schema, loroDoc)
      const json = typedDoc.toJSON()

      expect(json.numbers).toEqual([1, 2, 3])
      expect(json.strings).toEqual([])
    })

    it("should handle record containing list with nested placeholders", () => {
      const schema = Shape.doc({
        usersByDept: Shape.record(
          Shape.list(
            Shape.struct({
              name: Shape.plain.string(),
              salary: Shape.plain.number().placeholder(50000),
            }),
          ),
        ),
      })

      const loroDoc = new LoroDoc()
      const recordMap = loroDoc.getMap("usersByDept")
      const engList = recordMap.setContainer("engineering", new LoroList())
      const userMap = engList.insertContainer(0, new LoroMap())
      userMap.set("name", "Charlie")
      // Note: 'salary' is NOT set

      const typedDoc = createTypedDoc(schema, loroDoc)
      const json = typedDoc.toJSON()

      expect(json.usersByDept.engineering[0].name).toBe("Charlie")
      expect(json.usersByDept.engineering[0].salary).toBe(50000)
    })
  })

  /**
   * Regression tests for null value preservation in mergeValue().
   *
   * The nullish coalescing operator (??) treats null as a nullish value,
   * but in CRDT systems null is a valid intentional value that should be
   * preserved. Only undefined should trigger fallback to placeholder.
   *
   * @see https://github.com/loro-dev/loro-extended/issues/XXX
   */
  describe("Null value preservation", () => {
    it("should preserve null when crdtValue is null and placeholder is empty string", () => {
      const shape = Shape.plain.union([
        Shape.plain.string(),
        Shape.plain.null(),
      ])
      const crdtValue = null
      const placeholderValue = ""

      const result = mergeValue(shape, crdtValue, placeholderValue)

      expect(result).toBeNull()
    })

    it("should return placeholder when crdtValue is undefined", () => {
      const shape = Shape.plain.union([
        Shape.plain.string(),
        Shape.plain.null(),
      ])
      const crdtValue = undefined
      const placeholderValue = ""

      const result = mergeValue(shape, crdtValue as any, placeholderValue)

      expect(result).toBe("")
    })

    it("should preserve null in nested map properties", () => {
      const schema = Shape.doc({
        data: Shape.struct({
          value: Shape.plain.union([Shape.plain.string(), Shape.plain.null()]),
        }),
      })

      const loroDoc = new LoroDoc()
      const dataMap = loroDoc.getMap("data")
      dataMap.set("value", null)

      const typedDoc = createTypedDoc(schema, loroDoc)
      const json = typedDoc.toJSON()

      expect(json.data.value).toBeNull()
    })

    it("should preserve null values in LoroMap toJSON", () => {
      const doc = new LoroDoc()
      const map = doc.getMap("test")
      map.set("key", null)

      const json = map.toJSON()

      expect(json).toHaveProperty("key")
      expect(json.key).toBeNull()
    })

    it("should preserve null values in nested maps via list toJSON", () => {
      const doc = new LoroDoc()
      const list = doc.getList("list")
      const map = list.insertContainer(0, new LoroMap())
      map.set("key", null)

      const json = list.toJSON()

      expect(json[0]).toHaveProperty("key")
      expect(json[0].key).toBeNull()
    })
  })
})
