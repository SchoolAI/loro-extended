import { configure, getConsoleSink } from "@logtape/logtape"
import { SseClientNetworkAdapter } from "@loro-extended/adapter-sse/client"
import { WebRtcDataChannelAdapter } from "@loro-extended/adapter-webrtc"
import { RepoProvider } from "@loro-extended/react"
import { generatePeerId, type RepoParams } from "@loro-extended/repo"
import { createRoot } from "react-dom/client"
import "./index.css"
import VideoConferenceApp from "./video-conference-app.tsx"

const PEER_ID_STORAGE_KEY = "loro-video-conference-peer-id"
const NAME_STORAGE_KEY = "loro-video-conference-name"

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

// WebRTC adapter for peer-to-peer sync
// Data channels will be attached when WebRTC connections are established
const webrtcAdapter = new WebRtcDataChannelAdapter()

// Get or create a per-tab peerId using sessionStorage
// This ensures each browser tab gets a unique identity
let peerId = sessionStorage.getItem(PEER_ID_STORAGE_KEY) as `${number}` | null
if (!peerId) {
  peerId = generatePeerId()
  sessionStorage.setItem(PEER_ID_STORAGE_KEY, peerId)
}

// Get or create a display name (use localStorage so it persists across sessions)
// But generate it based on the session-specific peerId
let displayName = sessionStorage.getItem(NAME_STORAGE_KEY)
if (!displayName) {
  // Try to get a base name from localStorage, or create one
  const baseName = localStorage.getItem(NAME_STORAGE_KEY)
  displayName = baseName || `User-${peerId.slice(-4)}`
  sessionStorage.setItem(NAME_STORAGE_KEY, displayName)
}

const config: RepoParams = {
  identity: {
    peerId,
    name: displayName,
    type: "user",
  },
  adapters: [sseAdapter, webrtcAdapter],
}

createRoot(root).render(
  <RepoProvider config={config}>
    <VideoConferenceApp
      displayName={displayName}
      webrtcAdapter={webrtcAdapter}
    />
  </RepoProvider>,
)
