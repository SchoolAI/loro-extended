import { Box, Text, useStdout } from "ink"
import SelectInput from "ink-select-input"
import type React from "react"
import { useQuitOnQ } from "./hooks.js"

interface DocListProps {
  docIds: string[]
  initialSelectedId?: string
  onSelect: (docId: string) => void
}

export const DocList: React.FC<DocListProps> = ({
  docIds,
  initialSelectedId,
  onSelect,
}) => {
  useQuitOnQ()
  const { stdout } = useStdout()
  const height = stdout ? stdout.rows : 20
  const listHeight = Math.max(5, height - 6) // Subtract borders and header

  if (docIds.length === 0) {
    return (
      <Box borderStyle="single" borderColor="gray" padding={1}>
        <Text color="yellow">No documents found in database.</Text>
      </Box>
    )
  }

  const items = docIds.map(id => ({
    label: id,
    value: id,
  }))

  const initialIndex = initialSelectedId ? docIds.indexOf(initialSelectedId) : 0

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="blue"
      padding={1}
      minWidth={30}
    >
      <Text bold color="blue" underline>
        Documents ({docIds.length})
      </Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={item => onSelect(item.value)}
          limit={listHeight}
          initialIndex={initialIndex >= 0 ? initialIndex : 0}
        />
      </Box>
    </Box>
  )
}
