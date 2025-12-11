
# Schema Migration Case Studies: A Comprehensive Databank

This document catalogs real-world schema evolution scenarios, their migration needs, and the data transformation paths required. Each case includes the schema progression, sample data at each version, and migration considerations.

---

## Case 1: Todo List Application

### Evolution Story
A simple todo app that grows to support collaboration, priorities, and rich metadata.

### Version 1: MVP
```typescript
const TodoSchemaV1 = Shape.doc({
  items: Shape.list(Shape.map({
    text: Shape.text(),
    done: Shape.plain.boolean(),
  })),
})
```

**Sample Data V1:**
```json
{
  "items": [
    { "text": "Buy groceries", "done": false },
    { "text": "Call mom", "done": true }
  ]
}
```

### Version 2: Add Priority and Due Dates
**Migration Need:** Users want to prioritize tasks and set deadlines.

```typescript
const TodoSchemaV2 = Shape.doc({
  items: Shape.list(Shape.map({
    text: Shape.text(),
    done: Shape.plain.boolean(),
    priority: Shape.plain.number().placeholder(0),  // NEW: 0=none, 1=low, 2=med, 3=high
    dueDate: Shape.plain.union([
      Shape.plain.null(),
      Shape.plain.string()
    ]).placeholder(null),  // NEW: ISO date string or null
  })),
})
```

**Migration Path V1→V2:**
```typescript
// Additive - no transformation needed
// V1 data works as-is, new fields get placeholders
{
  "items": [
    { "text": "Buy groceries", "done": false, "priority": 0, "dueDate": null },
    { "text": "Call mom", "done": true, "priority": 0, "dueDate": null }
  ]
}
```

**Classification:** ✅ Additive (P2P Safe)

### Version 3: Add Categories/Tags
**Migration Need:** Users want to organize tasks into categories.

```typescript
const TodoSchemaV3 = Shape.doc({
  items: Shape.list(Shape.map({
    text: Shape.text(),
    done: Shape.plain.boolean(),
    priority: Shape.plain.number().placeholder(0),
    dueDate: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]).placeholder(null),
    tags: Shape.list(Shape.plain.string()),  // NEW
  })),
  categories: Shape.list(Shape.map({  // NEW: category definitions
    id: Shape.plain.string(),
    name: Shape.plain.string(),
    color: Shape.plain.string().placeholder("#808080"),
  })),
})
```

**Migration Path V2→V3:**
```typescript
// Additive - no transformation needed
{
  "items": [
    { "text": "Buy groceries", "done": false, "priority": 0, "dueDate": null, "tags": [] }
  ],
  "categories": []
}
```

**Classification:** ✅ Additive (P2P Safe)

### Version 4: Add Unique IDs (Breaking Change)
**Migration Need:** Need stable IDs for sync, sharing, and deep linking.

```typescript
const TodoSchemaV4 = Shape.doc({
  items: Shape.list(Shape.map({
    id: Shape.plain.string(),  // NEW: required unique ID
    text: Shape.text(),
    done: Shape.plain.boolean(),
    priority: Shape.plain.number().placeholder(0),
    dueDate: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]).placeholder(null),
    tags: Shape.list(Shape.plain.string()),
    createdAt: Shape.plain.string(),  // NEW: ISO timestamp
    completedAt: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]).placeholder(null),  // NEW
  })),
  categories: Shape.list(Shape.map({
    id: Shape.plain.string(),
    name: Shape.plain.string(),
    color: Shape.plain.string().placeholder("#808080"),
  })),
})
```

**Migration Path V3→V4:**
```typescript
// BREAKING: Must generate IDs for existing items
const migrateV3ToV4 = (v3Data) => ({
  items: v3Data.items.map((item, index) => ({
    ...item,
    id: generateUUID(),  // or `item-${index}-${Date.now()}`
    createdAt: new Date().toISOString(),  // Best guess
    completedAt: item.done ? new Date().toISOString() : null,
  })),
  categories: v3Data.categories.map((cat, index) => ({
    ...cat,
    id: cat.id || generateUUID(),
  })),
})
```

