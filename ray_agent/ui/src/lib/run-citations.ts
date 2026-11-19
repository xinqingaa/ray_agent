import type {KnowledgeReference} from '@/lib/api/types'

/** 保持引用索引与回复中的角标顺序一致。 */
export function citationIdentifiers(text: string) {
  return [...new Set(Array.from(text.matchAll(/\]\(#rayagent-source-([a-zA-Z0-9_-]{1,128})\)/g), match => match[1]))]
}

export function resolveRunCitations(identifiers: string[], sources: KnowledgeReference[]) {
  return identifiers.flatMap(id => sources.find(source => source.source_type === 'document_chunk' && source.source_id === id) ?? [])
}
