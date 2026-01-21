import { type ChildProcess, spawn } from "node:child_process"

let serverProcess: ChildProcess | null = null

export async function startServer(): Promise<void> {
  serverProcess = spawn("pnpm", ["dev:server"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: "8004" },
    stdio: "pipe",
  })

  // Wait for server to be ready
  await waitForServer("http://localhost:8004")
}

export async function stopServer(): Promise<void> {
  if (serverProcess) {
    serverProcess.kill("SIGTERM")
    await new Promise(resolve => setTimeout(resolve, 1000))
    serverProcess = null
  }
}

async function waitForServer(url: string, timeout = 30000): Promise<void> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(url)
      if (response.ok || response.status === 404) {
        // Server is responding, even if endpoint doesn't exist
        return
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Server not ready at ${url} after ${timeout}ms`)
}
