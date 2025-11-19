import { createOpenRouter } from "@openrouter/ai-sdk-provider"

export function getLlmModel(apiKey: string) {
  // Stream from LLM
  const openrouter = createOpenRouter({ apiKey })

  return openrouter("openai/gpt-4o")
}
