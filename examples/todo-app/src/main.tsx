import { configure, getConsoleSink } from "@logtape/logtape"
import { SseClientNetworkAdapter } from "@loro-extended/adapters/network/sse/client"
import { RepoProvider } from "@loro-extended/react"
import { createRoot } from "react-dom/client"
import App from "./client/app.tsx"
import "./index.css"
import type { RepoParams } from "@loro-extended/repo"

// Configure LogTape to log everything to console
await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [
    {
      category: ["@loro-extended"],
      lowestLevel: "debug", // Enable debug logging to see sync details
      sinks: ["console"],
    },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
  ],
})

const root = document.getElementById("root")
if (!root) {
  throw new Error("Not found: DOM 'root' element")
}

// Create the Repo config so it's a singleton.
// Connect directly to the backend server (no proxy)
const sseAdapter = new SseClientNetworkAdapter({
  postUrl: "http://localhost:5170/loro/sync",
  eventSourceUrl: peerId =>
    `http://localhost:5170/loro/events?peerId=${peerId}`,
})

const config: RepoParams = {
  adapters: [sseAdapter],
}

createRoot(root).render(
  <RepoProvider config={config}>
    <App />
  </RepoProvider>,
)
