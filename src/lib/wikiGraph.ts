// 위키링크 관계 뽑기·그래프 만들기·부분 그래프. 순수 함수, DOM·CM6·markdown-it·React·저장소를 import 하지 않는다 (specs/features/F-292.md 3장, architecture.md 1장)
import { findWikiLinks } from './wikiLink'
import { findFrontmatter } from './frontmatter'

// 펜스 코드블록 여닫기 (3.2). 줄 앞 공백은 몇 칸이든, 목록 항목 안(`2. ```)이어도 펜스로 본다
// — CommonMark 는 목록 항목 안의 펜스를 인정하는데, 공백 0~3칸만 보면 그 여는 펜스를 놓치고
// 뒤따르는 닫는 펜스를 여는 펜스로 잡아 그 뒤 문서 전체가 코드블록이 된다
// (2026-09-21 실제 문서에서 위키링크 5개가 통째로 빠졌다)
const FENCE_RE = /^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})([^\n]*)$/

type Fence = { char: string; len: number; info: string }

function matchFence(line: string): Fence | null {
  const match = FENCE_RE.exec(line)
  if (!match) return null
  const marks = match[1]
  const info = match[2]
  // 백틱 펜스의 정보 문자열에는 백틱이 못 들어간다(CommonMark) — `- ```코드``` ` 같은 인라인코드를 펜스로 잡지 않는다
  if (marks[0] === '`' && info.includes('`')) return null
  return { char: marks[0], len: marks.length, info: info.trim() }
}

// 표 구분 줄 — `| --- | :--: |` 모양의 근사 판정 (3.2)
const TABLE_DELIMITER_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

