// 팔레트 문서 목록·거르기·새 문서 만들기 계획 — 순수 함수 (specs/features/F-2053.md 4·6장)
import { prepareMatchText, splitMatchTerms, matchTerm, type MatchText } from '../lib/hangulMatch'
import { E2EE_MAX_PLAIN_TITLE_CHARS } from '../lib/e2eeLimits'
import type { PaletteDoc, PaletteCreatePlan } from './paletteContract'
import type { WikiResolver } from '../lib/wikiResolve'

export const PALETTE_DOC_LIMIT = 6
export const PALETTE_RECENT_DOC_LIMIT = 5

export type PaletteDocSource = {
  id: string
  title: string
  folderId: string | null
  updatedAt: number
  role?: 'owner' | 'edit' | 'view'
  e2ee?: 'locked' | 'open'
}

function isShared(d: Pick<PaletteDocSource, 'role'>): boolean {
  return d.role === 'edit' || d.role === 'view'
}

function toDoc(d: PaletteDocSource, folderPaths: Map<string, string>): PaletteDoc {
  const title = d.title.trim()
  return {
    id: d.id,
    title: title === '' ? '제목 없는 문서' : title,
    folderPath: d.folderId ? (folderPaths.get(d.folderId) ?? '') : '',
    shared: isShared(d),
  }
}

// (4.2) folderPaths 는 App 이 한 번 계산해 넘긴다(9장 — App 의 palettePathMap 과 같은 걸 여기서 다시 만들지 않는다)
export function toPaletteDocs(input: {
  docs: readonly PaletteDocSource[]
  folderPaths: Map<string, string>
  currentDocId: string | null
}): { all: PaletteDoc[]; recent: PaletteDoc[] } {
  const { folderPaths } = input
  const nonLocked = input.docs.filter((d) => d.e2ee !== 'locked')
  const all = nonLocked.map((d) => toDoc(d, folderPaths))
  const recent = nonLocked
    .filter((d) => !isShared(d) && d.id !== input.currentDocId)
    .slice(0, PALETTE_RECENT_DOC_LIMIT)
    .map((d) => toDoc(d, folderPaths))
  return { all, recent }
}

type PreparedDoc = { doc: PaletteDoc; titleText: MatchText; folderText: MatchText }

// paletteContract.ts 의 PaletteDocIndex 는 이 모양의 불투명 타입이다 (3.1)
export type PaletteDocIndex = { prepared: PreparedDoc[] }

// (4.2, 3.2 — 준비는 팔레트가 열릴 때 한 번)
export function prepareDocIndex(all: readonly PaletteDoc[]): PaletteDocIndex {
  return {
    prepared: all.map((doc) => ({
      doc,
      titleText: prepareMatchText(doc.title),
      folderText: prepareMatchText(doc.folderPath),
    })),
  }
}

// (4.4)
export function filterPaletteDocs(index: PaletteDocIndex, text: string, limit: number): PaletteDoc[] {
  const terms = splitMatchTerms(text, { slash: true })
  if (terms.length === 0) return []

  type Scored = { doc: PaletteDoc; stage: 1 | 2 | 3; loose: boolean }
  const scored: Scored[] = []

  for (const { doc, titleText, folderText } of index.prepared) {
    let matchedAll = true
    let usedLoose = false
    let onlyFolderMatched = false
    for (const term of terms) {
      const titleHit = matchTerm(term, titleText)
      if (titleHit) {
        if (titleHit.loose) usedLoose = true
        continue
      }
      const folderHit = matchTerm(term, folderText)
      if (folderHit) {
        if (folderHit.loose) usedLoose = true
        onlyFolderMatched = true
        continue
      }
      matchedAll = false
      break
    }
    if (!matchedAll) continue

    const firstHitTitle = matchTerm(terms[0], titleText)
    const stage: 1 | 2 | 3 = firstHitTitle?.start
      ? 1
      : !onlyFolderMatched && terms.every((t) => matchTerm(t, titleText) !== null)
        ? 2
        : 3
    scored.push({ doc, stage, loose: usedLoose })
  }

  scored.sort((a, b) => a.stage - b.stage || Number(a.loose) - Number(b.loose))
  return scored.slice(0, limit).map((s) => s.doc)
}

// (6.1)
export function planPaletteCreate(
  text: string,
  env: {
    resolver: WikiResolver
    sourceFolderId: string | null
    fallbackFolderId: string | null
    folderPathOf: (folderId: string | null) => string
  },
): PaletteCreatePlan | null {
  const t = text.trim()
  if (t === '') return null
  if (/^[ㄱ-ㅣ\s]+$/.test(t)) return null // 한글 자모와 공백으로만 (2)
  if (env.resolver.resolve(t, env.sourceFolderId)) return null // 이미 있는 문서 (3)

  const place = env.resolver.findLinkFolder(t, env.sourceFolderId)
  const title = place ? place.title : t
  const folderId = place ? place.folderId : env.fallbackFolderId

  if (title.length > E2EE_MAX_PLAIN_TITLE_CHARS) return null // (5)

  return { title, folderId, folderPath: env.folderPathOf(folderId) }
}
