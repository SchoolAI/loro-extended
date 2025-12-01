import { configure, getConsoleSink } from "@logtape/logtape"
import { WsClientNetworkAdapter } from "@loro-extended/adapter-websocket/client"
import { RepoProvider } from "@loro-extended/react"
import { generatePeerId, type RepoParams } from "@loro-extended/repo"
import { createRoot } from "react-dom/client"
import BumperCarsApp from "./client/bumper-cars-app.tsx"
import "./index.css"

// Configure LogTape to log everything to console
await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [
    {
      category: ["@loro-extended"],
      lowestLevel: "debug",
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

// Create WebSocket adapter
const wsAdapter = new WsClientNetworkAdapter({
  url: peerId => `/ws?peerId=${peerId}`,
  reconnect: { enabled: true },
})

// Get or create a persistent peerId
const STORAGE_KEY = "loro-bumper-cars-peer-id"
let peerId = localStorage.getItem(STORAGE_KEY) as `${number}` | null
if (!peerId) {
  peerId = generatePeerId()
  localStorage.setItem(STORAGE_KEY, peerId)
}

// Get or create a persistent display name
const NAME_STORAGE_KEY = "loro-bumper-cars-name"
let displayName = localStorage.getItem(NAME_STORAGE_KEY)
if (!displayName) {
  displayName = `Player-${peerId.slice(-4)}`
  localStorage.setItem(NAME_STORAGE_KEY, displayName)
}

// Get or create a persistent color
const COLOR_STORAGE_KEY = "loro-bumper-cars-color"
const savedColor = localStorage.getItem(COLOR_STORAGE_KEY)

const config: RepoParams = {
  identity: {
    peerId,
    name: displayName,
    type: "user",
  },
  adapters: [wsAdapter],
}

createRoot(root).render(
  <RepoProvider config={config}>
    <BumperCarsApp initialName={displayName} initialColor={savedColor} />
  </RepoProvider>,
)
