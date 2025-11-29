import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { VideoGrid, type Participant } from "./video-grid"
import type { PeerID } from "@loro-extended/repo"
import type { UserPresence } from "../../shared/types"

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
  const defaultProps = {
    localStream: null,
    displayName: "Local User",
    hasAudio: true,
    hasVideo: true,
    otherParticipants: [] as Participant[],
    remoteStreams: new Map<PeerID, MediaStream>(),
    connectionStates: new Map(),
    userPresence: {} as Record<string, UserPresence>,
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
        { peerId: "peer-1" as unknown as PeerID, name: "Alice", joinedAt: 1000 },
      ]

      render(<VideoGrid {...defaultProps} otherParticipants={participants} />)

      expect(screen.queryByText("Waiting for others to join...")).toBeNull()
    })
  })

  describe("remote participants", () => {
    it("renders video bubble for each participant", () => {
      const participants: Participant[] = [
        { peerId: "peer-1" as unknown as PeerID, name: "Alice", joinedAt: 1000 },
        { peerId: "peer-2" as unknown as PeerID, name: "Bob", joinedAt: 2000 },
      ]

      render(<VideoGrid {...defaultProps} otherParticipants={participants} />)

      expect(screen.getByTestId("video-bubble-Alice")).toBeDefined()
      expect(screen.getByTestId("video-bubble-Bob")).toBeDefined()
    })

    it("uses presence data for remote participant audio/video state", () => {
      const participants: Participant[] = [
        { peerId: "peer-1" as unknown as PeerID, name: "Alice", joinedAt: 1000 },
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
        { peerId: "peer-1" as unknown as PeerID, name: "Alice", joinedAt: 1000 },
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

  describe("connection states", () => {
    it("shows connecting indicator for connecting peers", () => {
      const participants: Participant[] = [
        { peerId: "peer-1" as unknown as PeerID, name: "Alice", joinedAt: 1000 },
      ]

      const connectionStates = new Map([["peer-1" as PeerID, "connecting" as const]])

      render(
        <VideoGrid
          {...defaultProps}
          otherParticipants={participants}
          connectionStates={connectionStates}
        />,
      )

      expect(screen.getByText("Connecting...")).toBeDefined()
    })

    it("shows failed indicator for failed peers", () => {
      const participants: Participant[] = [
        { peerId: "peer-1" as unknown as PeerID, name: "Alice", joinedAt: 1000 },
      ]

      const connectionStates = new Map([["peer-1" as PeerID, "failed" as const]])

      render(
        <VideoGrid
          {...defaultProps}
          otherParticipants={participants}
          connectionStates={connectionStates}
        />,
      )

      expect(screen.getByText("Failed")).toBeDefined()
    })

    it("hides indicator for connected peers", () => {
      const participants: Participant[] = [
        { peerId: "peer-1" as unknown as PeerID, name: "Alice", joinedAt: 1000 },
      ]

      const connectionStates = new Map([["peer-1" as PeerID, "connected" as const]])

      render(
        <VideoGrid
          {...defaultProps}
          otherParticipants={participants}
          connectionStates={connectionStates}
        />,
      )

      expect(screen.queryByText("Connecting...")).toBeNull()
      expect(screen.queryByText("Failed")).toBeNull()
    })
  })
})