import { Box, Text, useInput, useStdout } from "ink"
import { type default as React, useEffect, useState } from "react"
import { useQuitOnQ } from "./hooks.js"

interface StateViewerProps {
  state: unknown
}

export const StateViewer: React.FC<StateViewerProps> = ({ state }) => {
  useQuitOnQ()
  const { stdout } = useStdout()
  const height = stdout ? stdout.rows : 20
  const viewerHeight = Math.max(5, height - 6) // Subtract borders and header

  const [scrollTop, setScrollTop] = useState(0)

  const jsonString = JSON.stringify(state, null, 2)
  const lines = jsonString.split("\n")

  // Reset scroll when state changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset scroll when content changes
  useEffect(() => {
    setScrollTop(0)
  }, [jsonString])

  useInput((input, key) => {
    if (key.pageDown || (key.shift && input === "J")) {
      setScrollTop(prev =>
        Math.min(lines.length - viewerHeight, prev + viewerHeight),
      )
    }
    if (key.pageUp || (key.shift && input === "K")) {
      setScrollTop(prev => Math.max(0, prev - viewerHeight))
    }
    // Also allow single line scrolling with shift+arrow
    if (key.shift && key.downArrow) {
      setScrollTop(prev => Math.min(lines.length - viewerHeight, prev + 1))
    }
    if (key.shift && key.upArrow) {
      setScrollTop(prev => Math.max(0, prev - 1))
    }
  })

  const visibleLines = lines.slice(scrollTop, scrollTop + viewerHeight)

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="white"
      padding={1}
      flexGrow={1}
      height={height - 2}
    >
      <Box justifyContent="space-between">
        <Text bold underline>
          Document State
        </Text>
        <Text color="gray">
          {Math.min(scrollTop + 1, lines.length)}-
          {Math.min(scrollTop + visibleLines.length, lines.length)} of{" "}
          {lines.length} (Shift+Arrows/PgUp/PgDn)
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {visibleLines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static list for display
          <Text key={i}>{line}</Text>
        ))}
      </Box>
    </Box>
  )
}
