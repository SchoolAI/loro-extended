import type { ContainerID, Diff, LoroDoc, LoroEventBatch } from "loro-crdt"

export type DiffOverlay = ReadonlyMap<ContainerID, Diff>

export function createDiffOverlay(
  doc: LoroDoc,
  batch: LoroEventBatch,
): DiffOverlay {
  return new Map(doc.diff(batch.to, batch.from, false))
}
