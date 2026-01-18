// Core class

// Aggregation utilities
export {
  allAnswers,
  allHaveStatus,
  firstAnswer,
  hasStatus,
  pickOne,
} from "./aggregation.js"
export { Askforce, DEFAULT_CLAIM_WINDOW_MS } from "./askforce.js"

// Presence utilities (public API)
export {
  addActiveAsk,
  createWorkerPresence,
  DEFAULT_HEARTBEAT_INTERVAL,
  removeActiveAsk,
  updateHeartbeat,
} from "./presence.js"
export type { InferAnswer, InferQuestion } from "./schema.js"
// Schema factory
export { createAskforceSchema } from "./schema.js"

// Types
export type {
  AnsweredAnswer,
  AskEntry,
  AskforceErrorContext,
  AskforceOptions,
  AskHandler,
  AskStatus,
  FailedAnswer,
  OnAskOptions,
  PendingAnswer,
  WorkerAnswer,
  WorkerAnswerStatus,
  WorkerPresence,
} from "./types.js"

// Error class
export { AskforceError } from "./types.js"
