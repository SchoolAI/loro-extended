import { z } from "zod"
import { Shape } from "./schema.js"

const { crdt, value } = Shape

// Pattern 1: List with POJO objects (leaf nodes)
export const simpleList = crdt.list(z.object({ title: z.string() }))

// Pattern 2: List with LoroMap containers
export const containerListDoc = Shape.doc({
  title: crdt.text(),
  list: crdt.list(
    crdt.map({
      title: z.string(),
      tags: z.array(z.string()),
    }),
  ),
})

// Pattern 3: Fully nested containers
export const deeplyNested = crdt.list(
  crdt.map({
    title: z.string(),
    tags: crdt.list(z.string()), // LoroList of strings, not array
  }),
)

// Example: Complex document schema with deeply nested Loro and POJO types
export const complexDocSchema = Shape.doc({
  // Simple Loro containers
  title: crdt.text(),
  viewCount: crdt.counter(),

  // Mixed content: LoroList containing POJO objects
  articles: crdt.list(
    z.object({
      id: z.string(),
      title: z.string(),
      publishedAt: z.date(),
      tags: z.array(z.string()), // POJO array (leaf node)
      metadata: z.object({
        wordCount: z.number(),
        readingTime: z.number(),
        featured: z.boolean(),
      }),
    }),
  ),

  // LoroMovableList for reorderable content
  priorityTasks: crdt.movableList(
    z.object({
      id: z.string(),
      title: z.string(),
      priority: z.number(),
      completed: z.boolean(),
    }),
  ),

  // Deeply nested: LoroList containing LoroMap containers
  collaborativeArticles: crdt.list(
    crdt.map({
      // Each article is a LoroMap with mixed content
      title: crdt.text(), // Collaborative text editing
      content: crdt.text(), // Collaborative content editing

      // POJO metadata (leaf nodes)
      publishedAt: z.date(),
      authorId: z.string(),

      // Nested LoroMovableList for reorderable collaborative tag management
      tags: crdt.movableList(z.string()),

      // Even deeper nesting: LoroList of LoroMap for comments
      comments: crdt.list(
        crdt.map({
          id: z.string(), // POJO leaf
          authorId: z.string(), // POJO leaf
          content: crdt.text(), // Collaborative comment editing
          timestamp: z.date(), // POJO leaf

          // Nested replies as LoroMovableList of POJO objects
          replies: crdt.movableList(
            z.object({
              id: z.string(),
              authorId: z.string(),
              content: z.string(), // Non-collaborative reply content
              timestamp: z.date(),
            }),
          ),
        }),
      ),
    }),
  ),

  // Complex metadata structure
  siteMetadata: crdt.map({
    // POJO configuration
    config: z.object({
      siteName: z.string(),
      baseUrl: z.string(),
      theme: z.enum(["light", "dark", "auto"]),
    }),

    // Collaborative analytics
    analytics: crdt.map({
      totalViews: crdt.counter(),
      uniqueVisitors: crdt.counter(),

      // Daily stats as LoroMovableList of POJO objects (reorderable by date)
      dailyStats: crdt.movableList(
        z.object({
          date: z.string(),
          views: z.number(),
          visitors: z.number(),
          bounceRate: z.number(),
        }),
      ),
    }),

    // Collaborative feature flags
    features: crdt.map({
      commentsEnabled: z.boolean(),
      darkModeEnabled: z.boolean(),

      // Nested collaborative settings
      moderationSettings: crdt.map({
        autoModeration: z.boolean(),
        bannedWords: crdt.movableList(z.string()), // Reorderable banned words
        moderators: crdt.list(
          z.object({
            userId: z.string(),
            permissions: z.array(z.enum(["delete", "edit", "ban"])),
          }),
        ),
      }),
    }),
  }),
})
