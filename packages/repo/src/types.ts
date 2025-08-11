import type { Container, LoroDoc } from "loro-crdt"

export type DocumentId = string
export type PeerId = string
export type DocContent = Record<string, Container>

export type LoroDocMutator<T extends DocContent> = (doc: LoroDoc<T>) => void
