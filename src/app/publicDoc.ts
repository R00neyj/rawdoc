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
