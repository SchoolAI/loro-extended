// Re-export everything from the modular implementation

export type { SseExpressRouterOptions } from "./express-router.js"
export { createSseExpressRouter } from "./express-router.js"
export { SseConnection, SseServerNetworkAdapter } from "./server-adapter.js"