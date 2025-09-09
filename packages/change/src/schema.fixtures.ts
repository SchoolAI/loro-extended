import { Shape } from "./shape.js"

const { crdt, value } = Shape

// Pattern 1: List with POJO objects (leaf nodes)
export const simpleList = crdt.list(value.object({ title: value.string() }))

// Pattern 2: List with LoroMap containers
export const containerListDoc = Shape.doc({
  title: crdt.text(),
  list: crdt.list(
    crdt.map({
      title: value.string(),
      tags: value.array(value.string()),
    }),
  ),
})

// Pattern 3: Fully nested containers
export const deeplyNested = crdt.list(
  crdt.map({
    title: value.string(),
    tags: crdt.list(value.string()), // LoroList of strings, not array
  }),
)

// Example: Complex document schema with deeply nested Loro and POJO types
export const complexDocSchema = Shape.doc({
  // Simple Loro containers
  title: crdt.text(),
  viewCount: crdt.counter(),

  // Mixed content: LoroList containing POJO objects
  articles: crdt.list(
    value.object({
      id: value.string(),
      title: value.string(),
      publishedAt: value.string(),
      tags: value.array(value.string()), // POJO array (leaf node)
      metadata: value.object({
        wordCount: value.number(),
        readingTime: value.number(),
        featured: value.boolean(),
      }),
    }),
  ),

  // LoroMovableList for reorderable content
  priorityTasks: crdt.movableList(
    value.object({
      id: value.string(),
      title: value.string(),
      priority: value.number(),
      completed: value.boolean(),
    }),
  ),

  // Deeply nested: LoroList containing LoroMap containers
  collaborativeArticles: crdt.list(
    crdt.map({
      // Each article is a LoroMap with mixed content
      title: crdt.text(), // Collaborative text editing
      content: crdt.text(), // Collaborative content editing

      // POJO metadata (leaf nodes)
      publishedAt: value.string(),
      authorId: value.string(),

      // Nested LoroMovableList for reorderable collaborative tag management
      tags: crdt.movableList(value.string()),

      // Even deeper nesting: LoroList of LoroMap for comments
      comments: crdt.list(
        crdt.map({
          id: value.string(), // POJO leaf
          authorId: value.string(), // POJO leaf
          content: crdt.text(), // Collaborative comment editing
          timestamp: value.string(), // POJO leaf

          // Nested replies as LoroMovableList of POJO objects
          replies: crdt.movableList(
            value.object({
              id: value.string(),
              authorId: value.string(),
              content: value.string(), // Non-collaborative reply content
              timestamp: value.string(),
            }),
          ),
        }),
      ),
    }),
  ),

  // Complex metadata structure
  siteMetadata: crdt.map({
    // POJO configuration
    config: value.object({
      siteName: value.string(),
      baseUrl: value.string(),
      theme: value.string(),
    }),

    // Collaborative analytics
    analytics: crdt.map({
      totalViews: crdt.counter(),
      uniqueVisitors: crdt.counter(),

      // Daily stats as LoroMovableList of POJO objects (reorderable by date)
      dailyStats: crdt.movableList(
        value.object({
          date: value.string(),
          views: value.number(),
          visitors: value.number(),
          bounceRate: value.number(),
        }),
      ),
    }),

    // Collaborative feature flags
    features: crdt.map({
      commentsEnabled: value.boolean(),
      darkModeEnabled: value.boolean(),

      // Nested collaborative settings
      moderationSettings: crdt.map({
        autoModeration: value.boolean(),
        bannedWords: crdt.movableList(value.string()), // Reorderable banned words
        moderators: crdt.list(
          value.object({
            userId: value.string(),
            permissions: value.array(value.string()),
          }),
        ),
      }),
    }),
  }),
})
