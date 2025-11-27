#!/usr/bin/env node
import path from "node:path"
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
`,
  {
    importMeta: import.meta,
  },
)

import fs from "fs"

let defaultDbPath = path.join(process.cwd(), "examples/chat/loro-chat-app.db")
if (!fs.existsSync(defaultDbPath)) {
  // Try relative to explorer dir
  const altPath = path.join(process.cwd(), "../chat/loro-chat-app.db")
  if (fs.existsSync(altPath)) {
    defaultDbPath = altPath
  }
}

const dbPath = cli.input[0] || defaultDbPath

render(<App dbPath={dbPath} />)
