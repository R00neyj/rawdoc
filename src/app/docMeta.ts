// 사이드바 목록 메타 타입과 정리 함수 (F-2059 2.3, F-2060)
import type { Doc, LineEnding } from '../types'

// lineEnding 은 실시간 경로가 편집기를 열 때 읽는다 — 본문을 store.get 으로 읽지 않기 때문이다 (F-305 5.2)
export type DocMeta = Pick<Doc, 'id' | 'title' | 'updatedAt' | 'folderId' | 'pinnedAt' | 'role' | 'ownerEmail' | 'viaFolder' | 'e2ee'> & {
  lineEnding?: LineEnding
}
export type OpenDoc = { id: string; content: string; lineEnding: LineEnding }

// 목록에 보일 제목 — 공백 제목 되돌림은 포커스를 잃을 때 도니까(F-111 3.4) 그 사이 행이 통째로 비어 보였다
export function displayDocTitle(title: string): string {
  return title.trim() === '' ? '제목 없는 문서' : title
}

export function stripContent(doc: Omit<Doc, 'content'>): DocMeta {
  return {
    id: doc.id,
    title: doc.title,
    updatedAt: doc.updatedAt,
    folderId: doc.folderId ?? null,
    pinnedAt: doc.pinnedAt ?? null, // F-132
    role: doc.role, // F-212
    ownerEmail: doc.ownerEmail,
    viaFolder: doc.viaFolder ?? null,
    lineEnding: doc.lineEnding,
    ...(doc.e2ee ? { e2ee: doc.e2ee } : {}), // F-405 7.3
  }
}

// 공유받은 문서인가 — 'edit'|'view' 는 내 소유가 아니다 (F-212.md 2.4)
export function isSharedDoc(doc: Pick<DocMeta, 'role'> | null | undefined): boolean {
  return doc?.role === 'edit' || doc?.role === 'view'
}

export function sortByUpdatedAtDesc<T extends { updatedAt: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
}