// 백틱 쌍 사이를 같은 길이의 공백으로 덮는다 — 위치가 어긋나지 않게 한다 (3.2 인라인 코드)
function maskInlineCode(line: string): string {
  const runs: { start: number; end: number; len: number }[] = []
  const re = /`+/g
  let match: RegExpExecArray | null
  while ((match = re.exec(line))) {
    runs.push({ start: match.index, end: match.index + match[0].length, len: match[0].length })
  }
  if (runs.length < 2) return line

  const chars = line.split('')
  let i = 0
  while (i < runs.length) {
    const open = runs[i]
    let j = i + 1
    while (j < runs.length && runs[j].len !== open.len) j++
    if (j < runs.length) {
      for (let k = open.start; k < runs[j].end; k++) chars[k] = ' '
      i = j + 1
    } else {
      break // 짝 없는 백틱은 그대로 둔다
    }
  }
  return chars.join('')
}

// 문서 원문 한 덩어리에서 위키링크 대상 제목을 순서대로 뽑는다 (3.2)
export function extractWikiTargets(content: string): string[] {
  if (typeof content !== 'string' || content === '') return []

  const fm = findFrontmatter(content)
  const body = fm ? content.slice(fm.to) : content
  const lines = body.split(/\r\n|\r|\n/)

  const targets: string[] = []
  let openFence: Fence | null = null
  let inTable = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const fence = matchFence(line)
    if (openFence) {
      // 닫는 펜스는 여는 펜스와 같은 글자로 같은 수 이상이고, 정보 문자열을 갖지 않는다(CommonMark)
      if (fence && fence.char === openFence.char && fence.len >= openFence.len && fence.info === '') {
        openFence = null
      }
      continue
    }
    if (fence) {
      openFence = fence
      continue
    }

    if (!inTable && line.includes('|')) {
      const next = lines[i + 1]
      if (next !== undefined && next.includes('-') && TABLE_DELIMITER_RE.test(next)) {
        inTable = true
      }
    }
    if (inTable) {
      if (line.trim() === '') inTable = false
      continue
    }

    const masked = maskInlineCode(line)
    for (const link of findWikiLinks(masked)) {
      targets.push(link.target)
    }
  }

  return targets
}

export type WikiGraph = {
  nodes: { id: string; title: string; missing: boolean; degree: number }[]
  edges: { from: number; to: number }[]
  unreadable: string[]
}

// mapIndex.ts 가 이미 뽑아 둔 대상 목록을 재사용할 때 쓰는 낮은 단계 입력 (5.3 재사용)
export type WikiGraphEntry = { id: string; title: string; targets: string[]; unreadable?: boolean }

// 제목 → 노드 인덱스. resolveWikiTarget(lib/wikiLink.ts) 과 같은 규칙(정확 일치 → 대소문자 무시 → 먼저 등장한 것)을 맵 두 개로 O(1) 조회한다 (3.3)
function buildTitleMaps(entries: { title: string }[]) {
  const exact = new Map<string, number>()
  const lower = new Map<string, number>()
  entries.forEach((entry, index) => {
    const title = entry.title.trim()
    if (title === '') return
    if (!exact.has(title)) exact.set(title, index)
    const lowerTitle = title.toLocaleLowerCase('ko')
    if (!lower.has(lowerTitle)) lower.set(lowerTitle, index)
  })
  return { exact, lower }
}

// 이미 뽑아 둔 { id, title, targets } 목록에서 그래프를 만든다 (mapIndex.ts 재사용 통로)
export function buildWikiGraphFromEntries(entries: WikiGraphEntry[]): WikiGraph {
  const nodes: WikiGraph['nodes'] = entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    missing: false,
    degree: 0,
  }))

  const { exact, lower } = buildTitleMaps(entries)

  function resolveIndex(rawTarget: string): number | null {
    const target = rawTarget.trim()
    if (target === '') return null
    const exactHit = exact.get(target)
    if (exactHit !== undefined) return exactHit
    const lowerHit = lower.get(target.toLocaleLowerCase('ko'))
    return lowerHit !== undefined ? lowerHit : null
  }

  const missingIndexByNorm = new Map<string, number>()
  const edgeKeys = new Set<string>()
  const edges: WikiGraph['edges'] = []

  for (let fromIndex = 0; fromIndex < entries.length; fromIndex++) {
    for (const rawTarget of entries[fromIndex].targets) {
      const target = rawTarget.trim()
      if (target === '') continue

      let toIndex = resolveIndex(target)
      if (toIndex === null) {
        const norm = target.toLocaleLowerCase('ko')
        let missingIndex = missingIndexByNorm.get(norm)
        if (missingIndex === undefined) {
          missingIndex = nodes.length
          nodes.push({ id: `missing:${norm}`, title: target, missing: true, degree: 0 })
          missingIndexByNorm.set(norm, missingIndex)
        }
        toIndex = missingIndex
      }

      if (toIndex === fromIndex) continue // 자기 자신 링크는 간선을 만들지 않는다

      const key = `${fromIndex}->${toIndex}`
      if (edgeKeys.has(key)) continue
      edgeKeys.add(key)
      edges.push({ from: fromIndex, to: toIndex })
    }
  }

  for (const edge of edges) {
    nodes[edge.from].degree++
    nodes[edge.to].degree++
  }

  const unreadable = entries.filter((entry) => entry.unreadable).map((entry) => entry.id)

  return { nodes, edges, unreadable }
}

// docs 는 store.list() 결과 그대로 — updatedAt 내림차순 (3.2)
export function buildWikiGraph(docs: { id: string; title: string; content: string; role?: string }[]): WikiGraph {
  const entries: WikiGraphEntry[] = docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    targets: extractWikiTargets(doc.content),
    unreadable: doc.content === '',
  }))
  return buildWikiGraphFromEntries(entries)
}

// 중심에서 몇 다리인가 — 방향을 가리지 않는 너비 우선 탐색. 중심 자신은 0, 닿지 않는 노드는 -1 (specs/features/F-2007.md 4장)
export function distancesFrom(graph: WikiGraph, centerIndex: number): Int32Array {
  const n = graph.nodes.length
  const distances = new Int32Array(n).fill(-1)
  if (!Number.isInteger(centerIndex) || centerIndex < 0 || centerIndex >= n) return distances

  const degree = new Int32Array(n)
  for (const edge of graph.edges) {
    degree[edge.from]++
    degree[edge.to]++
  }
  const start = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + degree[i]
  const cursor = start.slice(0, n)
  const adj = new Int32Array(start[n])
  for (const edge of graph.edges) {
    adj[cursor[edge.from]++] = edge.to
    adj[cursor[edge.to]++] = edge.from
  }

  distances[centerIndex] = 0
  const queue = [centerIndex]
  let head = 0
  while (head < queue.length) {
    const cur = queue[head++]
    const d = distances[cur]
    for (let k = start[cur]; k < start[cur + 1]; k++) {
      const next = adj[k]
      if (distances[next] !== -1) continue
      distances[next] = d + 1
      queue.push(next)
    }
  }
  return distances
}

// 선택한 노드 인덱스만 남긴 그래프 — subgraphAround·truncateGraphByDegree 가 함께 쓴다
function induceSubgraph(graph: WikiGraph, indices: number[]): WikiGraph {
  const oldToNew = new Map<number, number>()
  indices.forEach((oldIndex, newIndex) => oldToNew.set(oldIndex, newIndex))

  const nodes = indices.map((i) => graph.nodes[i])
  const edges: WikiGraph['edges'] = []
  for (const edge of graph.edges) {
    const from = oldToNew.get(edge.from)
    const to = oldToNew.get(edge.to)
    if (from !== undefined && to !== undefined) {
      edges.push({ from, to })
    }
  }

  const includedIds = new Set(nodes.map((n) => n.id))
  const unreadable = graph.unreadable.filter((id) => includedIds.has(id))

  return { nodes, edges, unreadable }
}

// 전체 보기에서 노드 상한을 넘으면 degree 큰 순으로 자른다 — 같은 degree 면 updatedAt 최신순, updatedAtById 에 없는 노드(끊긴 링크)는 항상 뒤로 밀린다 (5.4)
export function truncateGraphByDegree(
  graph: WikiGraph,
  updatedAtById: Map<string, number>,
  cap: number,
): { graph: WikiGraph; truncated: boolean } {
  if (graph.nodes.length <= cap) return { graph, truncated: false }

  const order = graph.nodes.map((node, index) => ({
    index,
    degree: node.degree,
    updatedAt: updatedAtById.get(node.id) ?? -Infinity,
  }))
  order.sort((a, b) => b.degree - a.degree || b.updatedAt - a.updatedAt)
  const selected = order
    .slice(0, cap)
    .map((o) => o.index)
    .sort((a, b) => a - b)

  return { graph: induceSubgraph(graph, selected), truncated: true }
}
