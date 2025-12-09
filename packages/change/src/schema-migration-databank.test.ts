import { LoroDoc, LoroList, LoroMap, LoroText } from "loro-crdt"
import { describe, expect, it } from "vitest"
import { Shape } from "./shape.js"
import { TypedDoc } from "./typed-doc.js"

describe("Schema Migration Databank Scenarios", () => {
  /**
   * Case 4: Chat/Messaging Application
   * Migration: V4 -> V5 (Type Change: LoroText -> Discriminated Union)
   *
   * Scenario:
   * - V4: content is a LoroText (collaborative text)
   * - V5: content is a discriminated union (plain object) to support rich media
   *
   * Challenge:
   * - Converting CRDT container (Text) to Value (Object)
   * - Preserving text content during migration
   */
  describe("Case 4: Chat - Text to Rich Content Migration", () => {
    it("should migrate from LoroText to Discriminated Union", () => {
      // V5 Schema
      const ChatSchemaV5 = Shape.doc({
        messages: Shape.list(
          Shape.map({
            id: Shape.plain.string(),
            author: Shape.plain.string(),
            // New structure: discriminated union
            content: Shape.plain.discriminatedUnion("type", {
              text: Shape.plain.object({
                type: Shape.plain.string("text"),
                text: Shape.plain.string(),
              }),
              image: Shape.plain.object({
                type: Shape.plain.string("image"),
                url: Shape.plain.string(),
                alt: Shape.plain.string(),
              }),
            }),
          }),
        )
          .key("messages_v5")
          .migrateFrom({
            key: "messages_v4",
            // Source shape matches V4 structure
            sourceShape: Shape.list(
              Shape.map({
                id: Shape.plain.string(),
                author: Shape.plain.string(),
                content: Shape.text(), // Old content was LoroText
              }),
            ),
            transform: v4Messages => {
              return v4Messages.map(msg => ({
                id: msg.id,
                author: msg.author,
                content: {
                  type: "text",
                  text: msg.content, // LoroText becomes string
                },
              }))
            },
          }),
      })

      // Setup V4 Data
      const doc = new LoroDoc()
      const v4List = doc.getList("messages_v4")

      // Message 1
      const msg1 = v4List.insertContainer(0, new LoroMap())
      msg1.set("id", "msg-1")
      msg1.set("author", "Alice")
      const text1 = msg1.setContainer("content", new LoroText())
      text1.insert(0, "Hello world")

      // Message 2
      const msg2 = v4List.insertContainer(1, new LoroMap())
      msg2.set("id", "msg-2")
      msg2.set("author", "Bob")
      const text2 = msg2.setContainer("content", new LoroText())
      text2.insert(0, "Rich media coming soon")

      // Initialize TypedDoc with V5 schema
      const typedDoc = new TypedDoc(ChatSchemaV5, doc)
      const json = typedDoc.toJSON()

      // Verify Migration
      expect(json.messages).toHaveLength(2)

      expect(json.messages[0]).toEqual({
        id: "msg-1",
        author: "Alice",
        content: {
          type: "text",
          text: "Hello world",
        },
      })

      expect(json.messages[1]).toEqual({
        id: "msg-2",
        author: "Bob",
        content: {
          type: "text",
          text: "Rich media coming soon",
        },
      })

      // Verify we can write new V5 data (image)
      typedDoc.change(draft => {
        draft.messages.push({
          id: "msg-3",
          author: "Charlie",
          content: {
            type: "image",
            url: "https://example.com/image.png",
            alt: "A nice image",
          },
        })
      })

      const updatedJson = typedDoc.toJSON()
      expect(updatedJson.messages).toHaveLength(3)
      expect(updatedJson.messages[2].content.type).toBe("image")
    })
  })

  /**
   * Case 5: Kanban Board
   * Migration: V1 -> V2 (Container Change: List -> MovableList)
   *
   * Scenario:
   * - V1: cards are in a simple List (no reordering support)
   * - V2: cards are in a MovableList (supports reordering)
   *
   * Challenge:
   * - Changing container type requires creating new container
   * - Copying data from old container to new container
   */
  describe("Case 5: Kanban - List to MovableList Migration", () => {
    it("should migrate from List to MovableList", () => {
      // V2 Schema
      const KanbanSchemaV2 = Shape.doc({
        columns: Shape.list(
          Shape.map({
            name: Shape.plain.string(),
            // New container type: MovableList
            cards: Shape.movableList(
              Shape.map({
                title: Shape.plain.string(),
                description: Shape.text(),
              }),
            )
              .key("cards_v2")
              .migrateFrom({
                key: "cards_v1", // Old key was implicit in V1, but we simulate key change here
                sourceShape: Shape.list(
                  Shape.map({
                    title: Shape.plain.string(),
                    description: Shape.text(),
                  }),
                ),
                transform: v1Cards => {
                  // Transform List items to MovableList items
                  // Structure is same, just container type changes
                  return v1Cards.map(card => ({
                    title: card.title,
                    description: card.description,
                  }))
                },
              }),
          }),
        ),
      })

      // Setup V1 Data
      // Note: In V1, 'cards' was a List. In V2, we need to simulate that the old data
      // is at 'cards_v1' (or we'd need a way to migrate in-place which isn't supported yet).
      // For this test, we assume the parent map structure allows us to have both keys.

      const doc = new LoroDoc()
      const columns = doc.getList("columns")

      // Create a column
      const col1 = columns.insertContainer(0, new LoroMap())
      col1.set("name", "To Do")

      // Create V1 cards list (LoroList)
      const v1Cards = col1.setContainer("cards_v1", new LoroList())

      // Add Card 1
      const card1 = v1Cards.insertContainer(0, new LoroMap())
      card1.set("title", "Task 1")
      const desc1 = card1.setContainer("description", new LoroText())
      desc1.insert(0, "Description 1")

      // Add Card 2
      const card2 = v1Cards.insertContainer(1, new LoroMap())
      card2.set("title", "Task 2")
      const desc2 = card2.setContainer("description", new LoroText())
      desc2.insert(0, "Description 2")

      // Initialize TypedDoc
      const typedDoc = new TypedDoc(KanbanSchemaV2, doc)
      const json = typedDoc.toJSON()

      // Verify Migration
      expect(json.columns[0].cards).toHaveLength(2)
      expect(json.columns[0].cards[0].title).toBe("Task 1")
      expect(json.columns[0].cards[0].description).toBe("Description 1")
      expect(json.columns[0].cards[1].title).toBe("Task 2")

      // Verify we can perform MovableList operations on the migrated data
      // Note: The migration creates a new MovableList and populates it.
      // The TypedDoc should now be pointing to this new list.

      typedDoc.change(draft => {
        const cards = draft.columns.get(0).cards
        // Move Task 1 to end
        cards.move(0, 1)
      })

      const updatedJson = typedDoc.toJSON()
      expect(updatedJson.columns[0].cards[0].title).toBe("Task 2")
      expect(updatedJson.columns[0].cards[1].title).toBe("Task 1")
    })
  })
})
