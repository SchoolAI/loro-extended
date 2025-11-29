import type { DocId } from "@loro-extended/repo"

export type HeaderProps = {
  roomId: DocId
  participantCount: number
  isCopied: boolean
  onCopyLink: () => void
  onNewRoom: () => void
}

export function Header({
  roomId,
  participantCount,
  isCopied,
  onCopyLink,
  onNewRoom,
}: HeaderProps) {
  return (
    <header className="bg-slate-800 text-white shadow-md z-10">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-green-500 p-2 rounded-lg">
            <span className="text-xl">📹</span>
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Video Conference</h1>
            <div className="text-xs text-slate-400">
              Room: {roomId.slice(0, 20)}...
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 text-slate-300 text-sm">
            <span>👥</span>
            <span>{participantCount}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCopyLink}
              className="p-2 hover:bg-slate-700 rounded-full transition-colors text-slate-300 hover:text-white"
              title="Copy Link"
            >
              {isCopied ? "✅" : "🔗"}
            </button>
            <button
              type="button"
              onClick={onNewRoom}
              className="bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded-full text-sm font-medium transition-colors shadow-sm"
            >
              New Room
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}