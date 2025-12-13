import { describe, expect, it } from "vitest"
import { derivePlaceholder } from "./derive-placeholder.js"
import { Shape } from "./shape.js"

describe("derivePlaceholder", () => {
  it("uses default values when no placeholder set", () => {
    const schema = Shape.doc({
      title: Shape.text(),
      count: Shape.counter(),
    })

    expect(derivePlaceholder(schema)).toEqual({
      title: "",
      count: 0,
    })
  })

  it("uses placeholder values when set", () => {
    const schema = Shape.doc({
      title: Shape.text().placeholder("Untitled"),
      count: Shape.counter().placeholder(100),
    })

    expect(derivePlaceholder(schema)).toEqual({
      title: "Untitled",
      count: 100,
    })
  })

  it("composes nested map placeholders", () => {
    const schema = Shape.doc({
      settings: Shape.struct({
        theme: Shape.plain.string().placeholder("dark"),
        fontSize: Shape.plain.number().placeholder(14),
      }),
    })

    expect(derivePlaceholder(schema)).toEqual({
      settings: {
        theme: "dark",
        fontSize: 14,
      },
    })
  })

  it("uses empty arrays for lists", () => {
    const schema = Shape.doc({
      items: Shape.list(Shape.plain.string()),
    })

    expect(derivePlaceholder(schema)).toEqual({
      items: [],
    })
  })

  it("uses empty objects for records", () => {
    const schema = Shape.doc({
      data: Shape.record(Shape.plain.number()),
    })

    expect(derivePlaceholder(schema)).toEqual({
      data: {},
    })
  })

  it("handles plain value shapes with defaults", () => {
    const schema = Shape.doc({
      config: Shape.struct({
        name: Shape.plain.string(),
        count: Shape.plain.number(),
        enabled: Shape.plain.boolean(),
        nothing: Shape.plain.null(),
      }),
    })

    expect(derivePlaceholder(schema)).toEqual({
      config: {
        name: "",
        count: 0,
        enabled: false,
        nothing: null,
      },
    })
  })

  it("handles plain value shapes with custom placeholders", () => {
    const schema = Shape.doc({
      config: Shape.struct({
        name: Shape.plain.string().placeholder("default-name"),
        count: Shape.plain.number().placeholder(42),
        enabled: Shape.plain.boolean().placeholder(true),
      }),
    })

    expect(derivePlaceholder(schema)).toEqual({
      config: {
        name: "default-name",
        count: 42,
        enabled: true,
      },
    })
  })

  it("handles nested plain objects", () => {
    const schema = Shape.doc({
      user: Shape.struct({
        profile: Shape.plain.object({
          name: Shape.plain.string().placeholder("Anonymous"),
          age: Shape.plain.number().placeholder(0),
        }),
      }),
    })

    expect(derivePlaceholder(schema)).toEqual({
      user: {
        profile: {
          name: "Anonymous",
          age: 0,
        },
      },
    })
  })

  it("handles plain arrays as empty", () => {
    const schema = Shape.doc({
      tags: Shape.struct({
        items: Shape.plain.array(Shape.plain.string()),
      }),
    })

    expect(derivePlaceholder(schema)).toEqual({
      tags: {
        items: [],
      },
    })
  })

  it("handles plain records as empty", () => {
    const schema = Shape.doc({
      metadata: Shape.struct({
        values: Shape.plain.record(Shape.plain.number()),
      }),
    })

    expect(derivePlaceholder(schema)).toEqual({
      metadata: {
        values: {},
      },
    })
  })

  it("handles union types by deriving from first variant", () => {
    const schema = Shape.doc({
      value: Shape.struct({
        data: Shape.plain.union([Shape.plain.string(), Shape.plain.null()]),
      }),
    })

    expect(derivePlaceholder(schema)).toEqual({
      value: {
        data: "", // First variant is string, default is ""
      },
    })
  })

  it("handles union types with explicit placeholder", () => {
    const schema = Shape.doc({
      value: Shape.struct({
        data: Shape.plain
          .union([Shape.plain.string(), Shape.plain.null()])
          .placeholder(null),
      }),
    })

    expect(derivePlaceholder(schema)).toEqual({
      value: {
        data: null,
      },
    })
  })

  it("handles movable lists as empty arrays", () => {
    const schema = Shape.doc({
      tasks: Shape.movableList(Shape.plain.string()),
    })

    expect(derivePlaceholder(schema)).toEqual({
      tasks: [],
    })
  })

  it("handles tree containers as empty arrays", () => {
    const schema = Shape.doc({
      hierarchy: Shape.tree(Shape.struct({ name: Shape.text() })),
    })

    expect(derivePlaceholder(schema)).toEqual({
      hierarchy: [],
    })
  })

  it("handles complex nested structures", () => {
    const schema = Shape.doc({
      article: Shape.struct({
        title: Shape.text().placeholder("Untitled Article"),
        metadata: Shape.struct({
          views: Shape.counter().placeholder(0),
          author: Shape.plain.object({
            name: Shape.plain.string().placeholder("Anonymous"),
            email: Shape.plain.string(),
          }),
          tags: Shape.list(Shape.plain.string()),
        }),
      }),
    })

    expect(derivePlaceholder(schema)).toEqual({
      article: {
        title: "Untitled Article",
        metadata: {
          views: 0,
          author: {
            name: "Anonymous",
            email: "",
          },
          tags: [],
        },
      },
    })
  })

  it("handles string literal options", () => {
    const schema = Shape.doc({
      status: Shape.struct({
        value: Shape.plain.string("active", "inactive", "pending"),
      }),
    })

    expect(derivePlaceholder(schema)).toEqual({
      status: {
        value: "active", // First option is the default
      },
    })
  })
})