**Sample Data V4:**
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "text": "Buy groceries",
      "done": false,
      "priority": 2,
      "dueDate": "2024-01-15",
      "tags": ["shopping", "weekly"],
      "createdAt": "2024-01-10T10:00:00Z",
      "completedAt": null
    }
  ],
  "categories": [
    { "id": "cat-1", "name": "Shopping", "color": "#4CAF50" }
  ]
}
```

**Classification:** ⚠️ Breaking (Server-Coordinated Only)

**P2P Challenge:** If Peer A migrates and generates ID "abc-123" for item 0, and Peer B migrates and generates ID "xyz-789" for the same item, they now have duplicate items with different IDs.

---

## Case 2: Collaborative Document Editor

### Evolution Story
A document editor that evolves from simple text to rich structured content.

### Version 1: Plain Text Document
```typescript
const DocSchemaV1 = Shape.doc({
  title: Shape.text(),
  content: Shape.text(),
})
```

**Sample Data V1:**
```json
{
  "title": "Meeting Notes",
  "content": "Discussed Q4 goals.\n\nAction items:\n- Review budget\n- Schedule follow-up"
}
```

### Version 2: Add Metadata
```typescript
const DocSchemaV2 = Shape.doc({
  title: Shape.text(),
  content: Shape.text(),
  metadata: Shape.map({
    createdAt: Shape.plain.string(),
    updatedAt: Shape.plain.string(),
    author: Shape.plain.string().placeholder("Anonymous"),
    tags: Shape.plain.array(Shape.plain.string()),
  }),
})
```

**Migration Path V1→V2:**
```typescript
// Additive with computed defaults
{
  "title": "Meeting Notes",
  "content": "Discussed Q4 goals...",
  "metadata": {
    "createdAt": "",  // Unknown - placeholder
    "updatedAt": "",  // Unknown - placeholder
    "author": "Anonymous",
    "tags": []
  }
}
```

**Classification:** ✅ Additive (P2P Safe)

### Version 3: Structured Content (Breaking)
**Migration Need:** Move from plain text to block-based content for rich editing.

```typescript
const DocSchemaV3 = Shape.doc({
  title: Shape.text(),
  blocks: Shape.list(Shape.map({  // RENAMED from 'content'
    id: Shape.plain.string(),
    type: Shape.plain.string("paragraph", "heading", "list", "code"),
    content: Shape.text(),
    properties: Shape.plain.object({
      level: Shape.plain.number().placeholder(1),  // For headings
      language: Shape.plain.string().placeholder(""),  // For code
      listType: Shape.plain.string("bullet", "numbered").placeholder("bullet"),
    }),
  })),
  metadata: Shape.map({
    createdAt: Shape.plain.string(),
    updatedAt: Shape.plain.string(),
    author: Shape.plain.string().placeholder("Anonymous"),
    tags: Shape.plain.array(Shape.plain.string()),
  }),
})
```

**Migration Path V2→V3:**
```typescript
const migrateV2ToV3 = (v2Data) => {
  // Parse plain text into blocks
  const lines = v2Data.content.split('\n')
  const blocks = []
  
  for (const line of lines) {
    if (line.startsWith('# ')) {
      blocks.push({
        id: generateUUID(),
        type: 'heading',
        content: line.slice(2),
        properties: { level: 1, language: '', listType: 'bullet' }
      })
    } else if (line.startsWith('- ')) {
      blocks.push({
        id: generateUUID(),
        type: 'list',
        content: line.slice(2),
        properties: { level: 1, language: '', listType: 'bullet' }
      })
    } else if (line.trim()) {
      blocks.push({
        id: generateUUID(),
        type: 'paragraph',
        content: line,
        properties: { level: 1, language: '', listType: 'bullet' }
      })
    }
  }
  
  return {
    title: v2Data.title,
    blocks,
    metadata: v2Data.metadata,
  }
}
```

**Sample Data V3:**
```json
{
  "title": "Meeting Notes",
  "blocks": [
    {
      "id": "block-1",
      "type": "paragraph",
      "content": "Discussed Q4 goals.",
      "properties": { "level": 1, "language": "", "listType": "bullet" }
    },
    {
      "id": "block-2",
      "type": "paragraph",
      "content": "Action items:",
      "properties": { "level": 1, "language": "", "listType": "bullet" }
    },
    {
      "id": "block-3",
      "type": "list",
      "content": "Review budget",
      "properties": { "level": 1, "language": "", "listType": "bullet" }
    }
  ],
  "metadata": { "createdAt": "", "updatedAt": "", "author": "Anonymous", "tags": [] }
}
```

**Classification:** ⚠️ Breaking (Server-Coordinated Only)

**P2P Challenge:** The `content` field is removed and replaced with `blocks`. Any concurrent edits to `content` during migration would be lost.

### Version 4: Add Collaboration Features
```typescript
const DocSchemaV4 = Shape.doc({
  title: Shape.text(),
  blocks: Shape.list(Shape.map({
    id: Shape.plain.string(),
    type: Shape.plain.string("paragraph", "heading", "list", "code"),
    content: Shape.text(),
    properties: Shape.plain.object({
      level: Shape.plain.number().placeholder(1),
      language: Shape.plain.string().placeholder(""),
      listType: Shape.plain.string("bullet", "numbered").placeholder("bullet"),
    }),
  })),
  metadata: Shape.map({
    createdAt: Shape.plain.string(),
    updatedAt: Shape.plain.string(),
    author: Shape.plain.string().placeholder("Anonymous"),
    tags: Shape.plain.array(Shape.plain.string()),
  }),
  // NEW: Collaboration features
  comments: Shape.list(Shape.map({
    id: Shape.plain.string(),
    blockId: Shape.plain.string(),  // Reference to block
    author: Shape.plain.string(),
    content: Shape.text(),
    createdAt: Shape.plain.string(),
    resolved: Shape.plain.boolean().placeholder(false),
  })),
  permissions: Shape.map({
    owner: Shape.plain.string(),
    editors: Shape.plain.array(Shape.plain.string()),
    viewers: Shape.plain.array(Shape.plain.string()),
  }),
})
```

**Migration Path V3→V4:**
```typescript
// Additive
{
  ...v3Data,
  comments: [],
  permissions: {
    owner: "",
    editors: [],
    viewers: []
  }
}
```

**Classification:** ✅ Additive (P2P Safe)

---

## Case 3: E-Commerce Product Catalog

### Evolution Story
A product catalog that evolves to support variants, inventory, and internationalization.

### Version 1: Simple Products
```typescript
const CatalogSchemaV1 = Shape.doc({
  products: Shape.list(Shape.map({
    name: Shape.plain.string(),
    price: Shape.plain.number(),
    description: Shape.text(),
    inStock: Shape.plain.boolean(),
  })),
})
```

**Sample Data V1:**
```json
{
  "products": [
    {
      "name": "Blue T-Shirt",
      "price": 29.99,
      "description": "Comfortable cotton t-shirt",
      "inStock": true
    }
  ]
}
```

### Version 2: Add SKU and Categories
```typescript
const CatalogSchemaV2 = Shape.doc({
  products: Shape.list(Shape.map({
    sku: Shape.plain.string(),  // NEW: Stock Keeping Unit
    name: Shape.plain.string(),
    price: Shape.plain.number(),
    description: Shape.text(),
    inStock: Shape.plain.boolean(),
    category: Shape.plain.string().placeholder("uncategorized"),  // NEW
    images: Shape.plain.array(Shape.plain.string()),  // NEW: image URLs
  })),
})
```

**Migration Path V1→V2:**
```typescript
// Semi-additive: SKU needs generation
const migrateV1ToV2 = (v1Data) => ({
  products: v1Data.products.map((product, index) => ({
    ...product,
    sku: `SKU-${index.toString().padStart(6, '0')}`,  // Generate SKU
    category: "uncategorized",
    images: [],
  })),
})
```

**Classification:** ⚠️ Semi-Breaking (SKU generation)

### Version 3: Product Variants (Major Restructure)
**Migration Need:** Support size/color variants with separate inventory.

```typescript
const CatalogSchemaV3 = Shape.doc({
  products: Shape.list(Shape.map({
    id: Shape.plain.string(),
    name: Shape.plain.string(),
    description: Shape.text(),
    category: Shape.plain.string().placeholder("uncategorized"),
    images: Shape.plain.array(Shape.plain.string()),
    // RESTRUCTURED: price and stock moved to variants
    variants: Shape.list(Shape.map({
      sku: Shape.plain.string(),
      name: Shape.plain.string(),  // e.g., "Blue / Large"
      price: Shape.plain.number(),
      compareAtPrice: Shape.plain.union([
        Shape.plain.null(),
        Shape.plain.number()
      ]).placeholder(null),
      inventory: Shape.plain.number().placeholder(0),
      attributes: Shape.plain.object({
        color: Shape.plain.string().placeholder(""),
        size: Shape.plain.string().placeholder(""),
      }),
    })),
  })),
})
```

**Migration Path V2→V3:**
```typescript
const migrateV2ToV3 = (v2Data) => ({
  products: v2Data.products.map((product) => ({
    id: generateUUID(),
    name: product.name,
    description: product.description,
    category: product.category,
    images: product.images,
    variants: [{
      // Convert single product to single variant
      sku: product.sku,
      name: "Default",
      price: product.price,
      compareAtPrice: null,
      inventory: product.inStock ? 1 : 0,  // Best guess
      attributes: { color: "", size: "" },
    }],
  })),
})
```

**Sample Data V3:**
```json
{
  "products": [
    {
      "id": "prod-001",
      "name": "Cotton T-Shirt",
      "description": "Comfortable cotton t-shirt",
      "category": "apparel",
      "images": ["https://..."],
      "variants": [
        {
          "sku": "TSHIRT-BLU-S",
          "name": "Blue / Small",
          "price": 29.99,
          "compareAtPrice": null,
          "inventory": 50,
          "attributes": { "color": "Blue", "size": "Small" }
        },
        {
          "sku": "TSHIRT-BLU-M",
          "name": "Blue / Medium",
          "price": 29.99,
          "compareAtPrice": null,
          "inventory": 75,
          "attributes": { "color": "Blue", "size": "Medium" }
        }
      ]
    }
  ]
}
```

**Classification:** ⚠️ Breaking (Server-Coordinated Only)

**Data Loss Risk:** `inStock: boolean` → `inventory: number` loses precision. We can only guess inventory count.

### Version 4: Internationalization
```typescript
const CatalogSchemaV4 = Shape.doc({
  products: Shape.list(Shape.map({
    id: Shape.plain.string(),
    // RESTRUCTURED: name/description now localized
    localizations: Shape.record(Shape.plain.object({
      name: Shape.plain.string(),
      description: Shape.plain.string(),
    })),
    category: Shape.plain.string().placeholder("uncategorized"),
    images: Shape.plain.array(Shape.plain.string()),
    variants: Shape.list(Shape.map({
      sku: Shape.plain.string(),
      localizations: Shape.record(Shape.plain.object({
        name: Shape.plain.string(),
      })),
      price: Shape.plain.number(),
      compareAtPrice: Shape.plain.union([Shape.plain.null(), Shape.plain.number()]).placeholder(null),
      inventory: Shape.plain.number().placeholder(0),
      attributes: Shape.plain.object({
        color: Shape.plain.string().placeholder(""),
        size: Shape.plain.string().placeholder(""),
      }),
    })),
  })),
  defaultLocale: Shape.plain.string().placeholder("en"),
})
```

**Migration Path V3→V4:**
```typescript
const migrateV3ToV4 = (v3Data, defaultLocale = 'en') => ({
  products: v3Data.products.map((product) => ({
    id: product.id,
    localizations: {
      [defaultLocale]: {
        name: product.name,
        description: product.description,
      }
    },
    category: product.category,
    images: product.images,
    variants: product.variants.map(variant => ({
      ...variant,
      localizations: {
        [defaultLocale]: { name: variant.name }
      },
    })),
  })),
  defaultLocale,
})
```

**Classification:** ⚠️ Breaking (Structural change)

---

## Case 4: Chat/Messaging Application

### Evolution Story
A chat app that evolves from simple messages to threads, reactions, and rich media.

### Version 1: Simple Messages
```typescript
const ChatSchemaV1 = Shape.doc({
  messages: Shape.list(Shape.map({
    author: Shape.plain.string(),
    content: Shape.text(),
    timestamp: Shape.plain.string(),
  })),
})
```

**Sample Data V1:**
```json
{
  "messages": [
    { "author": "alice", "content": "Hello!", "timestamp": "2024-01-10T10:00:00Z" },
    { "author": "bob", "content": "Hi there!", "timestamp": "2024-01-10T10:01:00Z" }
  ]
}
```

### Version 2: Add Message IDs and Editing
```typescript
const ChatSchemaV2 = Shape.doc({
  messages: Shape.list(Shape.map({
    id: Shape.plain.string(),  // NEW
    author: Shape.plain.string(),
    content: Shape.text(),
    timestamp: Shape.plain.string(),
    editedAt: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]).placeholder(null),  // NEW
    deleted: Shape.plain.boolean().placeholder(false),  // NEW: soft delete
  })),
})
```

**Migration Path V1→V2:**
```typescript
const migrateV1ToV2 = (v1Data) => ({
  messages: v1Data.messages.map((msg, index) => ({
    ...msg,
    id: `msg-${index}-${Date.parse(msg.timestamp)}`,
    editedAt: null,
    deleted: false,
  })),
})
```

**Classification:** ⚠️ Semi-Breaking (ID generation)

### Version 3: Add Reactions
```typescript
const ChatSchemaV3 = Shape.doc({
  messages: Shape.list(Shape.map({
    id: Shape.plain.string(),
    author: Shape.plain.string(),
    content: Shape.text(),
    timestamp: Shape.plain.string(),
    editedAt: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]).placeholder(null),
    deleted: Shape.plain.boolean().placeholder(false),
    reactions: Shape.record(Shape.plain.array(Shape.plain.string())),  // NEW: emoji -> [userIds]
  })),
})
```

**Migration Path V2→V3:**
```typescript
// Additive
{
  messages: v2Data.messages.map(msg => ({
    ...msg,
    reactions: {},
  })),
}
```

**Classification:** ✅ Additive (P2P Safe)

### Version 4: Threading Support (Major Restructure)
```typescript
const ChatSchemaV4 = Shape.doc({
  messages: Shape.list(Shape.map({
    id: Shape.plain.string(),
    author: Shape.plain.string(),
    content: Shape.text(),
    timestamp: Shape.plain.string(),
    editedAt: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]).placeholder(null),
    deleted: Shape.plain.boolean().placeholder(false),
    reactions: Shape.record(Shape.plain.array(Shape.plain.string())),
    // NEW: Threading
    threadId: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]).placeholder(null),
    replyToId: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]).placeholder(null),
    replyCount: Shape.plain.number().placeholder(0),
  })),
  threads: Shape.record(Shape.map({  // NEW: Thread metadata
    id: Shape.plain.string(),
    rootMessageId: Shape.plain.string(),
    participantIds: Shape.plain.array(Shape.plain.string()),
    lastActivityAt: Shape.plain.string(),
  })),
})
```

**Migration Path V3→V4:**
```typescript
// Additive - all messages are root messages (no thread)
{
  messages: v3Data.messages.map(msg => ({
    ...msg,
    threadId: null,
    replyToId: null,
    replyCount: 0,
  })),
  threads: {},
}
```

**Classification:** ✅ Additive (P2P Safe)

### Version 5: Rich Media Messages (Type Change)
```typescript
const ChatSchemaV5 = Shape.doc({
  messages: Shape.list(Shape.map({
    id: Shape.plain.string(),
    author: Shape.plain.string(),
    timestamp: Shape.plain.string(),
    editedAt: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]).placeholder(null),
    deleted: Shape.plain.boolean().placeholder(false),
    reactions: Shape.record(Shape.plain.array(Shape.plain.string())),
    threadId: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]).placeholder(null),
    replyToId: Shape.plain.union([Shape.plain.null(), Shape.plain.string()]).placeholder(null),
    replyCount: Shape.plain.number().placeholder(0),
    // RESTRUCTURED: content is now a discriminated union
    messageType: Shape.plain.string("text", "image", "file", "system"),
    content: Shape.plain.discriminatedUnion("type", {
      text: Shape.plain.object({
        type: Shape.plain.string("text"),
        text: Shape.plain.string(),
      }),
      image: Shape.plain.object({
        type: Shape.plain.string("image"),
        url: Shape.plain.string(),
        alt: Shape.plain.string().placeholder(""),
        width: Shape.plain.number().placeholder(0),
        height: Shape.plain.number().placeholder(0),
      }),
      file: Shape.plain.object({
        type: Shape.plain.string("file"),
        url: Shape.plain.string(),
        filename: Shape.plain.string(),
        mimeType: Shape.plain.string(),
        size: Shape.plain.number(),
      }),
      system: Shape.plain.object({
        type: Shape.plain.string("system"),
        action: Shape.plain.string(),
        metadata: Shape.plain.record(Shape.plain.string()),
      }),
    }),
  })),
  threads: Shape.record(Shape.map({
    id: Shape.plain.string(),
    rootMessageId: Shape.plain.string(),
    participantIds: Shape.plain.array(Shape.plain.string()),
    lastActivityAt: Shape.plain.string(),
  })),
})
```

**Migration Path V4→V5:**
```typescript
const migrateV4ToV5 = (v4Data) => ({
  messages: v4Data.messages.map(msg => ({
    ...msg,
    messageType: "text",
    content: {
      type: "text",
      text: msg.content,  // Convert LoroText to plain string
    },
  })),
  threads: v4Data.threads,
})
```

**Classification:** ⚠️ Breaking (Type change: LoroText → discriminated union)

**P2P Challenge:** The `content` field changes from `Shape.text()` (LoroText CRDT) to a plain value. Any concurrent text edits during migration would conflict with the structural change.

---

## Case 5: Project Management / Kanban Board

### Evolution Story
A kanban board that evolves to support multiple boards, custom fields, and automation.

### Version 1: Single Board
```typescript
const KanbanSchemaV1 = Shape.doc({
  columns: Shape.list(Shape.map({
    name: Shape.plain.string(),
    cards: Shape.list(Shape.map({
      title: Shape.plain.string(),
      description: Shape.text(),
    })),
  })),
})
```

**Sample Data V1:**
```json
{
  "columns": [
    {
      "name": "To Do",
      "cards": [
        { "title": "Design homepage", "description": "Create mockups" }
      ]
    },
    {
      "name": "In Progress",
      "cards": []
    },
    {
      "name": "Done",
      "cards": []
    }
  ]
}
```

### Version 2: Add Card IDs and Assignees
```typescript
const KanbanSchemaV2 = Shape.doc({
  columns: Shape.list(Shape.map({
    id: Shape.plain.string(),  // NEW
    name: Shape.plain.string(),
    cards: Shape.movableList(Shape.map({  // CHANGED: list → movableList for drag-drop
      id: Shape.plain.string(),  // NEW
      title: Shape.plain.string(),
      description: Shape.text(),
      assigneeIds: Shape.plain.array(Shape.plain.string()),  // NEW
      labels: Shape.plain.array(Shape.plain.string()),  // NEW
    })),
  })),
})
```

**Migration Path V1→V2:**
```typescript
const migrateV1ToV2 = (v1Data) => ({
  columns: v1Data.columns.map((col, colIndex) => ({
    id: `col-${colIndex}`,
    name: col.name,
    cards: col.cards.map((card, cardIndex) => ({
      id: `card-${colIndex}-${cardIndex}`,
      title: card.title,
      description: card.description,
      assigneeIds: [],
      labels: [],
    })),
  })),
})
```

**Classification:** ⚠️ Semi-Breaking (ID generation, list→movableList)

**Note:** Changing `Shape.list` to `Shape.movableList` is a container type change. The underlying CRDT changes from `LoroList` to `LoroMovableList`.

### Version 3: Multiple Boards
```typescript
const KanbanSchemaV3 = Shape.doc({
  boards: Shape.record(Shape.map({  // NEW: multiple boards
    id: Shape.plain.string(),
    name: Shape.plain.string(),
    columns: Shape.list(Shape.map({
      id: Shape.plain.string(),
      name: Shape.plain.string(),
      cards: Shape.movableList(Shape.map({
        id: Shape.plain.string(),
        title: Shape.plain.string(),
        description: Shape.text(),
        assigneeIds: Shape.plain.array(Shape.plain.string()),
        labels: Shape.plain.array(Shape.plain.string()),
      })),
    })),
  })),
  activeBoard: Shape.plain.string().placeholder("default"),  // NEW
})
```

**Migration Path V2→V3:**
```typescript
const migrateV2ToV3 = (v2Data) => ({
  boards: {
    default: {
      id: "default",
      name: "Main Board",
      columns: v2Data.columns,
    },
  },
  activeBoard: "default",
})
```

**Classification:** ⚠️ Breaking (Structural: columns moved under boards)

### Version 4: Custom Fields
```typescript
const KanbanSchemaV4 = Shape.doc({
  boards: Shape.record(Shape.map({
    id: Shape.plain.string(),
    name: Shape.plain.string(),
    columns: Shape.list(Shape.map({
      id: Shape.plain.string(),
      name: Shape.plain.string(),
      cards: Shape.movableList(Shape.map({
        id: Shape.plain.string(),
        title: Shape.plain.string(),
        description: Shape.text(),
        assigneeIds: Shape.plain.array(Shape.plain.string()),
        labels: Shape.plain.array(Shape.plain.string()),
        customFields: Shape.record(Shape.plain.union([  // NEW
          Shape.plain.string(),
          Shape.plain.number(),
          Shape.plain.boolean(),
          Shape.plain.null(),
        ])),
      })),
    })),
    // NEW: Custom field definitions
    fieldDefinitions: Shape.list(Shape.map({
      id: Shape.plain.string(),
      name: Shape.plain.string(),
      type: Shape.plain.string("text", "number", "date", "select", "checkbox"),
      options: Shape.plain.array(Shape.plain.string()),  // For select type
      required: Shape.plain.boolean().placeholder(false),
    })),
  })),
  activeBoard: Shape.plain.string().placeholder("default"),
})
```

**Migration Path V3→V4:**
```typescript
// Additive
{
  boards: Object.fromEntries(
    Object.entries(v3Data.boards).map(([key, board]) => [
      key,
      {
        ...board,
        columns: board.columns.map(col => ({
          ...col,
          cards: col.cards.map(card => ({
            ...card,
            customFields: {},
          })),
        })),
        fieldDefinitions: [],
      },
    ])
  ),
  activeBoard: v3Data.activeBoard,
}
```

**Classification:** ✅ Additive (P2P Safe)

---

##