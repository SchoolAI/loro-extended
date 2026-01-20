// Core class

// Aggregation utilities
export {
  allAnswers,
  allHaveStatus,
  firstAnswer,
  hasStatus,
  pickOne,
} from "./aggregation.js"
export { Asks, DEFAULT_CLAIM_WINDOW_MS } from "./asks.js"

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
export { createAskSchema } from "./schema.js"

// Types
export type {
  AnsweredAnswer,
  AskEntry,
  AskHandler,
  AskStatus,
  AsksErrorContext,
  AsksOptions,
  FailedAnswer,
  OnAskOptions,
  PendingAnswer,
  WorkerAnswer,
  WorkerAnswerStatus,
  WorkerPresence,
} from "./types.js"

// Error class
export { AsksError } from "./types.js"
