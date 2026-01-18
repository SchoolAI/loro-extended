import type { AnsweredAnswer, WorkerAnswer } from "./types.js"

/**
 * Picks one answer from the answers map using deterministic selection.
 * Returns the first answered result when sorted by worker ID.
 *
 * @param answers - Map of worker ID to worker answer
 * @returns The selected answer data, or undefined if no answered results exist
 */
export function pickOne<T>(
  answers: Record<string, WorkerAnswer<T>>,
): T | undefined {
  const answeredEntries = Object.entries(answers)
    .filter(
      (entry): entry is [string, AnsweredAnswer<T>] =>
        entry[1].status === "answered",
    )
    .sort(([a], [b]) => a.localeCompare(b))

  if (answeredEntries.length === 0) {
    return undefined
  }

  return answeredEntries[0][1].data
}

/**
 * Returns all answered results from the answers map.
 *
 * @param answers - Map of worker ID to worker answer
 * @returns Array of all answered results with their worker IDs
 */
export function allAnswers<T>(
  answers: Record<string, WorkerAnswer<T>>,
): Array<{ workerId: string; data: T; answeredAt: number }> {
  return Object.entries(answers)
    .filter(
      (entry): entry is [string, AnsweredAnswer<T>] =>
        entry[1].status === "answered",
    )
    .map(([workerId, answer]) => ({
      workerId,
      data: answer.data,
      answeredAt: answer.answeredAt,
    }))
}

/**
 * Returns the first answer from the answers map (by insertion order approximation).
 * Used in RPC mode where we expect exactly one answer.
 *
 * @param answers - Map of worker ID to worker answer
 * @returns The first answered result, or undefined if none exist
 */
export function firstAnswer<T>(
  answers: Record<string, WorkerAnswer<T>>,
): T | undefined {
  for (const answer of Object.values(answers)) {
    if (answer.status === "answered") {
      return answer.data
    }
  }
  return undefined
}

/**
 * Checks if any answer in the map has the given status.
 */
export function hasStatus<T>(
  answers: Record<string, WorkerAnswer<T>>,
  status: "pending" | "answered" | "failed",
): boolean {
  return Object.values(answers).some(answer => answer.status === status)
}

/**
 * Checks if all answers in the map have the given status.
 */
export function allHaveStatus<T>(
  answers: Record<string, WorkerAnswer<T>>,
  status: "pending" | "answered" | "failed",
): boolean {
  const values = Object.values(answers)
  return values.length > 0 && values.every(answer => answer.status === status)
}
