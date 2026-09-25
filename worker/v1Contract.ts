// '/v1' 응답 모양의 타입과 예시 값. 서버 핸들러는 이 파일을 import 하지 않는다(동작을 바꾸지 않는다). 서버·CLI 양쪽 테스트가 이 파일에 대 본다 (specs/features/F-2021.md 7.2)
export type V1DocSummary = {
  id: string
  title: string
  lineEnding: 'crlf' | 'lf'
  folderId: string | null
  pinnedAt: number | null
  version: number
  createdAt: number
  updatedAt: number
  e2ee?: true // 금고 문서일 때만 — 그때 title 은 '' (F-401 X18)
}
export type V1Doc = V1DocSummary & { content: string }
export type V1Folder = { id: string; name: string; parentId: string | null; createdAt: number; updatedAt: number; e2ee?: true }
export type V1Attachment = {
  id: string
  ext: 'png' | 'jpg' | 'gif' | 'webp'
  mime: string
  size: number
  width: number
  height: number
  markdown: string
}
export type V1Link = { token: string; url: string }
export type V1Me = { id: string; email: string; blocked: boolean; warned: boolean } // blocked·warned 는 F-2028 7장
export type V1Error = {
  error: string
  field?: string
  limit?: number
  used?: number
  email?: string
  expiresAt?: number
  doc?: V1Doc
  resource?: 'bytes' | 'docs' // F-2025 (413 doc_quota_exceeded)
  scope?: 'minute' | 'day' // F-2026 (429)
  retryAfter?: number // F-2026 (429)
}

export const V1_EXAMPLES: {
  docSummary: V1DocSummary
  doc: V1Doc
  folder: V1Folder
  attachment: V1Attachment
  link: V1Link
  me: V1Me
} = {
  docSummary: {
    id: 'doc-1',
    title: '예시 문서',
    lineEnding: 'lf',
    folderId: null,
    pinnedAt: null,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
  },
  doc: {
    id: 'doc-1',
    title: '예시 문서',
    content: '# 예시',
    lineEnding: 'lf',
    folderId: null,
    pinnedAt: null,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
  },
  folder: { id: 'folder-1', name: '예시 폴더', parentId: null, createdAt: 0, updatedAt: 0 },
  attachment: {
    id: '0123456789abcdef',
    ext: 'png',
    mime: 'image/png',
    size: 100,
    width: 2,
    height: 2,
    markdown: '![이미지](/api/attachments/0123456789abcdef.png)',
  },
  link: { token: 'abc123', url: 'https://rawdoc.app/#/p/abc123' },
  me: { id: 'user-1', email: 'a@b.com', blocked: false, warned: false },
}
