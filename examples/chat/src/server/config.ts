import dotenv from "dotenv"
import { getLlmModel } from "./llm-model.js"
import { configureLogger } from "./logger.js"

dotenv.config({ override: true })

// Configure LogTape
export const logger = await configureLogger()

// Get OpenRouter API key
const apiKey = process.env.OPENROUTER_API_KEY

if (!apiKey) {
  logger.error`OPENROUTER_API_KEY not set`
  process.exit(1)
}

export const model = getLlmModel(apiKey)

if (!model) {
  logger.error`LLM model could not be created`
  process.exit(1)
}
