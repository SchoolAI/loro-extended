import { SseClientNetworkAdapter } from "@loro-extended/adapters/network/sse/client"
import { RepoProvider, Shape, useDocument } from "@loro-extended/hono"
import {
  generatePeerId,
  type PeerID,
  type RepoParams,
} from "@loro-extended/repo"
import { hc } from "hono/client"
import { useMemo, useState } from "hono/jsx"
import { render } from "hono/jsx/dom"
import type { AppType } from "./index.js"

const client = hc<AppType>("/")

// Define the counter document schema using Shape.counter() which is a CRDT
const counterSchema = Shape.doc({
  count: Shape.counter(),
})

const emptyState = { count: 0 }

// Generate a unique peer ID for this client (must be a numeric string)
const peerId = generatePeerId()

// Create the repo config (RepoProvider will create the Repo)
const repoConfig: RepoParams = {
  identity: { name: "hono-counter-client", type: "user", peerId },
  adapters: [
    new SseClientNetworkAdapter({
      postUrl: (_peerId: PeerID) => `/sync/post`,
      eventSourceUrl: (peerId: PeerID) => `/sync/subscribe?peerId=${peerId}`,
    }),
  ],
}

function App() {
  // Memoize config to prevent re-creating Repo on every render
  const config = useMemo(() => repoConfig, [])

  return (
    <RepoProvider config={config}>
      <h1>Loro + Hono Counter</h1>
      <h2>Synced Counter (using useDocument)</h2>
      <SyncedCounter />
      <h2>Server Time (API example)</h2>
      <ClockButton />
    </RepoProvider>
  )
}

function SyncedCounter() {
  const [doc, changeDoc] = useDocument("counter", counterSchema, emptyState)

  const increment = () => {
    changeDoc(draft => {
      // Shape.counter() provides a CRDT counter with increment method
      draft.count.increment(1)
    })
  }

  const decrement = () => {
    changeDoc(draft => {
      draft.count.decrement(1)
    })
  }

  return (
    <div>
      <p>
        Count: <strong>{doc.count}</strong>
      </p>
      <p>
        <button type="button" onClick={decrement}>
          -
        </button>{" "}
        <button type="button" onClick={increment}>
          +
        </button>
      </p>
    </div>
  )
}

const ClockButton = () => {
  const [response, setResponse] = useState<string | null>(null)

  const handleClick = async () => {
    const response = await client.api.clock.$get()
    const data = await response.json()
    const headers = (
      Array.from(response.headers.entries()) as [string, string][]
    ).reduce<Record<string, string>>((acc, [key, value]) => {
      acc[key] = value
      return acc
    }, {})
    const fullResponse = {
      url: response.url,
      status: response.status,
      headers,
      body: data,
    }
    setResponse(JSON.stringify(fullResponse, null, 2))
  }

  return (
    <div>
      <button type="button" onClick={handleClick}>
        Get Server Time
      </button>
      {response && <pre>{response}</pre>}
    </div>
  )
}

const root = document.getElementById("root")

if (!root) {
  throw new Error("`root` element not found in DOM")
}

render(<App />, root)
