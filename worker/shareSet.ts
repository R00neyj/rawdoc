// 위키링크를 따라 함께 공유할 문서를 너비 우선으로 모은다. D1 을 모르는 순수 함수 (specs/features/F-252.md 2.2, F-2018 10장)
import { findWikiLinks } from '../src/lib/wikiLink'
import { createWikiResolver, type WikiDocRef, type WikiFolderRef, type WikiResolver } from '../src/lib/wikiResolve'

export type SetNode = { id: string; title: string; depth: number; parentId: string | null }
export type LoadDoc = (id: string) => { id: string; title: string; content: string } | null

export interface CollectWikiSetOptions {
  maxDepth?: number
  maxNodes?: number
}

export interface CollectWikiSetResult {
  nodes: SetNode[]
  truncated: boolean
}

// [[#헤딩]](target '') 은 다른 문서를 가리키지 않아 뺀다 (F-2018 3.1)
function extractWikiTargets(content: string): string[] {
  const targets: string[] = []
  for (const line of content.split(/\r\n|\r|\n/)) {
    for (const match of findWikiLinks(line)) {
      if (match.target !== '') targets.push(match.target)
    }
  }
  return targets
}

// allDocs 는 updated_at 내림차순. 방문하는 문서의 folderId 를 원본으로 해석한다 (F-2018 10.1)
export function collectWikiSet(
  rootId: string,
  loadDoc: LoadDoc,
  allDocs: WikiDocRef[],
  folders: WikiFolderRef[],
  opts: CollectWikiSetOptions = {},
): CollectWikiSetResult {
  const maxDepth = opts.maxDepth ?? 5
  const maxNodes = opts.maxNodes ?? 50
  const resolver = createWikiResolver(allDocs, folders)
  const folderOf = new Map(allDocs.map((d) => [d.id, d.folderId]))
  const seen = new Set<string>([rootId])
  const nodes: SetNode[] = []
  let truncated = false
  const queue: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }]

  while (queue.length > 0) {
    const current = queue.shift()!
    const doc = loadDoc(current.id)
    if (!doc) continue
    const sourceFolderId = folderOf.get(current.id) ?? null

    for (const target of extractWikiTargets(doc.content)) {
      const found = resolver.resolve(target, sourceFolderId)
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

// 공개 묶음 링크 표 — 묶음 안 문서로 풀린 대상만, 키는 findWikiLinks 의 target 그대로. content 는 stripComments 를 거친 값 (F-2018 10.2)
export function buildWikiLinkTable(
  content: string,
  sourceFolderId: string | null,
  resolver: WikiResolver,
  allowedIds: ReadonlySet<string>,
): Record<string, string> {
  const table: Record<string, string> = {}
  for (const target of extractWikiTargets(content)) {
    if (Object.prototype.hasOwnProperty.call(table, target)) continue
    const found = resolver.resolve(target, sourceFolderId)
    if (!found || !allowedIds.has(found.id)) continue
    Object.defineProperty(table, target, { value: found.id, enumerable: true, writable: true, configurable: true })
  }
  return table
}
