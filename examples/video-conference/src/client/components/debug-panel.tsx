import { useState } from "react"
import type { ConnectionSource, DebugInfo } from "../hooks/use-debug-info"
import { truncateId } from "../hooks/use-debug-info"

export type DebugPanelProps = {
  debugInfo: DebugInfo
  onRefresh: () => void
}

type SectionProps = {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}

function Section({ title, children, defaultOpen = true }: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-slate-600 last:border-b-0">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-slate-700/50 transition-colors"
      >
        <span className="font-medium text-slate-200">{title}</span>
        <span className="text-slate-400">{isOpen ? "▼" : "▶"}</span>
      </button>
      {isOpen && <div className="px-3 pb-3 space-y-1">{children}</div>}
    </div>
  )
}

function InfoRow({
  label,
  value,
  status,
  title,
}: {
  label: string
  value: string | number
  status?: "good" | "warning" | "error" | "neutral"
  title?: string
}) {
  const statusColors = {
    good: "text-green-400",
    warning: "text-yellow-400",
    error: "text-red-400",
    neutral: "text-slate-300",
  }

  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <span
        className={`${statusColors[status ?? "neutral"]} cursor-default`}
        title={title}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * Component to display a truncated ID with full ID shown on hover.
 */
function TruncatedId({
  id,
  className = "",
}: {
  id: string
  className?: string
}) {
  return (
    <span className={`cursor-default ${className}`} title={id}>
      {truncateId(id)}
    </span>
  )
}

function Badge({
  children,
  variant = "neutral",
}: {
  children: React.ReactNode
  variant?: "good" | "warning" | "error" | "neutral"
}) {
  const variants = {
    good: "bg-green-500/20 text-green-400 border-green-500/30",
    warning: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    error: "bg-red-500/20 text-red-400 border-red-500/30",
    neutral: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  }

  return (
    <span
      className={`px-1.5 py-0.5 text-[10px] rounded border ${variants[variant]}`}
    >
      {children}
    </span>
  )
}

function getSourceVariant(
  source: ConnectionSource,
): "good" | "warning" | "error" | "neutral" {
  switch (source) {
    case "webrtc":
      return "good"
    case "sse":
    case "websocket":
      return "warning"
    case "other":
    default:
      return "neutral"
  }
}

/**
 * Debug panel component for diagnosing connectivity and state issues.
 *
 * Features:
 * - Fixed position overlay (bottom-right)
 * - Collapsible (minimized by default)
 * - Sections for Network, Loro Sync, WebRTC, and Presence status
 * - Auto-refresh with manual refresh button
 */
export function DebugPanel({ debugInfo, onRefresh }: DebugPanelProps) {
  const [isMinimized, setIsMinimized] = useState(true)

  if (isMinimized) {
    return (
      <button
        type="button"
        onClick={() => setIsMinimized(false)}
        className="fixed bottom-4 right-4 z-50 bg-slate-800 text-white px-3 py-2 rounded-lg shadow-lg hover:bg-slate-700 transition-colors flex items-center gap-2 text-sm border border-slate-600"
        title="Open Debug Panel"
      >
        <span>🔧</span>
        <span className="hidden sm:inline">Debug</span>
        {!debugInfo.isOnline && (
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        )}
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 max-h-[70vh] bg-slate-800 text-white rounded-lg shadow-xl border border-slate-600 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-700 border-b border-slate-600">
        <div className="flex items-center gap-2">
          <span>🔧</span>
          <span className="font-semibold text-sm">Debug Panel</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRefresh}
            className="p-1 hover:bg-slate-600 rounded transition-colors text-slate-400 hover:text-white"
            title="Refresh"
          >
            🔄
          </button>
          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            className="p-1 hover:bg-slate-600 rounded transition-colors text-slate-400 hover:text-white"
            title="Minimize"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="overflow-y-auto flex-1">
        {/* Network Status */}
        <Section title="🌐 Network Status">
          <InfoRow
            label="Internet Connection"
            value={debugInfo.isOnline ? "Online" : "Offline"}
            status={debugInfo.isOnline ? "good" : "error"}
          />
        </Section>

        {/* Loro Sync Status */}
        <Section title="🔄 Loro Sync Status">
          <InfoRow
            label="Local PeerID"
            value={truncateId(debugInfo.localPeerId)}
            title={debugInfo.localPeerId}
            status="neutral"
          />
          <InfoRow
            label="Connected Peers"
            value={debugInfo.connectedPeersCount}
            status={debugInfo.connectedPeersCount > 0 ? "good" : "warning"}
          />
          <InfoRow
            label="Channels"
            value={debugInfo.channels.length}
            status={debugInfo.channels.length > 0 ? "good" : "warning"}
          />

          {debugInfo.channels.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                Channel Details
              </div>
              {debugInfo.channels.map(channel => (
                <div
                  key={channel.channelId}
                  className="text-[10px] bg-slate-700/50 rounded px-2 py-1 flex items-center justify-between"
                >
                  <span className="text-slate-400">#{channel.channelId}</span>
                  <div className="flex items-center gap-1">
                    <Badge variant={channel.isEstablished ? "good" : "warning"}>
                      {channel.isEstablished ? "established" : "connecting"}
                    </Badge>
                    <Badge variant="neutral">{channel.kind}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* WebRTC Mesh Status */}
        <Section title="📡 WebRTC Mesh Status">
          <InfoRow
            label="Instance ID"
            value={truncateId(debugInfo.instanceId)}
            title={debugInfo.instanceId}
            status="neutral"
          />
          <InfoRow
            label="Peer Connections"
            value={debugInfo.peerConnections.length}
            status={debugInfo.peerConnections.length > 0 ? "good" : "neutral"}
          />
          <InfoRow
            label="Signal Queue"
            value={debugInfo.signalQueueSize}
            status={
              debugInfo.signalQueueSize === 0
                ? "good"
                : debugInfo.signalQueueSize > 10
                  ? "warning"
                  : "neutral"
            }
          />

          {debugInfo.peerConnections.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                Peer Connections
              </div>
              {debugInfo.peerConnections.map(peer => (
                <div
                  key={peer.remotePeerId}
                  className="text-[10px] bg-slate-700/50 rounded px-2 py-1"
                >
                  <div className="flex items-center justify-between">
                    <TruncatedId
                      id={peer.remotePeerId}
                      className="text-slate-400 font-mono"
                    />
                    <Badge
                      variant={
                        peer.connectionState === "connected"
                          ? "good"
                          : peer.connectionState === "failed"
                            ? "error"
                            : "warning"
                      }
                    >
                      {peer.connectionState}
                    </Badge>
                  </div>
                  {peer.remoteInstanceId && (
                    <div
                      className="text-slate-500 mt-0.5 cursor-default"
                      title={peer.remoteInstanceId}
                    >
                      Instance: {truncateId(peer.remoteInstanceId)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Presence Status */}
        <Section title="👥 Presence Status">
          <InfoRow
            label="User Presence"
            value={debugInfo.userPresenceCount}
            status={debugInfo.userPresenceCount > 0 ? "good" : "neutral"}
          />
          <InfoRow
            label="Signaling Presence"
            value={debugInfo.signalingPresenceCount}
            status={debugInfo.signalingPresenceCount > 0 ? "good" : "neutral"}
          />

          {debugInfo.presencePeers.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">
                Presence Peers
              </div>
              {debugInfo.presencePeers.map(peer => (
                <div
                  key={peer.peerId}
                  className="text-[10px] bg-slate-700/50 rounded px-2 py-1 flex items-center justify-between"
                >
                  <TruncatedId
                    id={peer.peerId}
                    className="text-slate-400 font-mono"
                  />
                  <div className="flex items-center gap-1">
                    {peer.sources.length > 0 ? (
                      peer.sources.map(source => (
                        <Badge
                          key={source}
                          variant={getSourceVariant(source)}
                        >
                          {source}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="neutral">unknown</Badge>
                    )}
                    {peer.hasUserPresence && (
                      <span title="Has user presence">👤</span>
                    )}
                    {peer.hasSignalingPresence && (
                      <span title="Has signaling presence">📶</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 bg-slate-700/50 border-t border-slate-600 text-[10px] text-slate-500">
        Auto-refreshes every 2s • Click 🔄 to refresh now
      </div>
    </div>
  )
}
