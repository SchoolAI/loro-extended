import {
  type DiscriminatedUnionValueShape,
  type RecordContainerShape,
  Shape,
  type StructContainerShape,
  type StructValueShape,
  type ValueShape,
} from "@loro-extended/change"
import type { WorkerAnswer } from "./types.js"

/**
 * The shape for a pending worker answer.
 */
export const PendingAnswerShape = Shape.plain.struct({
  status: Shape.plain.string("pending"),
  claimedAt: Shape.plain.number(),
})

/**
 * The shape type for a worker answer discriminated union.
 * This is the return type of createWorkerAnswerSchema.
 */
export type WorkerAnswerShape<A extends ValueShape> = ReturnType<
  typeof createWorkerAnswerSchema<A>
>

/**
 * The shape type for an ask entry struct.
 * This is the nested shape inside the record returned by createAskSchema.
 */
export type AskEntryShape<
  Q extends ValueShape,
  A extends ValueShape,
> = ReturnType<typeof createAskEntrySchema<Q, A>>

/**
 * The plain (JSON) type for an ask entry.
 * Defined explicitly using Q["_plain"] and A["_plain"] to preserve type identity.
 * This enables cast-free type checking throughout the Asks class.
 */
export interface PlainAskEntry<Q extends ValueShape, A extends ValueShape> {
  id: string
  question: Q["_plain"]
  askedAt: number
  askedBy: string
  answers: Record<string, WorkerAnswer<A["_plain"]>>
}

/**
 * Creates the WorkerAnswerSchema discriminated union for a given answer shape.
 */
function createWorkerAnswerSchema<A extends ValueShape>(answerSchema: A) {
  return Shape.plain.discriminatedUnion("status", {
    pending: Shape.plain.struct({
      status: Shape.plain.string("pending"),
      claimedAt: Shape.plain.number(),
    }),
    answered: Shape.plain.struct({
      status: Shape.plain.string("answered"),
      data: answerSchema,
      answeredAt: Shape.plain.number(),
    }),
    failed: Shape.plain.struct({
      status: Shape.plain.string("failed"),
      reason: Shape.plain.string(),
      failedAt: Shape.plain.number(),
    }),
  })
}

/**
 * Creates the AskEntrySchema struct for a given question and answer shape.
 */
function createAskEntrySchema<Q extends ValueShape, A extends ValueShape>(
  questionSchema: Q,
  answerSchema: A,
) {
  const WorkerAnswerSchema = createWorkerAnswerSchema(answerSchema)

  return Shape.struct({
    id: Shape.plain.string(),
    question: questionSchema,
    askedAt: Shape.plain.number(),
    askedBy: Shape.plain.string(),
    // Each worker writes to their own slot - no write conflicts
    answers: Shape.record(WorkerAnswerSchema),
  })
}

/**
 * Creates a typed Asks schema with question and answer validation.
 *
 * @param questionSchema - The shape for the question data
 * @param answerSchema - The shape for the answer data
 * @returns A record schema keyed by ask ID
 *
 * @example
 * ```typescript
 * const MyQueueSchema = createAskSchema(
 *   Shape.plain.struct({ query: Shape.plain.string() }),   // Question
 *   Shape.plain.struct({ result: Shape.plain.string() })   // Answer
 * );
 * // MyQueueSchema is Record<string, AskEntry> - keyed by ask ID
 * ```
 */
export function createAskSchema<Q extends ValueShape, A extends ValueShape>(
  questionSchema: Q,
  answerSchema: A,
) {
  const AskEntrySchema = createAskEntrySchema(questionSchema, answerSchema)

  // Return the record directly - Asks wraps a StructRef to this
  return Shape.record(AskEntrySchema)
}

/**
 * Infer the question type from an Asks schema.
 */
export type InferQuestion<T> = T extends RecordContainerShape<
  StructContainerShape<infer Shapes>
>
  ? Shapes extends { question: ValueShape }
    ? Shapes["question"]["_plain"]
    : never
  : never

/**
 * Infer the answer type from an Asks schema.
 */
export type InferAnswer<T> = T extends RecordContainerShape<
  StructContainerShape<infer Shapes>
>
  ? Shapes extends {
      answers: RecordContainerShape<
        DiscriminatedUnionValueShape<
          "status",
          { answered: StructValueShape<{ data: ValueShape }> }
        >
      >
    }
    ? Shapes["answers"]["shape"]["variants"]["answered"]["shape"]["data"]["_plain"]
    : never
  : never
