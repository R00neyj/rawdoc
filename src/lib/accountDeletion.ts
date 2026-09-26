// 계정 삭제 — 서버·앱이 같이 쓰는 상수·타입 (specs/features/F-2038.md 2장). 순수, import 없음

export const ACCOUNT_DELETE_FRESH_MS = 10 * 60 * 1000
export const ACCOUNT_DELETE_CONFIRM_WORD = '삭제'

// GET /api/account 200 본문
export type AccountDeletePreview = {
  email: string
  docs: number
  e2eeDocs: number
  sharedDocs: number
  folders: number
  attachments: { count: number; bytes: number }
  tokens: number
  fresh: boolean
  freshUntil: number | null
}

export type AccountDeleteError = 'unauthenticated' | 'reauth_required' | 'forbidden_origin' | 'internal'
