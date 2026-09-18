// 위키링크를 따라 함께 공유할 문서를 너비 우선으로 모은다. D1 을 모르는 순수 함수 (specs/features/F-252.md 2.2)
import { findWikiLinks, resolveWikiTarget } from '../src/lib/wikiLink'

export type SetNode = { id: string; title: string; depth: number; parentId: string | null }
export type LoadDoc = (id: string) => { id: string; title: string; content: string } | null
export type DocTitle = { id: string; title: string }

export interface CollectWikiSetOptions {
  maxDepth?: number
  maxNodes?: number
}

export interface CollectWikiSetResult {
  nodes: SetNode[]
  truncated: boolean
}

function extractWikiTargets(content: string): string[] {
  const targets: string[] = []
  for (const line of content.split(/\r\n|\r|\n/)) {
    for (const match of findWikiLinks(line)) targets.push(match.target)
  }
  return targets
}

export function collectWikiSet(
  rootId: string,
  loadDoc: LoadDoc,
  allDocs: DocTitle[],
  opts: CollectWikiSetOptions = {},
): CollectWikiSetResult {
  const maxDepth = opts.maxDepth ?? 5
  const maxNodes = opts.maxNodes ?? 50
  const seen = new Set<string>([rootId])
  const nodes: SetNode[] = []
  let truncated = false
  const queue: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }]

  while (queue.length > 0) {
    const current = queue.shift()!
    const doc = loadDoc(current.id)
    if (!doc) continue

    for (const target of extractWikiTargets(doc.content)) {
      const found = resolveWikiTarget(target, allDocs)
      if (!found || seen.has(found.id)) continue

      const depth = current.depth + 1
      if (depth > maxDepth || nodes.length >= maxNodes) {
        truncated = true
        continue
      }

      seen.add(found.id)
      nodes.push({ id: found.id, title: found.title, depth, parentId: current.id })
      queue.push({ id: found.id, depth })
    }
  }

  return { nodes, truncated }
}
