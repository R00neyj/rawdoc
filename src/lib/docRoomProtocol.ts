// 서버(DocRoom)·클라이언트가 같이 쓰는 소켓 계약 (specs/features/F-304.md 11.1). 이름은 저장소 식별자라 제품명과 무관하게 고정
export const Y_CONTENT_NAME = 'content'
export const Y_TITLE_NAME = 'title'
export const DOC_SOCKET_PREFIX = '/ws/doc/'
export const SOCKET_PING = 'ping'
export const SOCKET_PONG = 'pong'

export const SOCKET_CLOSE = {
  unauthenticated: 4401,
  forbidden: 4403,
  notFound: 4404,
  unavailable: 1013,
} as const

export type SocketCloseReason = 'unauthenticated' | 'forbidden' | 'revoked' | 'not_found' | 'deleted' | 'unavailable'

export type DocRoomMessage = { type: 'too-large'; limit: number; bytes: number } | { type: 'size-ok' }

export function encodeDocRoomMessage(message: DocRoomMessage): string {
  return JSON.stringify(message)
}

export function parseDocRoomMessage(text: string): DocRoomMessage | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (record.type === 'size-ok') return { type: 'size-ok' }
  if (record.type === 'too-large' && typeof record.limit === 'number' && typeof record.bytes === 'number') {
    return { type: 'too-large', limit: record.limit, bytes: record.bytes }
  }
  return null
}
