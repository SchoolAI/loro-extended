/**
 * Integration tests for Schema Migration
 *
 * These tests simulate realistic app lifecycle scenarios where:
 * 1. V1 Phase: App uses V1 schema, creates data using typedDoc.change()
 * 2. V2 Phase: App upgrades to V2 schema (with migration), old V1 data is automatically transformed
 *
 * This demonstrates the full workflow of schema migration as described
 * in the schema-migration-plan.md document.
 */

import { describe, expect, it } from "vitest"
import { Shape } from "./shape.js"
import { createTypedDoc, TypedDoc } from "./typed-doc.js"

describe("Schema Migration Integration", () => {
  describe("Case 1: Simple Key Remapping (messages field)", () => {
    /**
     * Scenario: A chat app evolves its message storage from simple text to structured objects.
     *
     * V1: messages stored as Shape.list(Shape.text()) at key "messages"
     * V2: messages stored as Shape.list(Shape.map({type, content})) at key "_v2_messages"
     *     with migration from V1
     */

    it("should migrate V1 data to V2 format when upgrading schema", () => {
      // === V1 PHASE: App uses original schema ===
      const ChatSchemaV1 = Shape.doc({
        title: Shape.text(),
        messages: Shape.list(Shape.text()),
      })

      // Create V1 document and add data using typed API
      const v1Doc = createTypedDoc(ChatSchemaV1)
      v1Doc.change(draft => {
        draft.title.insert(0, "My Chat")
        draft.messages.push("Hello from V1")
        draft.messages.push("Another V1 message")
      })

      // Verify V1 data
      expect(v1Doc.toJSON()).toEqual({
        title: "My Chat",
        messages: ["Hello from V1", "Another V1 message"],
      })

      // === V2 PHASE: App upgrades to new schema with migration ===
      const ChatSchemaV2 = Shape.doc({
        title: Shape.text(),
        messages: Shape.list(
          Shape.map({
            type: Shape.plain.string(),
            content: Shape.plain.string(),
          }),
        )
          .key("_v2_messages")
          .migrateFrom({
            key: "messages", // V1 used "messages" as the key
            sourceShape: Shape.list(Shape.text()),
            transform: (v1Data: string[]) =>
              v1Data.map(text => ({ type: "text", content: text })),
          }),
      })

      // Load the same underlying LoroDoc with V2 schema
      const v2Doc = new TypedDoc(ChatSchemaV2, v1Doc.loroDoc)
      const v2Json = v2Doc.toJSON()

      // V1 messages should be automatically transformed to V2 format
      expect(v2Json.title).toBe("My Chat")
      expect(v2Json.messages).toHaveLength(2)
      expect(v2Json.messages[0]).toEqual({
        type: "text",
        content: "Hello from V1",
      })
      expect(v2Json.messages[1]).toEqual({
        type: "text",
        content: "Another V1 message",
      })
    })

    it("should write new data to V2 storage key after migration", () => {
      // === V1 PHASE ===
      const ChatSchemaV1 = Shape.doc({
        messages: Shape.list(Shape.text()),
      })

      const v1Doc = createTypedDoc(ChatSchemaV1)
      v1Doc.change(draft => {
        draft.messages.push("V1 message")
      })

      // === V2 PHASE ===
      const ChatSchemaV2 = Shape.doc({
        messages: Shape.list(
          Shape.map({
            type: Shape.plain.string(),
            content: Shape.plain.string(),
          }),
        )
          .key("_v2_messages")
          .migrateFrom({
            key: "messages",
            sourceShape: Shape.list(Shape.text()),
            transform: (v1Data: string[]) =>
              v1Data.map(text => ({ type: "text", content: text })),
          }),
      })

      const v2Doc = new TypedDoc(ChatSchemaV2, v1Doc.loroDoc)

      // Add new data using V2 schema
      v2Doc.change(draft => {
        draft.messages.push({ type: "image", content: "photo.jpg" })
      })

      // Verify new data is written to V2 storage key
      const rawValue = v2Doc.loroDoc.toJSON()
      expect(rawValue._v2_messages).toBeDefined()
      expect(rawValue._v2_messages).toHaveLength(2) // 1 migrated + 1 new

      // Verify via typed API
      const json = v2Doc.toJSON()
      expect(json.messages).toHaveLength(2)
      expect(json.messages[0]).toEqual({ type: "text", content: "V1 message" })
      expect(json.messages[1]).toEqual({ type: "image", content: "photo.jpg" })
    })

    it("should prefer V2 data over V1 when both exist", () => {
      // === V1 PHASE ===
      const ChatSchemaV1 = Shape.doc({
        messages: Shape.list(Shape.text()),
      })

      const v1Doc = createTypedDoc(ChatSchemaV1)
      v1Doc.change(draft => {
        draft.messages.push("V1 message that should be ignored")
      })

      // === V2 PHASE: Simulate a scenario where V2 data already exists ===
      // (e.g., another client already migrated and synced)
      const ChatSchemaV2 = Shape.doc({
        messages: Shape.list(
          Shape.map({
            type: Shape.plain.string(),
            content: Shape.plain.string(),
          }),
        )
          .key("_v2_messages")
          .migrateFrom({
            key: "messages",
            sourceShape: Shape.list(Shape.text()),
            transform: (v1Data: string[]) =>
              v1Data.map(text => ({ type: "text", content: text })),
          }),
      })

      // First, trigger migration by reading
      const v2Doc = new TypedDoc(ChatSchemaV2, v1Doc.loroDoc)
      v2Doc.toJSON() // This triggers migration

      // Now add more V2 data
      v2Doc.change(draft => {
        draft.messages.push({ type: "text", content: "V2 message" })
      })

      // Create a fresh V2 doc from the same loroDoc
      const v2DocFresh = new TypedDoc(ChatSchemaV2, v1Doc.loroDoc)
      const json = v2DocFresh.toJSON()

      // Should have both migrated V1 data and new V2 data
      expect(json.messages).toHaveLength(2)
      expect(json.messages[0]).toEqual({
        type: "text",
        content: "V1 message that should be ignored",
      })
      expect(json.messages[1]).toEqual({ type: "text", content: "V2 message" })
    })
  })

  describe("Case 2: Type Transformation (text -> blocks)", () => {
    /**
     * Scenario: A document editor evolves from simple text to block-based content.
     *
     * V1: content stored as Shape.text() at key "content"
     * V2: content stored as Shape.list(Shape.map({type, text})) at key "_v2_blocks"
     */

    it("should transform text content to block structure", () => {
      // === V1 PHASE ===
      const DocumentSchemaV1 = Shape.doc({
        content: Shape.text(),
      })

      const v1Doc = createTypedDoc(DocumentSchemaV1)
      v1Doc.change(draft => {
        draft.content.insert(0, "This is the original document content.")
      })

      expect(v1Doc.toJSON().content).toBe(
        "This is the original document content.",
      )

      // === V2 PHASE ===
      const DocumentSchemaV2 = Shape.doc({
        content: Shape.list(
          Shape.map({
            type: Shape.plain.string(),
            text: Shape.plain.string(),
          }),
        )
          .key("_v2_blocks")
          .migrateFrom({
            key: "content",
            sourceShape: Shape.text(),
            transform: (v1Content: string) => [
              { type: "paragraph", text: v1Content },
            ],
          }),
      })

      const v2Doc = new TypedDoc(DocumentSchemaV2, v1Doc.loroDoc)
      const json = v2Doc.toJSON()

      expect(json.content).toHaveLength(1)
      expect(json.content[0]).toEqual({
        type: "paragraph",
        text: "This is the original document content.",
      })
    })

    it("should allow adding new blocks after migration", () => {
      // === V1 PHASE ===
      const DocumentSchemaV1 = Shape.doc({
        content: Shape.text(),
      })

      const v1Doc = createTypedDoc(DocumentSchemaV1)
      v1Doc.change(draft => {
        draft.content.insert(0, "Original paragraph")
      })

      // === V2 PHASE ===
      const DocumentSchemaV2 = Shape.doc({
        content: Shape.list(
          Shape.map({
            type: Shape.plain.string(),
            text: Shape.plain.string(),
          }),
        )
          .key("_v2_blocks")
          .migrateFrom({
            key: "content",
            sourceShape: Shape.text(),
            transform: (v1Content: string) => [
              { type: "paragraph", text: v1Content },
            ],
          }),
      })

      const v2Doc = new TypedDoc(DocumentSchemaV2, v1Doc.loroDoc)

      // Add new blocks
      v2Doc.change(draft => {
        draft.content.push({ type: "heading", text: "New Section" })
        draft.content.push({ type: "paragraph", text: "More content here." })
      })

      const json = v2Doc.toJSON()
      expect(json.content).toHaveLength(3)
      expect(json.content[0]).toEqual({
        type: "paragraph",
        text: "Original paragraph",
      })
      expect(json.content[1]).toEqual({ type: "heading", text: "New Section" })
      expect(json.content[2]).toEqual({
        type: "paragraph",
        text: "More content here.",
      })
    })
  })

  describe("Case 3: Full Three-Phase Migration with Task List (V1 -> V2 -> V3)", () => {
    /**
     * Scenario: A task app with a LIST of tasks evolves through incompatible type changes.
     * Tasks are added at different schema versions, and when reading with V3 schema,
     * ALL tasks (from V1, V2, and V3) should be readable as V3 tasks.
     *
     * V1: tasks stored as list of {title, priority: number (1-5)}
     * V2: tasks stored as list of {title, priority: text ("low"/"medium"/"high")}
     * V3: tasks stored as list of {title, priority: {level, urgent}}
     *
     * The key insight: each task in the list may have been created at a different
     * schema version, and they all need to coalesce into V3 format.
     */

    // Task shape for V1: priority is a number 1-5
    const TaskV1Shape = Shape.map({
      title: Shape.plain.string(),
      priority: Shape.plain.number(),
    })

    // Task shape for V2: priority is text, with migration from V1
    const TaskV2Shape = Shape.map({
      title: Shape.plain.string(),
      priority: Shape.text()
        .key("priority_v2")
        .migrateFrom({
          key: "priority",
          sourceShape: Shape.plain.number(),
          transform: (v1Priority: number) =>
            v1Priority <= 2 ? "low" : v1Priority <= 4 ? "medium" : "high",
        }),
    })

    // Task shape for V3: priority is an object, with migrations from V2 and V1
    const TaskV3Shape = Shape.map({
      title: Shape.plain.string(),
      priority: Shape.map({
        level: Shape.plain.string("low", "medium", "high"),
        urgent: Shape.plain.boolean(),
      })
        .key("priority_v3")
        .migrateFrom({
          key: "priority_v2",
          sourceShape: Shape.text(),
          transform: (v2Level: string) => ({
            level: v2Level as "low" | "medium" | "high",
            urgent: v2Level === "high",
          }),
        })
        .migrateFrom({
          key: "priority",
          sourceShape: Shape.plain.number(),
          transform: (v1Priority: number) => {
            const level =
              v1Priority <= 2 ? "low" : v1Priority <= 4 ? "medium" : "high"
            return {
              level: level as "low" | "medium" | "high",
              urgent: v1Priority === 5,
            }
          },
        }),
    })

    it("should coalesce tasks from all schema versions into V3 format", () => {
      // ============================================
      // === V1 PHASE: App launches with V1 schema ===
      // ============================================
      const TaskListSchemaV1 = Shape.doc({
        tasks: Shape.list(TaskV1Shape),
      })

      const doc = createTypedDoc(TaskListSchemaV1)

      // Add tasks using V1 schema
      doc.change(draft => {
        draft.tasks.push({ title: "V1 Task - Low Priority", priority: 1 })
        draft.tasks.push({ title: "V1 Task - Medium Priority", priority: 3 })
        draft.tasks.push({ title: "V1 Task - Urgent!", priority: 5 })
      })

      // Verify V1 data
      expect(doc.toJSON().tasks).toHaveLength(3)
      expect(doc.toJSON().tasks[0].priority).toBe(1)
      expect(doc.toJSON().tasks[1].priority).toBe(3)
      expect(doc.toJSON().tasks[2].priority).toBe(5)

      // ============================================
      // === V2 PHASE: App upgrades to V2 schema ===
      // ============================================
      const TaskListSchemaV2 = Shape.doc({
        tasks: Shape.list(TaskV2Shape),
      })

      // Load existing doc with V2 schema
      const v2Doc = new TypedDoc(TaskListSchemaV2, doc.loroDoc)

      // Verify V1 tasks are readable as V2 (migrated on read)
      const v2Tasks = v2Doc.toJSON().tasks
      expect(v2Tasks).toHaveLength(3)
      expect(v2Tasks[0].priority).toBe("low") // 1 -> "low"
      expect(v2Tasks[1].priority).toBe("medium") // 3 -> "medium"
      expect(v2Tasks[2].priority).toBe("high") // 5 -> "high"

      // Add NEW tasks using V2 schema
      // Note: When pushing to a list with text containers, we provide the initial text value
      v2Doc.change(draft => {
        draft.tasks.push({ title: "V2 Task - Low", priority: "low" })
        draft.tasks.push({ title: "V2 Task - High", priority: "high" })
      })

      // Verify we now have 5 tasks
      expect(v2Doc.toJSON().tasks).toHaveLength(5)

      // ============================================
      // === V3 PHASE: App upgrades to V3 schema ===
      // ============================================
      const TaskListSchemaV3 = Shape.doc({
        tasks: Shape.list(TaskV3Shape),
      })

      // Load existing doc with V3 schema
      const v3Doc = new TypedDoc(TaskListSchemaV3, doc.loroDoc)

      // Add NEW tasks using V3 schema
      v3Doc.change(draft => {
        draft.tasks.push({
          title: "V3 Task - Custom Urgent",
          priority: { level: "medium", urgent: true }, // medium but still urgent
        })
      })

      // Verify final state: 6 tasks from 3 different schema versions
      const finalTasks = v3Doc.toJSON().tasks
      expect(finalTasks).toHaveLength(6)

      // V1 tasks (migrated V1 -> V3)
      expect(finalTasks[0]).toEqual({
        title: "V1 Task - Low Priority",
        priority: { level: "low", urgent: false },
      })
      expect(finalTasks[1]).toEqual({
        title: "V1 Task - Medium Priority",
        priority: { level: "medium", urgent: false },
      })
      expect(finalTasks[2]).toEqual({
        title: "V1 Task - Urgent!",
        priority: { level: "high", urgent: true }, // priority 5 -> urgent
      })

      // V2 tasks (migrated V2 -> V3)
      expect(finalTasks[3]).toEqual({
        title: "V2 Task - Low",
        priority: { level: "low", urgent: false },
      })
      expect(finalTasks[4]).toEqual({
        title: "V2 Task - High",
        priority: { level: "high", urgent: true }, // "high" -> urgent
      })

      expect(finalTasks[5]).toEqual({
        title: "V3 Task - Custom Urgent",
        priority: { level: "medium", urgent: true },
      })
    })

    it("should handle direct V1 -> V3 upgrade (skipping V2)", () => {
      // Scenario: User never ran V2, upgrades directly from V1 to V3

      // === V1 PHASE ===
      const TaskListSchemaV1 = Shape.doc({
        tasks: Shape.list(TaskV1Shape),
      })

      const doc = createTypedDoc(TaskListSchemaV1)
      doc.change(draft => {
        draft.tasks.push({ title: "Old Task 1", priority: 2 })
        draft.tasks.push({ title: "Old Task 2", priority: 4 })
        draft.tasks.push({ title: "Old Task 3", priority: 5 })
      })

      // === V3 PHASE (skipping V2) ===
      const TaskListSchemaV3 = Shape.doc({
        tasks: Shape.list(TaskV3Shape),
      })

      const v3Doc = new TypedDoc(TaskListSchemaV3, doc.loroDoc)
      const tasks = v3Doc.toJSON().tasks

      expect(tasks).toHaveLength(3)
      expect(tasks[0].priority).toEqual({ level: "low", urgent: false }) // 2 -> low
      expect(tasks[1].priority).toEqual({ level: "medium", urgent: false }) // 4 -> medium
      expect(tasks[2].priority).toEqual({ level: "high", urgent: true }) // 5 -> high, urgent
    })

    it("should allow modifying migrated tasks with V3 schema", () => {
      // === V1 PHASE ===
      const TaskListSchemaV1 = Shape.doc({
        tasks: Shape.list(TaskV1Shape),
      })

      const doc = createTypedDoc(TaskListSchemaV1)
      doc.change(draft => {
        draft.tasks.push({ title: "Task to modify", priority: 3 })
      })

      // === V3 PHASE ===
      const TaskListSchemaV3 = Shape.doc({
        tasks: Shape.list(TaskV3Shape),
      })

      const v3Doc = new TypedDoc(TaskListSchemaV3, doc.loroDoc)

      // Verify initial migration
      expect(v3Doc.toJSON().tasks[0].priority).toEqual({
        level: "medium",
        urgent: false,
      })

      // Modify the migrated task using V3 schema
      v3Doc.change(draft => {
        const task = draft.tasks.get(0)
        if (task) {
          task.title = "Modified task"
          task.priority.urgent = true // Make it urgent
        }
      })

      // Verify modifications
      const modifiedTask = v3Doc.toJSON().tasks[0]
      expect(modifiedTask.title).toBe("Modified task")
      expect(modifiedTask.priority.level).toBe("medium")
      expect(modifiedTask.priority.urgent).toBe(true)
    })

    it("should preserve task order across migrations", () => {
      // === V1 PHASE ===
      const TaskListSchemaV1 = Shape.doc({
        tasks: Shape.list(TaskV1Shape),
      })

      const doc = createTypedDoc(TaskListSchemaV1)
      doc.change(draft => {
        draft.tasks.push({ title: "First", priority: 1 })
        draft.tasks.push({ title: "Second", priority: 2 })
      })

      // === V2 PHASE ===
      const TaskListSchemaV2 = Shape.doc({
        tasks: Shape.list(TaskV2Shape),
      })

      const v2Doc = new TypedDoc(TaskListSchemaV2, doc.loroDoc)
      v2Doc.change(draft => {
        draft.tasks.push({ title: "Third", priority: "medium" } as any)
      })

      // === V3 PHASE ===
      const TaskListSchemaV3 = Shape.doc({
        tasks: Shape.list(TaskV3Shape),
      })

      const v3Doc = new TypedDoc(TaskListSchemaV3, doc.loroDoc)
      v3Doc.change(draft => {
        draft.tasks.push({
          title: "Fourth",
          priority: { level: "high", urgent: true },
        })
      })

      // Verify order is preserved
      const tasks = v3Doc.toJSON().tasks
      expect(tasks.map(t => t.title)).toEqual([
        "First",
        "Second",
        "Third",
        "Fourth",
      ])
    })
  })

  describe("Case 4: Nested Migration", () => {
    /**
     * Scenario: An article app has nested metadata that evolves.
     *
     * V1: article.metadata.viewCount stored as plain number
     * V2: article.metadata.views stored as counter (for collaborative increment)
     */

    it("should handle migrations in nested map structures", () => {
      // === V1 PHASE ===
      const ArticleSchemaV1 = Shape.doc({
        article: Shape.map({
          title: Shape.text(),
          metadata: Shape.map({
            viewCount: Shape.plain.number(),
          }),
        }),
      })

      const v1Doc = createTypedDoc(ArticleSchemaV1)
      v1Doc.change(draft => {
        draft.article.title.insert(0, "My Article")
        draft.article.metadata.viewCount = 42
      })

      expect(v1Doc.toJSON().article.metadata.viewCount).toBe(42)

      // === V2 PHASE ===
      const ArticleSchemaV2 = Shape.doc({
        article: Shape.map({
          title: Shape.text(),
          metadata: Shape.map({
            views: Shape.counter()
              .key("_v2_views")
              .migrateFrom({
                key: "viewCount",
                sourceShape: Shape.plain.number(),
                transform: (v1: number) => v1,
              }),
          }),
        }),
      })

      const v2Doc = new TypedDoc(ArticleSchemaV2, v1Doc.loroDoc)
      const json = v2Doc.toJSON()

      expect(json.article.title).toBe("My Article")
      expect(json.article.metadata.views).toBe(42)

      // Now we can use counter operations
      v2Doc.change(draft => {
        draft.article.metadata.views.increment(10)
      })

      expect(v2Doc.toJSON().article.metadata.views).toBe(52)
    })
  })

  describe("Placeholder Integration with Migration", () => {
    it("should use placeholder when no data exists (neither V1 nor V2)", () => {
      // Start with V2 schema directly (no V1 data exists)
      const ChatSchemaV2 = Shape.doc({
        messages: Shape.list(
          Shape.map({
            type: Shape.plain.string(),
            content: Shape.plain.string(),
          }),
        )
          .key("_v2_messages")
          .migrateFrom({
            key: "messages",
            sourceShape: Shape.list(Shape.text()),
            transform: (v1Data: string[]) =>
              v1Data.map(text => ({ type: "text", content: text })),
          }),
      })

      const doc = createTypedDoc(ChatSchemaV2)
      const json = doc.toJSON()

      // Should use placeholder (empty array for lists)
      expect(json.messages).toEqual([])
    })

    it("should preserve placeholder defaults for missing nested fields after migration", () => {
      // === V1 PHASE ===
      const UserSchemaV1 = Shape.doc({
        profile: Shape.map({
          name: Shape.plain.string(),
        }),
      })

      const v1Doc = createTypedDoc(UserSchemaV1)
      v1Doc.change(draft => {
        draft.profile.name = "Alice"
      })

      // === V2 PHASE: Added email and role fields ===
      const UserSchemaV2 = Shape.doc({
        profile: Shape.map({
          name: Shape.plain.string().placeholder("Anonymous"),
          email: Shape.plain.string().placeholder(""),
          role: Shape.plain.string().placeholder("guest"),
        })
          .key("_v2_profile")
          .migrateFrom({
            key: "profile",
            sourceShape: Shape.plain.object({
              name: Shape.plain.string(),
            }),
            transform: (v1: { name: string }) => ({
              name: v1.name,
              email: "",
              role: "guest",
            }),
          }),
      })

      const v2Doc = new TypedDoc(UserSchemaV2, v1Doc.loroDoc)
      const json = v2Doc.toJSON()

      expect(json.profile.name).toBe("Alice")
      expect(json.profile.email).toBe("")
      expect(json.profile.role).toBe("guest")
    })
  })

  describe("No Migration (baseline behavior)", () => {
    it("should work normally without any migration configuration", () => {
      const SimpleSchema = Shape.doc({
        title: Shape.text(),
        count: Shape.counter(),
      })

      const doc = createTypedDoc(SimpleSchema)

      doc.change(draft => {
        draft.title.insert(0, "Hello")
        draft.count.increment(5)
      })

      // Writes go to logical keys (no migration configured)
      const rawValue = doc.loroDoc.toJSON()
      expect(rawValue.title).toBe("Hello")
      expect(rawValue.count).toBe(5)

      // Verify the data is accessible via the typed API
      const json = doc.toJSON()
      expect(json.title).toBe("Hello")
      expect(json.count).toBe(5)
    })
  })
})
