import { z } from "zod"
import { LoroShape } from "./schema.js"

// Pattern 1: List with POJO objects (leaf nodes)
export const simpleList = LoroShape.list(z.object({ title: z.string() }))

// Pattern 2: List with LoroMap containers
export const containerListDoc = LoroShape.doc({
  title: LoroShape.text(),
  list: LoroShape.list(
    LoroShape.map({
      title: z.string(),
      tags: z.array(z.string()),
    }),
  ),
})

// Pattern 3: Fully nested containers
export const deeplyNested = LoroShape.list(
  LoroShape.map({
    title: z.string(),
    tags: LoroShape.list(z.string()), // LoroList of strings, not array
  }),
)

// Example: Complex document schema with deeply nested Loro and POJO types
export const complexDocSchema = LoroShape.doc({
  // Simple Loro containers
  title: LoroShape.text(),
  viewCount: LoroShape.counter(),

  // Mixed content: LoroList containing POJO objects
  articles: LoroShape.list(
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
  priorityTasks: LoroShape.movableList(
    z.object({
      id: z.string(),
      title: z.string(),
      priority: z.number(),
      completed: z.boolean(),
    }),
  ),

  // Deeply nested: LoroList containing LoroMap containers
  collaborativeArticles: LoroShape.list(
    LoroShape.map({
      // Each article is a LoroMap with mixed content
      title: LoroShape.text(), // Collaborative text editing
      content: LoroShape.text(), // Collaborative content editing

      // POJO metadata (leaf nodes)
      publishedAt: z.date(),
      authorId: z.string(),

      // Nested LoroMovableList for reorderable collaborative tag management
      tags: LoroShape.movableList(z.string()),

      // Even deeper nesting: LoroList of LoroMap for comments
      comments: LoroShape.list(
        LoroShape.map({
          id: z.string(), // POJO leaf
          authorId: z.string(), // POJO leaf
          content: LoroShape.text(), // Collaborative comment editing
          timestamp: z.date(), // POJO leaf

          // Nested replies as LoroMovableList of POJO objects
          replies: LoroShape.movableList(
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
  siteMetadata: LoroShape.map({
    // POJO configuration
    config: z.object({
      siteName: z.string(),
      baseUrl: z.string(),
      theme: z.enum(["light", "dark", "auto"]),
    }),

    // Collaborative analytics
    analytics: LoroShape.map({
      totalViews: LoroShape.counter(),
      uniqueVisitors: LoroShape.counter(),

      // Daily stats as LoroMovableList of POJO objects (reorderable by date)
      dailyStats: LoroShape.movableList(
        z.object({
          date: z.string(),
          views: z.number(),
          visitors: z.number(),
          bounceRate: z.number(),
        }),
      ),
    }),

    // Collaborative feature flags
    features: LoroShape.map({
      commentsEnabled: z.boolean(),
      darkModeEnabled: z.boolean(),

      // Nested collaborative settings
      moderationSettings: LoroShape.map({
        autoModeration: z.boolean(),
        bannedWords: LoroShape.movableList(z.string()), // Reorderable banned words
        moderators: LoroShape.list(
          z.object({
            userId: z.string(),
            permissions: z.array(z.enum(["delete", "edit", "ban"])),
          }),
        ),
      }),
    }),
  }),
})
