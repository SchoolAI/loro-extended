import { useCallback, useEffect, useRef, useState } from "react"

export type UseAudioLevelReturn = {
  /** Audio level from 0-100 */
  audioLevel: number
  /** Whether audio monitoring is active */
  isMonitoring: boolean
  /** Start monitoring audio levels */
  startMonitoring: () => void
  /** Stop monitoring audio levels */
  stopMonitoring: () => void
}

/**
 * Hook to monitor audio levels from a MediaStream using Web Audio API.
 *
 * @param stream - The MediaStream to monitor (typically from getUserMedia)
 * @param enabled - Whether to actively monitor (set to false when muted to save resources)
 */
export function useAudioLevel(
  stream: MediaStream | null,
  enabled: boolean = true,
): UseAudioLevelReturn {
  const [audioLevel, setAudioLevel] = useState(0)
  const [isMonitoring, setIsMonitoring] = useState(false)

  // Refs for Web Audio API objects
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null)

  const stopMonitoring = useCallback(() => {
    // Cancel animation frame
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    // Disconnect source
    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    analyserRef.current = null
    dataArrayRef.current = null
    setIsMonitoring(false)
    setAudioLevel(0)
  }, [])

  const startMonitoring = useCallback(() => {
    if (!stream || !enabled) {
      return
    }

    // Check if stream has audio tracks
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      return
    }

    // Clean up any existing monitoring
    stopMonitoring()

    try {
      // Create audio context
      const audioContext = new AudioContext()
      audioContextRef.current = audioContext

      // Create analyser node
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      analyserRef.current = analyser

      // Create source from stream
      const source = audioContext.createMediaStreamSource(stream)
      sourceRef.current = source

      // Connect source to analyser (don't connect to destination to avoid feedback)
      source.connect(analyser)

      // Create data array for frequency data
      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)
      dataArrayRef.current = dataArray

      setIsMonitoring(true)

      // Animation loop to read audio levels
      const updateLevel = () => {
        if (!analyserRef.current || !dataArrayRef.current) {
          return
        }

        analyserRef.current.getByteFrequencyData(dataArrayRef.current)

        // Calculate average level
        let sum = 0
        for (let i = 0; i < dataArrayRef.current.length; i++) {
          sum += dataArrayRef.current[i]
        }
        const average = sum / dataArrayRef.current.length

        // Normalize to 0-100 range with some amplification for better visual feedback
        const normalizedLevel = Math.min(100, Math.round((average / 128) * 100))
        setAudioLevel(normalizedLevel)

        animationFrameRef.current = requestAnimationFrame(updateLevel)
      }

      updateLevel()
    } catch (err) {
      console.error("Failed to start audio monitoring:", err)
      stopMonitoring()
    }
  }, [stream, enabled, stopMonitoring])

  // Start/stop monitoring based on stream and enabled state
  useEffect(() => {
    if (stream && enabled) {
      startMonitoring()
    } else {
      stopMonitoring()
    }

    return () => {
      stopMonitoring()
    }
  }, [stream, enabled, startMonitoring, stopMonitoring])

  // Handle audio track enabled/disabled changes
  useEffect(() => {
    if (!stream) return

    const handleTrackChange = () => {
      const hasEnabledAudioTrack = stream.getAudioTracks().some(t => t.enabled)
      if (!hasEnabledAudioTrack) {
        setAudioLevel(0)
      }
    }

    // Listen to track events
    const audioTracks = stream.getAudioTracks()
    for (const track of audioTracks) {
      track.addEventListener("ended", handleTrackChange)
      track.addEventListener("mute", handleTrackChange)
      track.addEventListener("unmute", handleTrackChange)
    }

    return () => {
      for (const track of audioTracks) {
        track.removeEventListener("ended", handleTrackChange)
        track.removeEventListener("mute", handleTrackChange)
        track.removeEventListener("unmute", handleTrackChange)
      }
    }
  }, [stream])

  return {
    audioLevel,
    isMonitoring,
    startMonitoring,
    stopMonitoring,
  }
}
