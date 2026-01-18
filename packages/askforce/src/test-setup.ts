// Test setup for Askforce package
// This file is run before each test file

import { configure } from "@logtape/logtape"

// Configure logging for tests (silent by default)
configure({
  sinks: {},
  loggers: [
    {
      category: ["@loro-extended"],
      lowestLevel: "fatal",
      sinks: [],
    },
  ],
})
