import type { PeerID } from "@loro-extended/repo"

type Player = {
  peerId: PeerID
  name: string
  color: string
}

type PlayerListProps = {
  players: Player[]
  myPeerId: PeerID
}

export function PlayerList({ players, myPeerId }: PlayerListProps) {
  if (players.length === 0) {
    return null
  }

  return (
    <div className="player-list">
      <div className="player-list-title">Active Players</div>
      {players.map(player => (
        <div key={player.peerId} className="player-list-item">
          <div
            className="player-color-dot"
            style={{ backgroundColor: player.color }}
          />
          <span>
            {player.name}
            {player.peerId === myPeerId && " (you)"}
          </span>
        </div>
      ))}
    </div>
  )
}
