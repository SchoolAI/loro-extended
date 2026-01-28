/**
 * Identity Extraction - Shared between server and client
 *
 * This module provides identity extraction from commit messages.
 * The identity is used by lens filters to validate that players
 * can only modify their own data.
 */

import z from "zod"

export const SERVER_PLAYER_ID = "server"

export const gameIdentitySchema = z.object({
  playerId: z.string(),
})

/**
 * Game identity for commit messages
 */
export type GameIdentity = z.infer<typeof gameIdentitySchema>

/**
 * Create an identity message to be set as the commit message.
 *
 * Call `loro(doc).doc.setNextCommitMessage(createIdentityMessage(playerId))`
 * before making changes to include identity in the commit.
 *
 * @param playerId - The player ID to include in the identity
 * @returns JSON string to use as commit message
 */
export function createIdentityMessage(playerId: string): string {
  return JSON.stringify({ playerId } satisfies GameIdentity)
}

/**
 * Extract game identity from a commit message.
 *
 * Used by the server's `identify` function to extract identity
 * from each commit during filtering.
 *
 * @param msg - The commit message (may be undefined)
 * @returns The extracted identity, or null if no valid identity found
 */
export function parseIdentityMessage(msg: unknown): GameIdentity | null {
  if (!msg) return null

  const { data, success } = gameIdentitySchema.safeParse(msg)

  if (success) {
    return data
  }

  console.warn("unable to parse identity message", msg)

  return null
}
