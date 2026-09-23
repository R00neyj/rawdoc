// 공개 문서 조회 — 로그인 없이 /pub/docs/{토큰} (specs/features/F-210.md 2.3, 2.4)
import { flattenFolderTree } from '../lib/folderTree'
import type { LineEnding } from '../types'

export type PublicDoc = { title: string; content: string; lineEnding: LineEnding; updatedAt: number }

export type PublicDocErrorKind = 'not_found' | 'network' | 'other'

export class PublicDocError extends Error {
  kind: PublicDocErrorKind
  constructor(kind: PublicDocErrorKind) {
    super(kind)
    this.kind = kind
  }
}

// 캐시 no-store — 원본이 바뀌면 다음 조회부터 반영한다 (2.3)
export async function fetchPublicDoc(token: string): Promise<PublicDoc> {
  let res: Response
  try {
    res = await fetch(`/pub/docs/${encodeURIComponent(token)}`, { cache: 'no-store' })
  } catch {
    throw new PublicDocError('network')
  }
  if (res.status === 404) throw new PublicDocError('not_found')
  if (!res.ok) throw new PublicDocError('other')
  return (await res.json()) as PublicDoc
}

// 폴더 공개 조회 (F-211.md 2.2) — 링크 폴더 + 모든 자손 폴더의 폴더·문서 목록. folders 에 링크 폴더는 없다 (F-2017 4.2)
export type PublicFolder = {
  name: string
  folders: { id: string; name: string; parentId: string | null }[]
  docs: { id: string; title: string; folderId: string | null; updatedAt: number }[]
}

export async function fetchPublicFolder(token: string): Promise<PublicFolder> {
  let res: Response
  try {
    res = await fetch(`/pub/folders/${encodeURIComponent(token)}`, { cache: 'no-store' })
  } catch {
    throw new PublicDocError('network')
  }
  if (res.status === 404) throw new PublicDocError('not_found')
  if (!res.ok) throw new PublicDocError('other')
  return (await res.json()) as PublicFolder
}

type PublicFolderDocEntry = PublicFolder['docs'][number]

export function sortDocsByUpdatedAtDesc(docs: PublicFolderDocEntry[]): PublicFolderDocEntry[] {
  return [...docs].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function publicRootDocs(folder: PublicFolder): PublicFolderDocEntry[] {
  const folderIds = new Set(folder.folders.map((f) => f.id))
  return sortDocsByUpdatedAtDesc(folder.docs.filter((d) => d.folderId === null || !folderIds.has(d.folderId)))
}

export type PublicFolderGroup = {
  id: string
  name: string
  depth: number // 링크 폴더의 직속 하위가 0
  docs: PublicFolder['docs'] // updatedAt 내림차순
}

// 링크 폴더 자신의 문서 다음에 올 폴더 묶음들(트리 순서). 서브트리에 문서가 하나도 없는 폴더는 뺀다 (F-2017 5.3)
export function publicFolderGroups(folder: PublicFolder): PublicFolderGroup[] {
  const docsByFolder = new Map<string, PublicFolderDocEntry[]>()
  for (const d of folder.docs) {
    if (d.folderId === null) continue
    const group = docsByFolder.get(d.folderId)
    if (group) group.push(d)
    else docsByFolder.set(d.folderId, [d])
  }
  const flat = flattenFolderTree(folder.folders)
  // 앞선 순서의 역순으로 돌며 깊이별로 "아래에 문서가 있나" 를 모은다 — 자식은 늘 부모 뒤에 온다
  const subtreeHasDocs: boolean[] = new Array(flat.length).fill(false)
  const pendingByDepth: boolean[] = []
  for (let i = flat.length - 1; i >= 0; i--) {
    const { id, depth } = flat[i]
    const has = (docsByFolder.get(id)?.length ?? 0) > 0 || Boolean(pendingByDepth[depth + 1])
    pendingByDepth.length = depth + 1
    pendingByDepth[depth] = Boolean(pendingByDepth[depth]) || has
    subtreeHasDocs[i] = has
  }
  return flat
    .filter((_, i) => subtreeHasDocs[i])
    .map((f) => ({ id: f.id, name: f.name, depth: f.depth, docs: sortDocsByUpdatedAtDesc(docsByFolder.get(f.id) ?? []) }))
}

// 렌더 순서(자신의 문서 → 폴더 묶음, 각각 updatedAt 내림차순) 맨 앞 문서 id — 토큰만 열었을 때 첫 문서를 정한다 (F-211.md 2.3)
export function firstFolderDocId(folder: PublicFolder): string | null {
  const rootDocs = publicRootDocs(folder)
  if (rootDocs.length > 0) return rootDocs[0].id
  for (const group of publicFolderGroups(folder)) {
    if (group.docs.length > 0) return group.docs[0].id
  }
  return null
}

// 묶음(시작 문서 + 위키링크로 딸린 문서) 목록 (F-252.md 4.3) — 시작 문서가 맨 앞
export type PublicSetDoc = { id: string; title: string }
export type PublicSet = { docs: PublicSetDoc[] }

export async function fetchPublicSet(token: string): Promise<PublicSet> {
  let res: Response
  try {
    res = await fetch(`/pub/docs/${encodeURIComponent(token)}/set`, { cache: 'no-store' })
  } catch {
    throw new PublicDocError('network')
  }
  if (res.status === 404) throw new PublicDocError('not_found')
  if (!res.ok) throw new PublicDocError('other')
  return (await res.json()) as PublicSet
}

// 묶음 안 시작 문서가 아닌 다른 문서 본문 (F-252.md 4.3) — 묶음 밖이면 404
export async function fetchPublicSetDoc(token: string, docId: string): Promise<PublicDoc> {
  let res: Response
  try {
    res = await fetch(`/pub/docs/${encodeURIComponent(token)}/docs/${encodeURIComponent(docId)}`, { cache: 'no-store' })
  } catch {
    throw new PublicDocError('network')
  }
  if (res.status === 404) throw new PublicDocError('not_found')
  if (!res.ok) throw new PublicDocError('other')
  return (await res.json()) as PublicDoc
}

// 폴더 링크로 그 트리 안 문서 하나를 읽는다 (F-211.md 2.2) — 트리 밖이면 404
export async function fetchPublicFolderDoc(token: string, docId: string): Promise<PublicDoc> {
  let res: Response
  try {
    res = await fetch(`/pub/folders/${encodeURIComponent(token)}/docs/${encodeURIComponent(docId)}`, {
      cache: 'no-store',
    })
  } catch {
    throw new PublicDocError('network')
  }
  if (res.status === 404) throw new PublicDocError('not_found')
  if (!res.ok) throw new PublicDocError('other')
  return (await res.json()) as PublicDoc
}
