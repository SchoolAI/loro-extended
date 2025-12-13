import { describe, expect, it } from "vitest"
import { change } from "../src/functional-helpers.js"
import { Shape } from "../src/shape.js"
import { createTypedDoc } from "../src/typed-doc.js"

// --- Item ---
const ItemStateSchema = Shape.list(
  Shape.map({
    name: Shape.plain.string(),
    status: Shape.plain.union([
      Shape.plain.string(),
      Shape.plain.number(),
      Shape.plain.boolean(),
      Shape.plain.null(),
    ]),
  }),
)

const ItemSchema = Shape.map({
  name: Shape.plain.string(),
  description: Shape.plain.string(),
  imageUrl: Shape.plain.union([Shape.plain.string(), Shape.plain.null()]),
  quantity: Shape.map({
    measure: Shape.plain.number(),
    units: Shape.plain.union([Shape.plain.string(), Shape.plain.null()]),
  }),
  state: ItemStateSchema,
})

// --- Inventory ---
const InventoryItemSchema = Shape.map({
  item: ItemSchema,
  heldAt: Shape.plain.string(),
})

// --- Character ---
const CharacterSchema = Shape.map({
  name: Shape.plain.string(),
  sensoryDescription: Shape.plain.string(),
  hiddenBackgroundStory: Shape.plain.string(),
  isInParty: Shape.plain.boolean(),
  locationName: Shape.plain.string(),
})

// --- Map ---
const MapLocationSchema = Shape.map({
  name: Shape.plain.string(),
  description: Shape.plain.string(),
  creationContext: Shape.plain.string(),
  items: Shape.list(ItemSchema),
})

// Connections are simple tuples. We use a List container for [string, string].
const MapConnectionSchema = Shape.list(Shape.plain.string())

const WorldMapSchema = Shape.map({
  locations: Shape.list(MapLocationSchema),
  connections: Shape.list(MapConnectionSchema),
})

// --- Timeline ---
const TimelineEventSchema = Shape.map({
  id: Shape.plain.string(),
  role: Shape.plain.string(), // "system" | "assistant" | "user"
  content: Shape.text(), // LoroText for streaming
  timestamp: Shape.plain.number(),
})

// --- Meta (Global State) ---
const MetaSchema = Shape.map({
  playerLocationName: Shape.plain
    .union([Shape.plain.null(), Shape.plain.string()])
    .placeholder(null),
  worldMood: Shape.plain.string().placeholder("peace"), // "peace" | "rising-tensions" | "falling-tensions"
  currentAct: Shape.plain.string().placeholder("hook"), // "hook" | ...
  flourish: Shape.plain.string().placeholder("normal"), // "normal" | "brief"
})

// --- World State ---
const WorldStateSchema = Shape.doc({
  inventory: Shape.list(InventoryItemSchema),
  map: WorldMapSchema,
  characters: Shape.list(CharacterSchema),
  timeline: Shape.list(TimelineEventSchema),
  meta: MetaSchema,
})

// --- Expected Initial State (derived from schema placeholders) ---
const expectedInitialState = {
  inventory: [],
  map: {
    locations: [],
    connections: [],
  },
  characters: [],
  timeline: [],
  meta: {
    playerLocationName: null,
    worldMood: "peace",
    currentAct: "hook",
    flourish: "normal",
  },
}

