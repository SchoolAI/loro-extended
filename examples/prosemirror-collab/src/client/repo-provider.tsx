/**
 * RepoProvider wrapper for the collaborative ProseMirror app.
 *
 * Provides the Loro Repo via React context with:
 * - WebSocket adapter for real-time sync
 * - IndexedDB adapter for offline persistence (disabled for now)
 */

// import { IndexedDBStorageAdapter } from "@loro-extended/adapter-indexeddb"
import { WsClientNetworkAdapter } from "@loro-extended/adapter-websocket/client"
import { RepoProvider } from "@loro-extended/react"
import { generatePeerId } from "@loro-extended/repo"
import type { ReactNode } from "react"

const PEER_ID_KEY = "prosemirror-collab-peer-id"
const USER_NAME_KEY = "prosemirror-collab-user-name"

/**
 * Validate that a peerId is a valid numeric string.
 */
function isValidNumericPeerId(peerId: string): boolean {
  return /^\d+$/.test(peerId) && Number.isFinite(Number(peerId))
}

/**
 * Get or create a persistent peer ID.
 * Loro expects peerId to be a non-negative integer string.
 */
function getOrCreatePeerId(): `${number}` {
  const existingPeerId = localStorage.getItem(PEER_ID_KEY)

  if (existingPeerId && isValidNumericPeerId(existingPeerId)) {
    return existingPeerId as `${number}`
  }

  const newPeerId = generatePeerId()
  localStorage.setItem(PEER_ID_KEY, newPeerId)
  return newPeerId as `${number}`
}

/**
 * Get or create a persistent user name.
 */
export function getOrCreateUserName(): string {
  const existingName = localStorage.getItem(USER_NAME_KEY)
  if (existingName) {
    return existingName
  }

  const peerId = getOrCreatePeerId()
  const defaultName = `User-${peerId.slice(-4)}`
  localStorage.setItem(USER_NAME_KEY, defaultName)
  return defaultName
}

/**
 * Save user name to localStorage.
 */
export function saveUserName(name: string): void {
  localStorage.setItem(USER_NAME_KEY, name)
}

/**
 * Generate a consistent color from a peerId.
 */
export function getUserColor(peerId: string): string {
  const hash = peerId.split("").reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0)
    return a & a
  }, 0)
  return `hsl(${Math.abs(hash) % 360}, 70%, 50%)`
}

const persistentPeerId = getOrCreatePeerId()

// Create the WebSocket network adapter
export const wsAdapter = new WsClientNetworkAdapter({
  url: peerId => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    return `${protocol}//${window.location.host}/ws?peerId=${peerId}`
  },
  reconnect: {
    enabled: true,
    maxAttempts: 10,
    baseDelay: 1000,
    maxDelay: 30000,
  },
  keepaliveInterval: 30000,
})

/**
 * Create the IndexedDB storage adapter for offline support
 * NOTE: Disabled for now as it can make debugging sync issues harder
 */
// const storageAdapter = new IndexedDBStorageAdapter()

// Repo configuration
const repoConfig = {
  identity: {
    name: "browser-client",
    type: "user" as const,
    peerId: persistentPeerId,
  },
  adapters: [wsAdapter],
}

interface AppRepoProviderProps {
  children: ReactNode
}

/**
 * Wraps the application with RepoProvider.
 */
export function AppRepoProvider({ children }: AppRepoProviderProps) {
  return <RepoProvider config={repoConfig}>{children}</RepoProvider>
}
