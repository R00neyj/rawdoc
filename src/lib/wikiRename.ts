// 제목을 바꿀 때 옛 제목 위키링크 찾기·고치기·되돌리기. 순수 함수 (small 2026-10-24, wireframes/wikilink-rename-flow.html)
import { scanWikiLinks } from './wikiGraph'
import { createWikiResolver, type WikiDocRef, type WikiFolderRef, type WikiResolver } from './wikiResolve'

export type LinkEdit = { from: number; to: number; insert: string }
// text: 고친 뒤 원문 기준 자리의 새 글자, prev: 되돌릴 옛 글자
export type AppliedEdit = { from: number; to: number; text: string; prev: string }
export type RenameContext = { docId: string; oldTitle: string; newTitle: string; before: WikiResolver; after: WikiResolver }
export type RenameSource = { id: string; title: string; folderId: string | null; content: string; e2ee?: boolean }
export type RenamePlanDoc = { id: string; title: string; edits: LinkEdit[] }
export type RenamePlan = { docs: RenamePlanDoc[]; links: number; vaultSkipped: number }

const UNTITLED = '제목 없는 문서'
const UNLINKABLE_RE = /[[\]|#\r\n]/
const fold = (s: string) => s.toLowerCase()

// 바꾸기 전·뒤 해석기 한 쌍. 물을 필요가 없으면 null (빈 제목·제목 없는 문서·공백만 바뀜·링크로 못 적는 제목)
export function renameContext(
  docs: readonly WikiDocRef[],
  folders: readonly WikiFolderRef[],
  docId: string,
  oldTitle: string,
  newTitle: string,
): RenameContext | null {
  const oldT = oldTitle.trim()
  const newT = newTitle.trim()
  if (oldT === '' || newT === '' || newT === UNTITLED || oldT === newT || UNLINKABLE_RE.test(newT)) return null
  const withTitle = (title: string) => docs.map((d) => (d.id === docId ? { ...d, title } : d))
  return {
    docId,
    oldTitle: oldT,
    newTitle: newT,
    before: createWikiResolver(withTitle(oldT), folders),
    after: createWikiResolver(withTitle(newT), folders),
  }
}

// 링크 대상 글자 안에서 옛 제목에 해당하는 [시작, 끝) — 제목 전체, 아니면 경로의 마지막 조각. .md 꼬리는 남긴다
function titleSpan(raw: string, oldTitle: string): [number, number] | null {
  const hash = raw.indexOf('#')
  const sem = hash === -1 ? raw : raw.slice(0, hash)
  const starts = [0]
  const slash = sem.lastIndexOf('/')
  if (slash !== -1) starts.push(slash + 1)
  const want = fold(oldTitle)
  for (const start of starts) {
    const piece = sem.slice(start)
    const from = start + (piece.length - piece.trimStart().length)
    const text = piece.trim()
    if (fold(text) === want) return [from, from + text.length]
    if (fold(text).endsWith('.md')) {
      const base = text.slice(0, -3).trimEnd()
      if (fold(base) === want) return [from, from + base.length]
    }
  }
  return null
}

// 바꾸기 전에는 이 문서로 풀리고 바꾼 뒤에는 아닌 링크만 — 원문 위치 기준 고칠 자리
export function findRenameEdits(content: string, sourceFolderId: string | null, ctx: RenameContext): LinkEdit[] {
  const edits: LinkEdit[] = []
  for (const link of scanWikiLinks(content)) {
    if (link.target === '') continue
    if (ctx.before.resolve(link.target, sourceFolderId)?.id !== ctx.docId) continue
    if (ctx.after.resolve(link.target, sourceFolderId)?.id === ctx.docId) continue
    const span = titleSpan(content.slice(link.targetFrom, link.targetTo), ctx.oldTitle)
    if (span) edits.push({ from: link.targetFrom + span[0], to: link.targetFrom + span[1], insert: ctx.newTitle })
  }
  return edits
}

// 금고 문서는 고치지 않고 링크가 있던 문서 수만 센다
export function planRenameEdits(sources: readonly RenameSource[], ctx: RenameContext): RenamePlan {
  const docs: RenamePlanDoc[] = []
  let links = 0
  let vaultSkipped = 0
  for (const s of sources) {
    const edits = findRenameEdits(s.content, s.folderId, ctx)
    if (edits.length === 0) continue
    if (s.e2ee) {
      vaultSkipped++
      continue
    }
    docs.push({ id: s.id, title: s.title, edits })
    links += edits.length
  }
  return { docs, links, vaultSkipped }
}

export function titleTakenByOther(docs: readonly WikiDocRef[], docId: string, newTitle: string): boolean {
  const want = fold(newTitle.trim())
  return docs.some((d) => d.id !== docId && fold(d.title.trim()) === want)
}

// 겹치지 않는 고칠 자리를 뒤에서부터 적용한다
export function applyLinkEdits(content: string, edits: readonly LinkEdit[]): string {
  let out = content
  for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.insert + out.slice(e.to)
  return out
}

// 고친 뒤 원문 기준 자리로 옮겨 적는다 — 되돌리기가 쓴다
export function recordAppliedEdits(before: string, edits: readonly LinkEdit[]): AppliedEdit[] {
  let delta = 0
  return [...edits]
    .sort((a, b) => a.from - b.from)
    .map((e) => {
      const from = e.from + delta
      delta += e.insert.length - (e.to - e.from)
      return { from, to: from + e.insert.length, text: e.insert, prev: before.slice(e.from, e.to) }
    })
}

// 그 사이 바뀐 곳을 한 덩어리(공통 앞·뒤 밖)로 보고, 그 밖의 고친 자리만 옛 글자로 되돌린다
export function revertAppliedEdits(current: string, after: string, applied: readonly AppliedEdit[]): { edits: LinkEdit[]; missed: number } {
  const max = Math.min(current.length, after.length)
  let head = 0
  while (head < max && current[head] === after[head]) head++
  let tail = 0
  while (tail < max - head && current[current.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  const delta = current.length - after.length
  const edits: LinkEdit[] = []
  let missed = 0
  for (const a of applied) {
    const shift = a.to <= head ? 0 : a.from >= after.length - tail ? delta : null
    if (shift === null || current.slice(a.from + shift, a.to + shift) !== a.text) {
      missed++
      continue
    }
    edits.push({ from: a.from + shift, to: a.to + shift, insert: a.prev })
  }
  return { edits, missed }
}
