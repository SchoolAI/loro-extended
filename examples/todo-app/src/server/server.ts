import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import cors from "cors"
import express from "express"

import { Repo } from "@loro-extended/repo"
import { LevelStorageAdapter } from "./LevelStorageAdapter.js"
import { SseServerNetworkAdapter } from "./SseServerNetworkAdapter.js"

const app = express()
app.use(cors())
app.use(express.json())

// 1. Create the adapter instances.
const sseAdapter = new SseServerNetworkAdapter()
const storageAdapter = new LevelStorageAdapter("loro-todo-app.db")

// 2. Create the Repo, passing the adapters in the config.
// The repo is not directly used, but its constructor sets up the listeners
// between the network and storage adapters.
// @ts-expect-error - repo is declared but its value is not read
const repo = new Repo({
  storage: storageAdapter,
  network: [sseAdapter],
})

// 3. Mount the adapter's routes onto our Express app under the "/loro" prefix.
app.use("/loro", sseAdapter.getExpressRouter())

// 4. In production, serve the static frontend assets.
// The `resolve` and `dirname` logic is to correctly locate the `dist`
// directory relative to this server file.
if (process.env.NODE_ENV === "production") {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  app.use(express.static(resolve(__dirname, "../../dist")))

  // 5. Fallback for client-side routing in production.
  app.get("*", (_req, res) => {
    res.sendFile(resolve(__dirname, "../../dist/index.html"))
  })
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(
    `Loro-Extended Todo App Server listening on http://localhost:${PORT}`,
  )
})
