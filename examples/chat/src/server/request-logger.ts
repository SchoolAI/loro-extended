import type { RequestHandler } from "express"

// request logging middleware
export const requestLogger = (): RequestHandler => (req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`)
  if (req.method === "POST" && req.url.includes("/sync")) {
    console.log("POST body:", JSON.stringify(req.body).substring(0, 200))
  }
  next()
}
