import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useLocalMedia } from "./use-local-media"

describe("useLocalMedia", () => {
  // Mock MediaStream and tracks
  type MockTrack = {
    enabled: boolean
    stop: ReturnType<typeof vi.fn>
    getSettings: () => { deviceId: string }
    addEventListener: ReturnType<typeof vi.fn>
    removeEventListener: ReturnType<typeof vi.fn>
  }
  let mockAudioTrack: MockTrack
  let mockVideoTrack: MockTrack
  let mockStream: {
    getTracks: () => MockTrack[]
    getAudioTracks: () => MockTrack[]
    getVideoTracks: () => MockTrack[]
  }

  beforeEach(() => {
    mockAudioTrack = {
      enabled: true,
      stop: vi.fn(),
      getSettings: () => ({ deviceId: "mock-audio-device-id" }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    mockVideoTrack = {
      enabled: true,
      stop: vi.fn(),
      getSettings: () => ({ deviceId: "mock-video-device-id" }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    mockStream = {
      getTracks: () => [mockAudioTrack, mockVideoTrack],
      getAudioTracks: () => [mockAudioTrack],
      getVideoTracks: () => [mockVideoTrack],
    }

    // Mock getUserMedia and other mediaDevices methods
    Object.defineProperty(global.navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
        enumerateDevices: vi.fn().mockResolvedValue([
          {
            deviceId: "mock-audio-device-id",
            kind: "audioinput",
            label: "Mock Microphone",
          },
          {
            deviceId: "mock-video-device-id",
            kind: "videoinput",
            label: "Mock Camera",
          },
          {
            deviceId: "mock-speaker-device-id",
            kind: "audiooutput",
            label: "Mock Speaker",
          },
        ]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    })

    // Mock AudioContext for audio level monitoring
    global.AudioContext = vi.fn().mockImplementation(() => ({
      createAnalyser: vi.fn().mockReturnValue({
        fftSize: 256,
        frequencyBinCount: 128,
        smoothingTimeConstant: 0.8,
        getByteFrequencyData: vi.fn(),
      }),
      createMediaStreamSource: vi.fn().mockReturnValue({
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      close: vi.fn(),
      state: "running",
    })) as unknown as typeof AudioContext
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("initial state", () => {
    it("starts with wantsAudio and wantsVideo based on initial props", async () => {
      const { result } = renderHook(() => useLocalMedia(true, false))

      // Check synchronous initial state
      expect(result.current.wantsAudio).toBe(true)
      expect(result.current.wantsVideo).toBe(false)

      // Wait for async media request to complete to avoid act() warning
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })

    it("starts with isMediaReady false", async () => {
      const { result } = renderHook(() => useLocalMedia())

      // Check synchronous initial state
      expect(result.current.isMediaReady).toBe(false)

      // Wait for async media request to complete
      await waitFor(() => {
        expect(result.current.isMediaReady).toBe(true)
      })
    })

    it("starts with isLoading true (auto-requests media)", async () => {
      const { result } = renderHook(() => useLocalMedia())

      // Check synchronous initial state
      expect(result.current.isLoading).toBe(true)

      // Wait for async media request to complete
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })
  })

  describe("user preferences (wantsAudio/wantsVideo)", () => {
    it("toggleAudio toggles wantsAudio immediately", async () => {
      const { result } = renderHook(() => useLocalMedia(true, true))

      // Wait for initial media request to complete
      await waitFor(() => {
        expect(result.current.isMediaReady).toBe(true)
      })

      expect(result.current.wantsAudio).toBe(true)

      act(() => {
        result.current.toggleAudio()
      })

      expect(result.current.wantsAudio).toBe(false)

      act(() => {
        result.current.toggleAudio()
      })

      expect(result.current.wantsAudio).toBe(true)
    })

    it("toggleVideo toggles wantsVideo immediately", async () => {
      const { result } = renderHook(() => useLocalMedia(true, true))

      // Wait for initial media request to complete
      await waitFor(() => {
        expect(result.current.isMediaReady).toBe(true)
      })

      expect(result.current.wantsVideo).toBe(true)

      act(() => {
        result.current.toggleVideo()
      })

      expect(result.current.wantsVideo).toBe(false)

      act(() => {
        result.current.toggleVideo()
      })

      expect(result.current.wantsVideo).toBe(true)
    })

    it("setWantsAudio sets wantsAudio directly", async () => {
      const { result } = renderHook(() => useLocalMedia(true, true))

      // Wait for initial media request to complete
      await waitFor(() => {
        expect(result.current.isMediaReady).toBe(true)
      })

      act(() => {
        result.current.setWantsAudio(false)
      })

      expect(result.current.wantsAudio).toBe(false)
    })

    it("setWantsVideo sets wantsVideo directly", async () => {
      const { result } = renderHook(() => useLocalMedia(true, true))

      // Wait for initial media request to complete
      await waitFor(() => {
        expect(result.current.isMediaReady).toBe(true)
      })

      act(() => {
        result.current.setWantsVideo(false)
      })

      expect(result.current.wantsVideo).toBe(false)
    })
  })

  describe("media acquisition", () => {
    it("auto-requests media on mount", async () => {
      renderHook(() => useLocalMedia(true, true))

      await waitFor(() => {
        expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
          audio: true,
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user",
          },
        })
      })
    })

    it("sets isMediaReady to true after successful getUserMedia", async () => {
      const { result } = renderHook(() => useLocalMedia(true, true))

      await waitFor(() => {
        expect(result.current.isMediaReady).toBe(true)
      })
    })

    it("sets stream after successful getUserMedia", async () => {
      const { result } = renderHook(() => useLocalMedia(true, true))

      await waitFor(() => {
        expect(result.current.stream).toBe(mockStream)
      })
    })

    it("sets error on getUserMedia failure", async () => {
      const mockError = new Error("Permission denied")
      vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
        mockError,
      )

      const { result } = renderHook(() => useLocalMedia(true, true))

      await waitFor(() => {
        expect(result.current.error).toEqual(mockError)
        expect(result.current.isMediaReady).toBe(false)
      })
    })
  })

  describe("track state synchronization", () => {
    it("syncs audio track enabled state with wantsAudio", async () => {
      const { result } = renderHook(() => useLocalMedia(true, true))

      await waitFor(() => {
        expect(result.current.isMediaReady).toBe(true)
      })

      expect(mockAudioTrack.enabled).toBe(true)

      act(() => {
        result.current.toggleAudio()
      })

      await waitFor(() => {
        expect(mockAudioTrack.enabled).toBe(false)
        expect(result.current.hasAudio).toBe(false)
      })
    })

    it("syncs video track enabled state with wantsVideo", async () => {
      const { result } = renderHook(() => useLocalMedia(true, true))

      await waitFor(() => {
        expect(result.current.isMediaReady).toBe(true)
      })

      expect(mockVideoTrack.enabled).toBe(true)

      act(() => {
        result.current.toggleVideo()
      })

      await waitFor(() => {
        expect(mockVideoTrack.enabled).toBe(false)
        expect(result.current.hasVideo).toBe(false)
      })
    })

    it("hasAudio reflects actual track state", async () => {
      const { result } = renderHook(() => useLocalMedia(true, true))

      await waitFor(() => {
        expect(result.current.hasAudio).toBe(true)
      })

      act(() => {
        result.current.toggleAudio()
      })

      await waitFor(() => {
        expect(result.current.hasAudio).toBe(false)
      })
    })

    it("hasVideo reflects actual track state", async () => {
      const { result } = renderHook(() => useLocalMedia(true, true))

      await waitFor(() => {
        expect(result.current.hasVideo).toBe(true)
      })

      act(() => {
        result.current.toggleVideo()
      })

      await waitFor(() => {
        expect(result.current.hasVideo).toBe(false)
      })
    })
  })

  describe("cleanup", () => {
    it("stops all tracks on unmount", async () => {
      // Create a mock with stop tracking and all required methods
      const audioTrack = {
        enabled: true,
        stop: vi.fn(),
        kind: "audio",
        getSettings: () => ({ deviceId: "cleanup-audio-device-id" }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }
      const videoTrack = {
        enabled: true,
        stop: vi.fn(),
        kind: "video",
        getSettings: () => ({ deviceId: "cleanup-video-device-id" }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }
      const stream = {
        getTracks: () => [audioTrack, videoTrack],
        getAudioTracks: () => [audioTrack],
        getVideoTracks: () => [videoTrack],
      }

      vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValueOnce(
        stream as unknown as MediaStream,
      )

      const { result, unmount } = renderHook(() => useLocalMedia(true, true))

      await waitFor(() => {
        expect(result.current.isMediaReady).toBe(true)
      })

      // Verify stream is set
      expect(result.current.stream).toBe(stream)

      // Unmount - cleanup should run synchronously via ref
      unmount()

      // Tracks should be stopped immediately (not via setState)
      expect(audioTrack.stop).toHaveBeenCalled()
      expect(videoTrack.stop).toHaveBeenCalled()
    })
  })
})
