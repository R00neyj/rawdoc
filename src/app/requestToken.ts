// 공유 링크 조각에 담을 요청 토큰 — 소유자 서버 문서만 발급받는다 (specs/features/F-2137.md 2장)
import type { DocMeta } from './docMeta'
import { isSharedDoc } from './docMeta'

const TIMEOUT_MS = 3000
const cache = new Map<string, string>()

export function requestTokenDocId({ serverStore, doc }: { serverStore: boolean; doc: Pick<DocMeta, 'id' | 'role' | 'e2ee'> | null }): string | null {
  if (!serverStore || !doc || isSharedDoc(doc) || doc.e2ee !== undefined) return null
  return doc.id
}

export async function fetchRequestToken(docId: string): Promise<string | null> {
  const cached = cache.get(docId)
  if (cached) return cached
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`/api/docs/${encodeURIComponent(docId)}/request-token`, {
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
    })
    if (res.status !== 200 && res.status !== 201) return null
    const body: unknown = await res.json()
    const token = typeof body === 'object' && body !== null && 'token' in body ? body.token : undefined
    if (typeof token !== 'string' || token === '') return null
    cache.set(docId, token)
    return token
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function resetRequestTokenCache(): void {
  cache.clear()
}
