import type { CommitInfo, LensFilter } from "@loro-extended/lens"
import { parseIdentityMessage, SERVER_PLAYER_ID } from "../shared/identity.js"
import type { GameDoc } from "../shared/schema.js"

export const makeGameFilter =
  (doc: GameDoc): LensFilter =>
  (info: CommitInfo) => {
    console.dir({ gameFilter: info }, { depth: null })

    // This could be cryptographically signed, but is not for this demo
    const identity = parseIdentityMessage(info.message)

    if (!identity) return false

    if (identity.playerId === SERVER_PLAYER_ID) return true

    console.log("gameFilter (B)", identity.playerId, info.raw.ops)

    return true
  }
// export const gameFilter: LensFilter = (info: CommitInfo) => {
//   console.dir({ gameFilter: info }, { depth: null })

//   // This could be cryptographically signed, but is not for this demo
//   const identity = parseIdentityMessage(info.message)

//   if (!identity) return false

//   if (identity.playerId === SERVER_PLAYER_ID) return true

//   console.log("gameFilter (B)", identity.playerId, info.raw.ops)

//   return true
// }
