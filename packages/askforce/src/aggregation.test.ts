import { describe, expect, it } from "vitest"
import {
  allAnswers,
  allHaveStatus,
  firstAnswer,
  hasStatus,
  pickOne,
} from "./aggregation.js"
import type { WorkerAnswer } from "./types.js"

describe("pickOne", () => {
  it("returns undefined for empty answers map", () => {
    const answers: Record<string, WorkerAnswer<string>> = {}
    expect(pickOne(answers)).toBeUndefined()
  })

  it("returns undefined when no answered results exist", () => {
    const answers: Record<string, WorkerAnswer<string>> = {
      worker1: { status: "pending", claimedAt: 1000 },
      worker2: { status: "failed", reason: "error", failedAt: 2000 },
    }
    expect(pickOne(answers)).toBeUndefined()
  })

  it("returns the only answered result", () => {
    const answers: Record<string, WorkerAnswer<string>> = {
      worker1: { status: "answered", data: "result1", answeredAt: 1000 },
    }
    expect(pickOne(answers)).toBe("result1")
  })

  it("returns deterministic result when multiple answers exist", () => {
    const answers: Record<string, WorkerAnswer<string>> = {
      worker2: { status: "answered", data: "result2", answeredAt: 2000 },
      worker1: { status: "answered", data: "result1", answeredAt: 1000 },
      worker3: { status: "answered", data: "result3", answeredAt: 3000 },
    }
    // Should return worker1's result (first alphabetically)
    expect(pickOne(answers)).toBe("result1")
  })

  it("ignores pending and failed answers", () => {
    const answers: Record<string, WorkerAnswer<string>> = {
      worker1: { status: "pending", claimedAt: 1000 },
      worker2: { status: "answered", data: "result2", answeredAt: 2000 },
      worker3: { status: "failed", reason: "error", failedAt: 3000 },
    }
    expect(pickOne(answers)).toBe("result2")
  })
})

describe("allAnswers", () => {
  it("returns empty array for empty answers map", () => {
    const answers: Record<string, WorkerAnswer<string>> = {}
    expect(allAnswers(answers)).toEqual([])
  })

  it("returns empty array when no answered results exist", () => {
    const answers: Record<string, WorkerAnswer<string>> = {
      worker1: { status: "pending", claimedAt: 1000 },
    }
    expect(allAnswers(answers)).toEqual([])
  })

  it("returns all answered results with worker IDs", () => {
    const answers: Record<string, WorkerAnswer<string>> = {
      worker1: { status: "answered", data: "result1", answeredAt: 1000 },
      worker2: { status: "answered", data: "result2", answeredAt: 2000 },
    }
    const result = allAnswers(answers)
    expect(result).toHaveLength(2)
    expect(result).toContainEqual({
      workerId: "worker1",
      data: "result1",
      answeredAt: 1000,
    })
    expect(result).toContainEqual({
      workerId: "worker2",
      data: "result2",
      answeredAt: 2000,
    })
  })

  it("filters out pending and failed answers", () => {
    const answers: Record<string, WorkerAnswer<string>> = {
      worker1: { status: "pending", claimedAt: 1000 },
      worker2: { status: "answered", data: "result2", answeredAt: 2000 },
      worker3: { status: "failed", reason: "error", failedAt: 3000 },
    }
    const result = allAnswers(answers)
    expect(result).toHaveLength(1)
    expect(result[0].workerId).toBe("worker2")
  })
})

describe("firstAnswer", () => {
  it("returns undefined for empty answers map", () => {
    const answers: Record<string, WorkerAnswer<string>> = {}
    expect(firstAnswer(answers)).toBeUndefined()
  })

  it("returns the first answered result found", () => {
    const answers: Record<string, WorkerAnswer<string>> = {
      worker1: { status: "answered", data: "result1", answeredAt: 1000 },
    }
    expect(firstAnswer(answers)).toBe("result1")
  })

  it("returns any answered result (not necessarily deterministic)", () => {
    const answers: Record<string, WorkerAnswer<string>> = {
      worker1: { status: "pending", claimedAt: 1000 },
      worker2: { status: "answered", data: "result2", answeredAt: 2000 },
    }
    expect(firstAnswer(answers)).toBe("result2")
  })
})

describe("hasStatus", () => {
  it("returns false for empty answers map", () => {
    const answers: Record<string, WorkerAnswer<string>> = {}
    expect(hasStatus(answers, "pending")).toBe(false)
    expect(hasStatus(answers, "answered")).toBe(false)
    expect(hasStatus(answers, "failed")).toBe(false)
  })

  it("returns true when status exists", () => {
    const answers: Record<string, WorkerAnswer<string>> = {
      worker1: { status: "pending", claimedAt: 1000 },
    }
    expect(hasStatus(answers, "pending")).toBe(true)
    expect(hasStatus(answers, "answered")).toBe(false)
  })

  it("returns true when any answer has the status", () => {
    const answers: Record<string, WorkerAnswer<string>> = {
      worker1: { status: "pending", claimedAt: 1000 },
      worker2: { status: "answered", data: "result", answeredAt: 2000 },
      worker3: { status: "failed", reason: "error", failedAt: 3000 },
    }
    expect(hasStatus(answers, "pending")).toBe(true)
    expect(hasStatus(answers, "answered")).toBe(true)
    expect(hasStatus(answers, "failed")).toBe(true)
  })
})

describe("allHaveStatus", () => {
  it("returns false for empty answers map", () => {
    const answers: Record<string, WorkerAnswer<string>> = {}
    expect(allHaveStatus(answers, "pending")).toBe(false)
  })

  it("returns true when all answers have the status", () => {
    const answers: Record<string, WorkerAnswer<string>> = {
      worker1: { status: "failed", reason: "error1", failedAt: 1000 },
      worker2: { status: "failed", reason: "error2", failedAt: 2000 },
    }
    expect(allHaveStatus(answers, "failed")).toBe(true)
  })

  it("returns false when not all answers have the status", () => {
    const answers: Record<string, WorkerAnswer<string>> = {
      worker1: { status: "failed", reason: "error", failedAt: 1000 },
      worker2: { status: "answered", data: "result", answeredAt: 2000 },
    }
    expect(allHaveStatus(answers, "failed")).toBe(false)
  })
})
