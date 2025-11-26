import { Box, Text } from "ink"
import { type default as React, useEffect, useMemo, useState } from "react"
import { LevelDBReader, type Record } from "../db.js"
import { DocumentReconstructor } from "../engine.js"
import { DocList } from "./DocList.js"
import { RecordList } from "./RecordList.js"
import { StateViewer } from "./StateViewer.js"

interface AppProps {
  dbPath: string
}

export const App: React.FC<AppProps> = ({ dbPath }) => {
  const [db, setDb] = useState<LevelDBReader | null>(null)
  const [docIds, setDocIds] = useState<string[]>([])
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [lastSelectedDocId, setLastSelectedDocId] = useState<
    string | undefined
  >(undefined)
  const [records, setRecords] = useState<Record[]>([])
  const [selectedRecordIndex, setSelectedRecordIndex] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)

  // Initialize DB
  useEffect(() => {
    const reader = new LevelDBReader(dbPath)
    setDb(reader)

    reader
      .listDocIds()
      .then(setDocIds)
      .catch(err => setError(String(err)))

    return () => {
      reader.close().catch(console.error)
    }
  }, [dbPath])

  // Load records when doc is selected
  useEffect(() => {
    if (!db || !selectedDocId) return

    db.getRecords(selectedDocId)
      .then(recs => {
        setRecords(recs)
        setSelectedRecordIndex(recs.length - 1) // Default to latest
      })
      .catch(err => setError(String(err)))
  }, [db, selectedDocId])

  // Reconstruct state
  const currentState = useMemo(() => {
    if (records.length === 0) return null
    const reconstructor = new DocumentReconstructor(records)
    return reconstructor.getStateAt(selectedRecordIndex)
  }, [records, selectedRecordIndex])

  if (error) {
    return <Text color="red">Error: {error}</Text>
  }

  if (!db) {
    return <Text>Loading database...</Text>
  }

  return (
    <Box flexDirection="row" height="100%">
      {!selectedDocId ? (
        <DocList
          docIds={docIds}
          initialSelectedId={lastSelectedDocId}
          onSelect={id => {
            setSelectedDocId(id)
            setLastSelectedDocId(id)
          }}
        />
      ) : (
        <>
          <RecordList
            docId={selectedDocId}
            records={records}
            selectedIndex={selectedRecordIndex}
            onSelectIndex={setSelectedRecordIndex}
            onBack={() => {
              setSelectedDocId(null)
              setRecords([])
            }}
          />
          <StateViewer state={currentState} />
        </>
      )}
    </Box>
  )
}
