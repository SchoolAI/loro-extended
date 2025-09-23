#!/usr/bin/env node
/**
 * Converts a JSONL log file to a Mermaid sequence diagram.
 *
 * Usage:
 *   ts-node log-to-mermaid.ts <input-file> [output-file]
 *
 * Example:
 *   ts-node log-to-mermaid.ts log.jsonl diagram.mmd
 */

import * as fs from "node:fs"
import { z } from "zod"

// Zod schemas for log entry parsing
const IdentitySchema = z.object({
  name: z.string(),
})

const ChannelMessageSchema = z.object({
  identity: IdentitySchema.optional(),
  docId: z.string().optional(),
  docs: z.array(z.object({ docId: z.string() })).optional(),
})

const ChannelSchema = z.object({
  publishDocId: z.string().optional(),
  channelId: z.number().optional(),
})

const LogEntrySchema = z.object({
  "@timestamp": z.string(),
  level: z.string(),
  message: z.string(),
  logger: z.string(),
  identity: IdentitySchema,
  type: z.string().optional(),
  docId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  via: z.number().optional(),
  dir: z.enum(["send", "recv"]).optional(),
  channelMessage: ChannelMessageSchema.optional(),
  channel: ChannelSchema.optional(),
})

type LogEntry = z.infer<typeof LogEntrySchema>

interface Message {
  from: string
  to: string
  dir: "send" | "recv" | "self"
  label: string
  parenthetical?: string
}

function parseLogLine(line: string): LogEntry | null {
  try {
    const parsed = JSON.parse(line)
    return LogEntrySchema.parse(parsed)
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.warn(`Skipping invalid log entry: ${error.message}`)
    } else if (error instanceof Error) {
      console.warn(`Error parsing log line: ${error.message}`)
    }
    return null
  }
}

function extractMessages(entries: LogEntry[]): Message[] {
  const messages: Message[] = []

  for (const entry of entries) {
    const repoName = entry.identity.name
    const messageType = entry.message || entry.type
    if (!messageType) continue

    // Handle msg/ prefixed messages (repo to itself)
    if (messageType.startsWith("msg/")) {
      const docId = entry.docId || entry.channel?.channelId?.toString()

      messages.push({
        from: repoName,
        to: repoName,
        dir: "self",
        label: messageType,
        parenthetical: docId,
      })
    }
    // Handle channel/ prefixed messages (from one repo to another)
    else if (messageType.startsWith("channel/")) {
      const fromRepo = entry.from || entry.channelMessage?.identity?.name
      if (fromRepo && entry.dir) {
        const docId = entry.channelMessage?.docId || entry.docId

        messages.push({
          from: fromRepo,
          to: entry.to ?? "unknown",
          dir: entry.dir,
          label: messageType,
          parenthetical: docId
            ? `${docId} / via chan ${entry.via}`
            : `via chan ${entry.via}`,
        })
      }
    }
  }

  return messages
}

function generateMermaidDiagram(messages: Message[]): string {
  const lines: string[] = ["sequenceDiagram"]

  // Extract unique participants
  const participants = new Set<string>()
  for (const msg of messages) {
    participants.add(msg.from)
    participants.add(msg.to)
  }

  // Add participant declarations
  for (const participant of Array.from(participants).sort()) {
    lines.push(`    participant ${participant}`)
  }

  lines.push("") // Empty line for readability

  // Add messages
  for (const msg of messages) {
    const docInfo = msg.parenthetical ? ` (${msg.parenthetical})` : ""
    const arrow = msg.dir === "send" || msg.dir === "self" ? "->>" : "-->>"
    lines.push(`    ${msg.from}${arrow}${msg.to}: ${msg.label}${docInfo}`)
  }

  return lines.join("\n")
}

function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error("Usage: ts-node log-to-mermaid.ts <input-file> [output-file]")
    console.error("Example: ts-node log-to-mermaid.ts log.jsonl diagram.mmd")
    process.exit(1)
  }

  const inputFile = args[0]
  const outputFile = args[1]

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file '${inputFile}' not found`)
    process.exit(1)
  }

  // Read and parse the JSONL file
  const content = fs.readFileSync(inputFile, "utf-8")
  const lines = content.split("\n").filter(line => line.trim())

  const entries: LogEntry[] = []
  for (const line of lines) {
    const entry = parseLogLine(line)
    if (entry) {
      entries.push(entry)
    }
  }

  console.log(`Parsed ${entries.length} log entries`)

  // Extract messages
  const messages = extractMessages(entries)
  console.log(`Extracted ${messages.length} messages`)

  // Generate Mermaid diagram
  const diagram = generateMermaidDiagram(messages)

  // Output
  if (outputFile) {
    fs.writeFileSync(outputFile, diagram)
    console.log(`Mermaid diagram written to ${outputFile}`)
  } else {
    console.log("\n" + diagram)
  }
}

main()
