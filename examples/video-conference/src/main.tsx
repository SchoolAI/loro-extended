import { configure, getConsoleSink } from "@logtape/logtape"
import { SseClientNetworkAdapter } from "@loro-extended/adapters/network/sse/client"
import { RepoProvider } from "@loro-extended/react"
import { createRoot } from "react-dom/client"
import VideoConferenceApp from "./client/video-conference-app.tsx"
import "./index.css"
import { generatePeerId, type RepoParams } from "@loro-extended/repo"

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
  postUrl: "/loro/sync",
  eventSourceUrl: peerId => `/loro/events?peerId=${peerId}`,
})

// Get or create a persistent peerId
const STORAGE_KEY = "loro-video-conference-peer-id"
let peerId = localStorage.getItem(STORAGE_KEY) as `${number}` | null
if (!peerId) {
  peerId = generatePeerId()
  localStorage.setItem(STORAGE_KEY, peerId)
}

// Get or create a persistent display name
const NAME_STORAGE_KEY = "loro-video-conference-name"
let displayName = localStorage.getItem(NAME_STORAGE_KEY)
if (!displayName) {
  displayName = `User-${peerId.slice(-4)}`
  localStorage.setItem(NAME_STORAGE_KEY, displayName)
}

const config: RepoParams = {
  identity: {
    peerId,
    name: displayName,
    type: "user",
  },
  adapters: [sseAdapter],
}

createRoot(root).render(
  <RepoProvider config={config}>
    <VideoConferenceApp displayName={displayName} />
  </RepoProvider>,
)