#!/usr/bin/env node
import fs from "node:fs"
import { render } from "ink"
import meow from "meow"
import { App } from "./ui/App.js"

const cli = meow(
  `
	Usage
	  $ loro-explorer [path-to-db]

	Options
	  --help     Show help

	Examples
	  $ loro-explorer ./my-app.db
	  $ loro-explorer ./my-app.db ../../examples/chat/loro-chat-app.db
`,
  {
    importMeta: import.meta,
  },
)

const dbPath = cli.input[0]

if (!dbPath) {
  console.error(`Error: Database path is required`)
  console.error(`\nExample: loro-explorer ../../examples/chat/loro-chat-app.db`)
  process.exit(1)
}

// Validate that the database path exists and is a directory
if (!fs.existsSync(dbPath)) {
  console.error(`Error: Database path does not exist: ${dbPath}`)
  console.error(
    `\nPlease provide a valid path to a LevelDB database directory.`,
  )
  console.error(`Example: loro-explorer ./my-app.db`)
  process.exit(1)
}

const stats = fs.statSync(dbPath)
if (!stats.isDirectory()) {
  console.error(`Error: Database path is not a directory: ${dbPath}`)
  console.error(
    `\nLevelDB databases are stored as directories. Please provide a valid database directory.`,
  )
  process.exit(1)
}

render(<App dbPath={dbPath} />)
