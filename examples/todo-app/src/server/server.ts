import { SseServerNetworkAdapter } from "@loro-extended/adapters/network/sse/server"
import { LevelDBStorageAdapter } from "@loro-extended/adapters/storage/level-db/server"
import { Repo } from "@loro-extended/repo"
import cors from "cors"
import express from "express"

const app = express()
app.use(cors())
app.use(express.json())

// 1. Create the adapter instances.
const sseAdapter = new SseServerNetworkAdapter()
const storageAdapter = new LevelDBStorageAdapter("loro-todo-app.db")

// 2. Create the Repo, passing the adapters in the config.
// The repo is not directly used, but its constructor sets up the listeners
// between the network and storage adapters.
new Repo({
  storage: storageAdapter,
  network: [sseAdapter],
})

// 3. Mount the adapter's routes onto our Express app under the "/loro" prefix.
app.use("/loro", sseAdapter.getExpressRouter())

const PORT = process.env.PORT || 5170
app.listen(PORT, () => {
  console.log(
    `Loro-Extended Todo App Server listening on http://localhost:${PORT}`,
  )
})
