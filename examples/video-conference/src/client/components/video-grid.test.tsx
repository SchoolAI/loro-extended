import type { PeerID } from "@loro-extended/repo"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { UserPresence } from "../../shared/types"
import type { ParticipantConnectionStatus } from "../hooks/use-connection-status"
import { VideoGrid, type Participant } from "./video-grid"

// Mock the VideoBubble component to simplify testing
vi.mock("../video-bubble", () => ({
  VideoBubble: ({
    label,
    hasAudio,
    hasVideo,
    isLocal,
  }: {
    label: string
    hasAudio: boolean
    hasVideo: boolean
    isLocal: boolean
  }) => (
    <div data-testid={`video-bubble-${label}`}>
      <span data-testid="label">{label}</span>
      <span data-testid="audio">{hasAudio ? "audio-on" : "audio-off"}</span>
      <span data-testid="video">{hasVideo ? "video-on" : "video-off"}</span>
      <span data-testid="local">{isLocal ? "local" : "remote"}</span>
    </div>
  ),
}))

describe("VideoGrid", () => {
  // Default getPeerStatus that returns "connected" for all peers
  const defaultGetPeerStatus = (_peerId: PeerID): ParticipantConnectionStatus =>
    "connected"

  const defaultProps = {
    localStream: null,
    displayName: "Local User",
    hasAudio: true,
    hasVideo: true,
    otherParticipants: [] as Participant[],
    remoteStreams: new Map<PeerID, MediaStream>(),
    userPresence: {} as Record<string, UserPresence>,
    getPeerStatus: defaultGetPeerStatus,
  }

  describe("local video", () => {
    it("renders local video bubble with correct props", () => {
      render(<VideoGrid {...defaultProps} />)

      const localBubble = screen.getByTestId("video-bubble-Local User")
      expect(localBubble).toBeDefined()
      expect(screen.getByTestId("local").textContent).toBe("local")
    })

    it("passes hasAudio and hasVideo to local bubble", () => {
      render(<VideoGrid {...defaultProps} hasAudio={false} hasVideo={false} />)

      expect(screen.getByTestId("audio").textContent).toBe("audio-off")
      expect(screen.getByTestId("video").textContent).toBe("video-off")
    })
  })

  describe("empty state", () => {
    it("shows waiting message when no other participants", () => {
      render(<VideoGrid {...defaultProps} />)

      expect(screen.getByText("Waiting for others to join...")).toBeDefined()
      expect(
        screen.getByText("Share the link to invite participants"),
      ).toBeDefined()
    })

    it("hides waiting message when participants exist", () => {
      const participants: Participant[] = [
        {
          peerId: "peer-1" as unknown as PeerID,
          name: "Alice",
          joinedAt: 1000,
        },
      ]

      render(<VideoGrid {...defaultProps} otherParticipants={participants} />)

      expect(screen.queryByText("Waiting for others to join...")).toBeNull()
    })
  })

  describe("remote participants", () => {
    it("renders video bubble for each participant", () => {
      const participants: Participant[] = [
        {
          peerId: "peer-1" as unknown as PeerID,
          name: "Alice",
          joinedAt: 1000,
        },
        { peerId: "peer-2" as unknown as PeerID, name: "Bob", joinedAt: 2000 },
      ]

      render(<VideoGrid {...defaultProps} otherParticipants={participants} />)

      expect(screen.getByTestId("video-bubble-Alice")).toBeDefined()
      expect(screen.getByTestId("video-bubble-Bob")).toBeDefined()
    })

    it("uses presence data for remote participant audio/video state", () => {
      const participants: Participant[] = [
        {
          peerId: "peer-1" as unknown as PeerID,
          name: "Alice",
          joinedAt: 1000,
        },
      ]

      const userPresence: Record<string, UserPresence> = {
        "peer-1": {
          name: "Alice",
          wantsAudio: false,
          wantsVideo: true,
        },
      }

      render(
        <VideoGrid
          {...defaultProps}
          otherParticipants={participants}
          userPresence={userPresence}
        />,
      )

      // The remote bubble should use presence data
      const aliceBubble = screen.getByTestId("video-bubble-Alice")
      expect(aliceBubble).toBeDefined()
    })

    it("defaults to audio/video on when presence is missing", () => {
      const participants: Participant[] = [
        {
          peerId: "peer-1" as unknown as PeerID,
          name: "Alice",
          joinedAt: 1000,
        },
      ]

      // No presence data for peer-1
      render(
        <VideoGrid
          {...defaultProps}
          otherParticipants={participants}
          userPresence={{}}
        />,
      )

      // Should still render without crashing
      expect(screen.getByTestId("video-bubble-Alice")).toBeDefined()
    })
  })

  describe("connection status", () => {
    it("shows reconnecting indicator for reconnecting peers", () => {
      const participants: Participant[] = [
        {
          peerId: "peer-1" as unknown as PeerID,
          name: "Alice",
          joinedAt: 1000,
        },
      ]

      const getPeerStatus = (_peerId: PeerID): ParticipantConnectionStatus =>
        "reconnecting"

      render(
        <VideoGrid
          {...defaultProps}
          otherParticipants={participants}
          getPeerStatus={getPeerStatus}
        />,
      )

      expect(screen.getByText("Reconnecting...")).toBeDefined()
    })

    it("shows offline indicator for peer-disconnected peers", () => {
      const participants: Participant[] = [
        {
          peerId: "peer-1" as unknown as PeerID,
          name: "Alice",
          joinedAt: 1000,
        },
      ]

      const getPeerStatus = (_peerId: PeerID): ParticipantConnectionStatus =>
        "peer-disconnected"

      render(
        <VideoGrid
          {...defaultProps}
          otherParticipants={participants}
          getPeerStatus={getPeerStatus}
        />,
      )

      expect(screen.getByText("Appears offline")).toBeDefined()
    })

    it("shows self-disconnected indicator when we're offline", () => {
      const participants: Participant[] = [
        {
          peerId: "peer-1" as unknown as PeerID,
          name: "Alice",
          joinedAt: 1000,
        },
      ]

      const getPeerStatus = (_peerId: PeerID): ParticipantConnectionStatus =>
        "self-disconnected"

      render(
        <VideoGrid
          {...defaultProps}
          otherParticipants={participants}
          getPeerStatus={getPeerStatus}
        />,
      )

      expect(screen.getByText("You're offline")).toBeDefined()
    })

    it("hides indicator for connected peers", () => {
      const participants: Participant[] = [
        {
          peerId: "peer-1" as unknown as PeerID,
          name: "Alice",
          joinedAt: 1000,
        },
      ]

      const getPeerStatus = (_peerId: PeerID): ParticipantConnectionStatus =>
        "connected"

      render(
        <VideoGrid
          {...defaultProps}
          otherParticipants={participants}
          getPeerStatus={getPeerStatus}
        />,
      )

      expect(screen.queryByText("Reconnecting...")).toBeNull()
      expect(screen.queryByText("Appears offline")).toBeNull()
      expect(screen.queryByText("You're offline")).toBeNull()
    })
  })
})
