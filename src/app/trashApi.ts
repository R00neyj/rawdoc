// 휴지통 API — GET·DELETE /api/trash, POST /api/trash/:id/restore, 사라진 문서 확인 (specs/features/F-2145.md 4장)
import type { TrashItem } from '../lib/trash'
import type { NoticeWithAction } from './NoticeBar'
import { GONE_DOC_TEXT } from './trashView'

export type TrashErrorKind = 'network' | 'unauthorized' | 'server_error' | 'other'

export class TrashApiError extends Error {
  kind: TrashErrorKind
  constructor(kind: TrashErrorKind) {
    super(kind)
    this.kind = kind
  }
}

export type GoneDocKind = 'trashed' | 'deleted' | 'not_found'

async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', ...init })
  } catch {
    throw new TrashApiError('network')
  }
}

// 네트워크 오류도 상태 코드 0 처럼 다뤄 호출부가 갈래 하나로 받는다
async function sendStatus(path: string, init: RequestInit): Promise<Response | null> {
  try {
    return await send(path, init)
  } catch {
    return null
  }
}

export async function listTrash(): Promise<TrashItem[]> {
  const res = await send('/api/trash')
  if (res.status === 401) throw new TrashApiError('unauthorized')
  if (res.status >= 500) throw new TrashApiError('server_error')
  if (!res.ok) throw new TrashApiError('other')
  return (await res.json()) as TrashItem[]
}

export type RestoreResult = { status: 'ok'; folderId: string | null } | { status: 'gone' } | { status: 'failed' }

export async function restoreTrashDoc(id: string): Promise<RestoreResult> {
  const res = await sendStatus(`/api/trash/${encodeURIComponent(id)}/restore`, { method: 'POST' })
  if (res?.status === 404) return { status: 'gone' }
  if (!res?.ok) return { status: 'failed' }
  try {
    const body = (await res.json()) as { folderId?: string | null }
    return { status: 'ok', folderId: body.folderId ?? null }
  } catch {
    return { status: 'failed' }
  }
}

export async function purgeTrashDoc(id: string): Promise<'ok' | 'gone' | 'failed'> {
  const res = await sendStatus(`/api/trash/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (res?.status === 404) return 'gone'
  return res?.ok ? 'ok' : 'failed'
}

export type EmptyResult = { status: 'ok'; docs: number } | { status: 'failed' }

export async function emptyTrash(): Promise<EmptyResult> {
  const res = await sendStatus('/api/trash', { method: 'DELETE' })
  if (!res?.ok) return { status: 'failed' }
  try {
    const body = (await res.json()) as { docs?: number }
    return { status: 'ok', docs: typeof body.docs === 'number' ? body.docs : 0 }
  } catch {
    return { status: 'failed' }
  }
}

// S-10 이 읽고 쓰는 휴지통 — 서버는 이 API, 로컬은 localTrash.ts 가 같은 모양을 준다
export type TrashSource = {
  list: () => Promise<TrashItem[]>
  restore: (id: string) => Promise<RestoreResult>
  purge: (id: string) => Promise<'ok' | 'gone' | 'failed'>
  empty: () => Promise<EmptyResult>
}

export const SERVER_TRASH: TrashSource = { list: listTrash, restore: restoreTrashDoc, purge: purgeTrashDoc, empty: emptyTrash }

// 없는 문서 해시가 내 휴지통 문서인지·지워진 문서인지 가른다 — 그 밖 전부는 not_found (F-2145 4장 ②)
export async function probeGoneDoc(id: string): Promise<GoneDocKind> {
  try {
    const res = await send(`/api/docs/${encodeURIComponent(id)}`)
    if (res.status !== 404) return 'not_found'
    const body = (await res.json()) as { error?: string } | null
    if (body?.error !== 'deleted') return 'not_found'
    const items = await listTrash()
    return items.some((item) => item.id === id) ? 'trashed' : 'deleted'
  } catch {
    return 'not_found'
  }
}

const NOT_FOUND_NOTICE: NoticeWithAction = { type: 'info', message: '문서를 찾을 수 없습니다.' }

// 목록에 없는 문서 해시의 알림 — 서버 저장소·온라인이면 응답을 본 뒤에 문구를 고른다 (F-2145 4장 ②)
export function announceMissingDoc(docId: string | null, isServer: boolean, showNotice: (notice: NoticeWithAction) => unknown): void {
  if (!docId || !isServer || !navigator.onLine) {
    showNotice(NOT_FOUND_NOTICE)
    return
  }
  void probeGoneDoc(docId).then((kind) => {
    if (kind === 'trashed') {
      showNotice({ type: 'info', message: GONE_DOC_TEXT.trashed, action: { label: '휴지통 열기', onClick: () => { location.hash = '#/trash' } } })
    } else {
      showNotice(kind === 'deleted' ? { type: 'info', message: GONE_DOC_TEXT.deleted } : NOT_FOUND_NOTICE)
    }
  })
}
