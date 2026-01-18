import {
  type DiscriminatedUnionValueShape,
  type RecordContainerShape,
  Shape,
  type StructContainerShape,
  type StructValueShape,
  type ValueShape,
} from "@loro-extended/change"

/**
 * The shape for a pending worker answer.
 */
export const PendingAnswerShape = Shape.plain.struct({
  status: Shape.plain.string("pending"),
  claimedAt: Shape.plain.number(),
})

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
 * Creates a typed Askforce schema with question and answer validation.
 *
 * @param questionSchema - The shape for the question data
 * @param answerSchema - The shape for the answer data
 * @returns A record schema keyed by ask ID
 *
 * @example
 * ```typescript
 * const MyQueueSchema = createAskforceSchema(
 *   Shape.plain.struct({ query: Shape.plain.string() }),   // Question
 *   Shape.plain.struct({ result: Shape.plain.string() })   // Answer
 * );
 * // MyQueueSchema is Record<string, AskEntry> - keyed by ask ID
 * ```
 */
export function createAskforceSchema<
  Q extends ValueShape,
  A extends ValueShape,
>(questionSchema: Q, answerSchema: A) {
  const WorkerAnswerSchema = createWorkerAnswerSchema(answerSchema)

  const AskEntrySchema = Shape.struct({
    id: Shape.plain.string(),
    question: questionSchema,
    askedAt: Shape.plain.number(),
    askedBy: Shape.plain.string(),
    // Each worker writes to their own slot - no write conflicts
    answers: Shape.record(WorkerAnswerSchema),
  })

  // Return the record directly - Askforce wraps a StructRef to this
  return Shape.record(AskEntrySchema)
}

/**
 * Infer the question type from an Askforce schema.
 */
export type InferQuestion<T> = T extends RecordContainerShape<
  StructContainerShape<infer Shapes>
>
  ? Shapes extends { question: ValueShape }
    ? Shapes["question"]["_plain"]
    : never
  : never

/**
 * Infer the answer type from an Askforce schema.
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
