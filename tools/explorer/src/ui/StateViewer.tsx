import { Box, Text, useInput, useStdout } from "ink"
import { type default as React, useState } from "react"
import { useQuitOnQ } from "./hooks.js"

interface StateViewerProps {
  state: unknown
}

export const StateViewer: React.FC<StateViewerProps> = ({ state }) => {
  useQuitOnQ()
  const { stdout } = useStdout()
  const height = stdout ? stdout.rows : 20
  const viewerHeight = Math.max(5, height - 8) // Subtract borders and header
  const width = stdout ? stdout.columns : 80
  const viewerWidth = Math.max(20, width - 4) // Subtract borders and padding

  const [scrollTop, setScrollTop] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  const jsonString = JSON.stringify(state, null, 2)
  const lines = jsonString.split("\n")

  const horizontalScrollStep = 15
  const maxLineLength = Math.max(...lines.map(line => line.length))

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
    // Horizontal scrolling with left/right arrows or h/l keys
    if (key.leftArrow || input === "h" || input === "H") {
      setScrollLeft(prev => Math.max(0, prev - horizontalScrollStep))
    }
    if (key.rightArrow || input === "l" || input === "L") {
      setScrollLeft(prev =>
        Math.min(
          Math.max(0, maxLineLength - viewerWidth + 100),
          prev + horizontalScrollStep,
        ),
      )
    }
  })

  const visibleLines = lines
    .slice(scrollTop, scrollTop + viewerHeight)
    .map(line => line.slice(scrollLeft) || " ")

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
          L{Math.min(scrollTop + 1, lines.length)}-
          {Math.min(scrollTop + visibleLines.length, lines.length)}/
          {lines.length}
          {scrollLeft > 0 ? ` C${scrollLeft + 1}` : ""} (←→/hl:horiz)
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {visibleLines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static list for display
          <Text key={scrollTop + i} wrap="truncate-end">
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  )
}