describe("WorldStateSchema", () => {
  describe("Schema Creation and Initialization", () => {
    it("should create a typed document with initial empty state", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      expect(typedDoc.toJSON()).toEqual(expectedInitialState)
    })

    it("should have correct initial meta values", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      expect(typedDoc.toJSON().meta.playerLocationName).toBeNull()
      expect(typedDoc.toJSON().meta.worldMood).toBe("peace")
      expect(typedDoc.toJSON().meta.currentAct).toBe("hook")
      expect(typedDoc.toJSON().meta.flourish).toBe("normal")
    })

    it("should have empty collections initially", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      expect(typedDoc.toJSON().inventory).toHaveLength(0)
      expect(typedDoc.toJSON().map.locations).toHaveLength(0)
      expect(typedDoc.toJSON().map.connections).toHaveLength(0)
      expect(typedDoc.toJSON().characters).toHaveLength(0)
      expect(typedDoc.toJSON().timeline).toHaveLength(0)
    })
  })

  describe("Meta Operations", () => {
    it("should update playerLocationName from null to string", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.meta.set("playerLocationName", "Starting Village")
      }).toJSON()

      expect(result.meta.playerLocationName).toBe("Starting Village")
    })

    it("should update playerLocationName back to null", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      change(typedDoc, draft => {
        draft.meta.set("playerLocationName", "Starting Village")
      })

      const result = change(typedDoc, draft => {
        draft.meta.set("playerLocationName", null)
      }).toJSON()

      expect(result.meta.playerLocationName).toBeNull()
    })

    it("should update worldMood", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.meta.set("worldMood", "rising-tensions")
      }).toJSON()

      expect(result.meta.worldMood).toBe("rising-tensions")
    })

    it("should update currentAct", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.meta.set("currentAct", "confrontation")
      }).toJSON()

      expect(result.meta.currentAct).toBe("confrontation")
    })

    it("should update flourish", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.meta.set("flourish", "brief")
      }).toJSON()

      expect(result.meta.flourish).toBe("brief")
    })
  })

  describe("Character Operations", () => {
    it("should add a character", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.characters.push({
          name: "Hero",
          sensoryDescription: "A brave adventurer with a determined look",
          hiddenBackgroundStory: "Once a simple farmer, now seeking glory",
          isInParty: true,
          locationName: "Starting Village",
        })
      }).toJSON()

      expect(result.characters).toHaveLength(1)
      expect(result.characters[0].name).toBe("Hero")
      expect(result.characters[0].isInParty).toBe(true)
    })

    it("should add multiple characters", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.characters.push({
          name: "Hero",
          sensoryDescription: "A brave adventurer",
          hiddenBackgroundStory: "Secret past",
          isInParty: true,
          locationName: "Village",
        })
        draft.characters.push({
          name: "Merchant",
          sensoryDescription: "A shrewd trader",
          hiddenBackgroundStory: "Former thief",
          isInParty: false,
          locationName: "Market",
        })
      }).toJSON()

      expect(result.characters).toHaveLength(2)
      expect(result.characters[0].name).toBe("Hero")
      expect(result.characters[1].name).toBe("Merchant")
    })

    it("should find and modify a character", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      change(typedDoc, draft => {
        draft.characters.push({
          name: "Hero",
          sensoryDescription: "A brave adventurer",
          hiddenBackgroundStory: "Secret past",
          isInParty: true,
          locationName: "Village",
        })
      })

      const result = change(typedDoc, draft => {
        const hero = draft.characters.find(c => c.name === "Hero")
        if (hero) {
          hero.locationName = "Forest"
          hero.isInParty = false
        }
      }).toJSON()

      expect(result.characters[0].locationName).toBe("Forest")
      expect(result.characters[0].isInParty).toBe(false)
    })

    it("should delete a character", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      change(typedDoc, draft => {
        draft.characters.push({
          name: "Hero",
          sensoryDescription: "A brave adventurer",
          hiddenBackgroundStory: "Secret past",
          isInParty: true,
          locationName: "Village",
        })
        draft.characters.push({
          name: "Villain",
          sensoryDescription: "A dark figure",
          hiddenBackgroundStory: "Tragic backstory",
          isInParty: false,
          locationName: "Castle",
        })
      })

      const result = change(typedDoc, draft => {
        const villainIndex = draft.characters.findIndex(
          c => c.name === "Villain",
        )
        if (villainIndex !== -1) {
          draft.characters.delete(villainIndex, 1)
        }
      }).toJSON()

      expect(result.characters).toHaveLength(1)
      expect(result.characters[0].name).toBe("Hero")
    })
  })

  describe("Timeline Operations", () => {
    it("should add a timeline event with text content", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.timeline.push({
          id: "event-1",
          role: "system",
          content: "Welcome to the adventure!",
          timestamp: Date.now(),
        })
      }).toJSON()

      expect(result.timeline).toHaveLength(1)
      expect(result.timeline[0].id).toBe("event-1")
      expect(result.timeline[0].role).toBe("system")
      expect(result.timeline[0].content).toBe("Welcome to the adventure!")
    })

    it("should add multiple timeline events", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.timeline.push({
          id: "event-1",
          role: "system",
          content: "Game started",
          timestamp: 1000,
        })
        draft.timeline.push({
          id: "event-2",
          role: "user",
          content: "I look around",
          timestamp: 2000,
        })
        draft.timeline.push({
          id: "event-3",
          role: "assistant",
          content: "You see a vast forest ahead",
          timestamp: 3000,
        })
      }).toJSON()

      expect(result.timeline).toHaveLength(3)
      expect(result.timeline[0].role).toBe("system")
      expect(result.timeline[1].role).toBe("user")
      expect(result.timeline[2].role).toBe("assistant")
    })

    it("should modify timeline event content using text operations", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      change(typedDoc, draft => {
        draft.timeline.push({
          id: "event-1",
          role: "assistant",
          content: "Initial response",
          timestamp: 1000,
        })
      })

      const result = change(typedDoc, draft => {
        const event = draft.timeline.get(0)
        if (event) {
          event.content.update("Updated response with more detail")
        }
      }).toJSON()

      expect(result.timeline[0].content).toBe(
        "Updated response with more detail",
      )
    })

    it("should stream content to timeline event using text insert", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      change(typedDoc, draft => {
        draft.timeline.push({
          id: "event-1",
          role: "assistant",
          content: "",
          timestamp: 1000,
        })
      })

      // Simulate streaming by inserting text incrementally
      change(typedDoc, draft => {
        const event = draft.timeline.get(0)
        if (event) {
          event.content.insert(0, "Hello")
        }
      })

      change(typedDoc, draft => {
        const event = draft.timeline.get(0)
        if (event) {
          event.content.insert(5, " World")
        }
      })

      const result = change(typedDoc, draft => {
        const event = draft.timeline.get(0)
        if (event) {
          event.content.insert(11, "!")
        }
      }).toJSON()

      expect(result.timeline[0].content).toBe("Hello World!")
    })
  })

  describe("Map and Location Operations", () => {
    it("should add a location to the map", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.map.locations.push({
          name: "Starting Village",
          description: "A peaceful village at the edge of the forest",
          creationContext: "Initial game setup",
          items: [],
        })
      }).toJSON()

      expect(result.map.locations).toHaveLength(1)
      expect(result.map.locations[0].name).toBe("Starting Village")
    })

    it("should add multiple locations", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.map.locations.push({
          name: "Village",
          description: "A small village",
          creationContext: "Start",
          items: [],
        })
        draft.map.locations.push({
          name: "Forest",
          description: "A dark forest",
          creationContext: "Exploration",
          items: [],
        })
        draft.map.locations.push({
          name: "Castle",
          description: "An ancient castle",
          creationContext: "Quest destination",
          items: [],
        })
      }).toJSON()

      expect(result.map.locations).toHaveLength(3)
    })

    it("should add connections between locations", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        // Add locations first
        draft.map.locations.push({
          name: "Village",
          description: "A small village",
          creationContext: "Start",
          items: [],
        })
        draft.map.locations.push({
          name: "Forest",
          description: "A dark forest",
          creationContext: "Exploration",
          items: [],
        })

        // Add connection as [from, to] tuple
        draft.map.connections.push(["Village", "Forest"])
      }).toJSON()

      expect(result.map.connections).toHaveLength(1)
      expect(result.map.connections[0]).toEqual(["Village", "Forest"])
    })

    it("should add items to a location", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.map.locations.push({
          name: "Village",
          description: "A small village",
          creationContext: "Start",
          items: [
            {
              name: "Sword",
              description: "A rusty sword",
              imageUrl: null,
              quantity: { measure: 1, units: null },
              state: [],
            },
          ],
        })
      }).toJSON()

      expect(result.map.locations[0].items).toHaveLength(1)
      expect(result.map.locations[0].items[0].name).toBe("Sword")
    })

    it("should find and modify a location", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      change(typedDoc, draft => {
        draft.map.locations.push({
          name: "Village",
          description: "A small village",
          creationContext: "Start",
          items: [],
        })
      })

      const result = change(typedDoc, draft => {
        const village = draft.map.locations.find(loc => loc.name === "Village")
        if (village) {
          village.description = "A bustling village with a market"
        }
      }).toJSON()

      expect(result.map.locations[0].description).toBe(
        "A bustling village with a market",
      )
    })
  })

  describe("Inventory Operations", () => {
    it("should add an item to inventory", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.inventory.push({
          item: {
            name: "Health Potion",
            description: "Restores 50 HP",
            imageUrl: "https://example.com/potion.png",
            quantity: { measure: 3, units: "bottles" },
            state: [],
          },
          heldAt: "Backpack",
        })
      }).toJSON()

      expect(result.inventory).toHaveLength(1)
      expect(result.inventory[0].item.name).toBe("Health Potion")
      expect(result.inventory[0].heldAt).toBe("Backpack")
    })

    it("should handle item with null imageUrl", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.inventory.push({
          item: {
            name: "Gold Coin",
            description: "Shiny gold coin",
            imageUrl: null,
            quantity: { measure: 100, units: null },
            state: [],
          },
          heldAt: "Pouch",
        })
      }).toJSON()

      expect(result.inventory[0].item.imageUrl).toBeNull()
      expect(result.inventory[0].item.quantity.units).toBeNull()
    })

    it("should add item state with various status types", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.inventory.push({
          item: {
            name: "Magic Sword",
            description: "A sword with magical properties",
            imageUrl: null,
            quantity: { measure: 1, units: null },
            state: [
              { name: "enchanted", status: true },
              { name: "durability", status: 85 },
              { name: "element", status: "fire" },
              { name: "curse", status: null },
            ],
          },
          heldAt: "Hand",
        })
      }).toJSON()

      expect(result.inventory[0].item.state).toHaveLength(4)
      expect(result.inventory[0].item.state[0].status).toBe(true)
      expect(result.inventory[0].item.state[1].status).toBe(85)
      expect(result.inventory[0].item.state[2].status).toBe("fire")
      expect(result.inventory[0].item.state[3].status).toBeNull()
    })

    it("should find and modify inventory item", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      change(typedDoc, draft => {
        draft.inventory.push({
          item: {
            name: "Health Potion",
            description: "Restores HP",
            imageUrl: null,
            quantity: { measure: 5, units: "bottles" },
            state: [],
          },
          heldAt: "Backpack",
        })
      })

      const result = change(typedDoc, draft => {
        const potion = draft.inventory.find(
          inv => inv.item.name === "Health Potion",
        )
        if (potion) {
          potion.item.quantity.measure = 4 // Used one potion
        }
      }).toJSON()

      expect(result.inventory[0].item.quantity.measure).toBe(4)
    })

    it("should remove item from inventory", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      change(typedDoc, draft => {
        draft.inventory.push({
          item: {
            name: "Key",
            description: "A rusty key",
            imageUrl: null,
            quantity: { measure: 1, units: null },
            state: [],
          },
          heldAt: "Pocket",
        })
        draft.inventory.push({
          item: {
            name: "Map",
            description: "A treasure map",
            imageUrl: null,
            quantity: { measure: 1, units: null },
            state: [],
          },
          heldAt: "Backpack",
        })
      })

      const result = change(typedDoc, draft => {
        const keyIndex = draft.inventory.findIndex(
          inv => inv.item.name === "Key",
        )
        if (keyIndex !== -1) {
          draft.inventory.delete(keyIndex, 1)
        }
      }).toJSON()

      expect(result.inventory).toHaveLength(1)
      expect(result.inventory[0].item.name).toBe("Map")
    })
  })

  describe("Complex Scenarios", () => {
    it("should handle a complete game state update", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        // Add a location
        draft.map.locations.push({
          name: "Tavern",
          description: "A cozy tavern",
          creationContext: "Player entered town",
          items: [],
        })

        // Add a character
        draft.characters.push({
          name: "Innkeeper",
          sensoryDescription: "A friendly innkeeper",
          hiddenBackgroundStory: "Former adventurer",
          isInParty: false,
          locationName: "Tavern",
        })

        // Add to inventory
        draft.inventory.push({
          item: {
            name: "Room Key",
            description: "Key to room 3",
            imageUrl: null,
            quantity: { measure: 1, units: null },
            state: [],
          },
          heldAt: "Pocket",
        })

        // Add timeline event
        draft.timeline.push({
          id: "event-1",
          role: "assistant",
          content: "You enter the tavern and meet the innkeeper.",
          timestamp: Date.now(),
        })

        // Update meta
        draft.meta.set("playerLocationName", "Tavern")
      }).toJSON()

      expect(result.map.locations).toHaveLength(1)
      expect(result.characters).toHaveLength(1)
      expect(result.inventory).toHaveLength(1)
      expect(result.timeline).toHaveLength(1)
      expect(result.meta.playerLocationName).toBe("Tavern")
    })

    it("should persist state across multiple changes", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      // First change: setup
      change(typedDoc, draft => {
        draft.map.locations.push({
          name: "Village",
          description: "Starting point",
          creationContext: "Init",
          items: [],
        })
        draft.meta.set("playerLocationName", "Village")
      })

      // Second change: add character
      change(typedDoc, draft => {
        draft.characters.push({
          name: "Hero",
          sensoryDescription: "The player",
          hiddenBackgroundStory: "Unknown",
          isInParty: true,
          locationName: "Village",
        })
      })

      // Third change: add timeline
      change(typedDoc, draft => {
        draft.timeline.push({
          id: "event-1",
          role: "system",
          content: "Adventure begins",
          timestamp: 1000,
        })
      })

      // Verify all state persisted
      const finalState = typedDoc.toJSON()
      expect(finalState.map.locations).toHaveLength(1)
      expect(finalState.characters).toHaveLength(1)
      expect(finalState.timeline).toHaveLength(1)
      expect(finalState.meta.playerLocationName).toBe("Village")
    })

    it("should handle deeply nested item state modifications", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      change(typedDoc, draft => {
        draft.map.locations.push({
          name: "Dungeon",
          description: "A dark dungeon",
          creationContext: "Quest",
          items: [
            {
              name: "Treasure Chest",
              description: "A locked chest",
              imageUrl: null,
              quantity: { measure: 1, units: null },
              state: [
                { name: "locked", status: true },
                { name: "trapped", status: false },
              ],
            },
          ],
        })
      })

      const result = change(typedDoc, draft => {
        const dungeon = draft.map.locations.find(loc => loc.name === "Dungeon")
        if (dungeon) {
          const chest = dungeon.items.find(
            item => item.name === "Treasure Chest",
          )
          if (chest) {
            // Unlock the chest
            const lockedState = chest.state.find(s => s.name === "locked")
            if (lockedState) {
              lockedState.status = false
            }
          }
        }
      }).toJSON()

      expect(result.map.locations[0].items[0].state[0].status).toBe(false)
    })
  })

  describe("Edge Cases", () => {
    it("should handle empty strings in text fields", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.characters.push({
          name: "",
          sensoryDescription: "",
          hiddenBackgroundStory: "",
          isInParty: false,
          locationName: "",
        })
      }).toJSON()

      expect(result.characters[0].name).toBe("")
    })

    it("should handle special characters and unicode", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.characters.push({
          name: "Héro 英雄 🦸",
          sensoryDescription: "A hero with émojis 🌟",
          hiddenBackgroundStory: "秘密の過去",
          isInParty: true,
          locationName: "村 Village",
        })
      }).toJSON()

      expect(result.characters[0].name).toBe("Héro 英雄 🦸")
      expect(result.characters[0].sensoryDescription).toBe(
        "A hero with émojis 🌟",
      )
    })

    it("should handle large numbers in quantity", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.inventory.push({
          item: {
            name: "Gold",
            description: "Currency",
            imageUrl: null,
            quantity: { measure: 999999999, units: "coins" },
            state: [],
          },
          heldAt: "Bank",
        })
      }).toJSON()

      expect(result.inventory[0].item.quantity.measure).toBe(999999999)
    })

    it("should handle negative numbers in quantity", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.inventory.push({
          item: {
            name: "Debt",
            description: "Money owed",
            imageUrl: null,
            quantity: { measure: -500, units: "gold" },
            state: [],
          },
          heldAt: "Ledger",
        })
      }).toJSON()

      expect(result.inventory[0].item.quantity.measure).toBe(-500)
    })

    it("should handle floating point numbers in quantity", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.inventory.push({
          item: {
            name: "Water",
            description: "Fresh water",
            imageUrl: null,
            quantity: { measure: 2.5, units: "liters" },
            state: [],
          },
          heldAt: "Canteen",
        })
      }).toJSON()

      expect(result.inventory[0].item.quantity.measure).toBe(2.5)
    })

    it("should handle status with number 0", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.inventory.push({
          item: {
            name: "Broken Sword",
            description: "A broken sword",
            imageUrl: null,
            quantity: { measure: 1, units: null },
            state: [{ name: "durability", status: 0 }],
          },
          heldAt: "Ground",
        })
      }).toJSON()

      expect(result.inventory[0].item.state[0].status).toBe(0)
    })

    it("should handle status with empty string", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.inventory.push({
          item: {
            name: "Blank Scroll",
            description: "An empty scroll",
            imageUrl: null,
            quantity: { measure: 1, units: null },
            state: [{ name: "inscription", status: "" }],
          },
          heldAt: "Bag",
        })
      }).toJSON()

      expect(result.inventory[0].item.state[0].status).toBe("")
    })

    it("should handle status with false boolean", () => {
      const typedDoc = createTypedDoc(WorldStateSchema)

      const result = change(typedDoc, draft => {
        draft.inventory.push({
          item: {
            name: "Torch",
            description: "A torch",
            imageUrl: null,
            quantity: { measure: 1, units: null },
            state: [{ name: "lit", status: false }],
          },
          heldAt: "Hand",
        })
      }).toJSON()

      expect(result.inventory[0].item.state[0].status).toBe(false)
    })
  })
})
