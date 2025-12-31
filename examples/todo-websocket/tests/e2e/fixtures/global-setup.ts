import * as fs from "node:fs/promises"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

export default async function globalSetup() {
  // Clean the database before running tests
  // Use the same path resolution as the server
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  )
  const dbPath = path.resolve(root, "todo-vite.db")
  try {
    await fs.rm(dbPath, { recursive: true, force: true })
    console.log("Cleaned database:", dbPath)
  } catch (_error: unknown) {
    // Ignore errors if directory doesn't exist
  }
}
