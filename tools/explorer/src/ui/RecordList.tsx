import { format } from "date-fns"
import { Box, Text, useInput, useStdout } from "ink"
import type React from "react"
import type { Record } from "../db.js"
import { useQuitOnQ } from "./hooks.js"

interface RecordListProps {
  docId: string
  records: Record[]
  selectedIndex: number
  onSelectIndex: (index: number) => void
  onBack: () => void
}

export const RecordList: React.FC<RecordListProps> = ({
  docId,
  records,
  selectedIndex,
  onSelectIndex,
  onBack,
}) => {
  useQuitOnQ()
  const { stdout } = useStdout()
  const height = stdout ? stdout.rows : 20
  // Adjusted calculation:
  // Border(2) + Padding(2) + Header(3) + Margins(2) + Footer(3) = 12 lines overhead
  const listHeight = Math.max(5, height - 13)

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      onSelectIndex(Math.max(0, selectedIndex - 1))
    }
    if (key.downArrow || input === "j") {
      onSelectIndex(Math.min(records.length - 1, selectedIndex + 1))
    }
    if (key.escape) {
      onBack()
    }
  })

  // Calculate scroll window
  const windowSize = listHeight
  const start = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(windowSize / 2),
      records.length - windowSize,
    ),
  )
  const end = Math.min(records.length, start + windowSize)
  const visibleRecords = records.slice(start, end)

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      borderStyle="single"
      borderColor="green"
      padding={1}
      width="20"
      height={height - 2}
    >
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="green" underline>
          Records for {docId.slice(0, 12)}...
        </Text>
        <Text color="gray" dimColor>
          (Esc to back)
        </Text>
      </Box>

      <Box flexDirection="column">
        {visibleRecords.map((record, i) => {
          const actualIndex = start + i
          const isSelected = actualIndex === selectedIndex
          const date = new Date(Number.parseInt(record.timestamp, 10))

          return (
            <Box key={record.key}>
              <Text color={isSelected ? "green" : "white"} bold={isSelected}>
                {isSelected ? "> " : "  "}
                {format(date, "HH:mm:ss.SSSS")}
                {" - "}
                {record.type === "update" ? "U" : "S"}
              </Text>
            </Box>
          )
        })}
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor="gray">
        <Text>
          {selectedIndex + 1} / {records.length}
        </Text>
      </Box>
    </Box>
  )
}
