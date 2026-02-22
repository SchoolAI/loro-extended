// Re-export everything from the modular implementation

export type { HttpPollingExpressRouterOptions } from "./express-router.js"
export { createHttpPollingExpressRouter } from "./express-router.js"
export type {
  PollingPostResponse,
  PollingPostResult,
} from "./polling-handler.js"
export { parsePostBody } from "./polling-handler.js"
export {
  HttpPollingConnection,
  HttpPollingServerNetworkAdapter,
} from "./server-adapter.js"
