import { type ChildProcess, spawn } from "node:child_process"
import * as fs from "node:fs/promises"
import * as path from "node:path"

let serverProcess: ChildProcess | null = null

export async function cleanDatabase(): Promise<void> {
  const dbPath = path.join(process.cwd(), "loro-todo-app.db")
  try {
    await fs.rm(dbPath, { recursive: true, force: true })
  } catch (_error: unknown) {
    // Ignore errors if directory doesn't exist
  }
}

export async function startServer(cleanDb = false): Promise<void> {
  if (cleanDb) {
    await cleanDatabase()
  }

  serverProcess = spawn("pnpm", ["dev:server"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: "5170" },
    stdio: "pipe",
  })

  // Wait for server to be ready
  await waitForServer("http://localhost:5170/loro")
}

export async function stopServer(): Promise<void> {
  if (serverProcess) {
    serverProcess.kill("SIGTERM")
    await new Promise(resolve => setTimeout(resolve, 1000))
    serverProcess = null
  }
}

async function waitForServer(url: string, timeout = 10000): Promise<void> {
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
