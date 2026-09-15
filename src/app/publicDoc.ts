// 공개 문서 조회 — 로그인 없이 /pub/docs/{토큰} (specs/features/F-210.md 2.3, 2.4)
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

// 폴더 공개 조회 (F-211.md 2.2) — 링크 폴더 + 하위 폴더(2단계까지)의 폴더·문서 목록
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

// 렌더 순서(자신의 문서 → 하위 폴더 묶음, 각각 updatedAt 내림차순) 맨 앞 문서 id — 토큰만 열었을 때 첫 문서를 정한다 (F-211.md 2.3)
export function firstFolderDocId(folder: PublicFolder): string | null {
  const rootDocs = sortDocsByUpdatedAtDesc(folder.docs.filter((d) => !folder.folders.some((f) => f.id === d.folderId)))
  if (rootDocs.length > 0) return rootDocs[0].id
  for (const sub of folder.folders) {
    const subDocs = sortDocsByUpdatedAtDesc(folder.docs.filter((d) => d.folderId === sub.id))
    if (subDocs.length > 0) return subDocs[0].id
  }
  return null
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
