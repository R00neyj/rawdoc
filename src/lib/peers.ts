// 접속자 순수 함수 — 상태 읽기·목록·보일 목록·색·머리글자·라벨 (specs/features/F-307.md 3장·7장)
import { readPeerCursor } from './docRoomProtocol'
import type { PeerState } from './docRoomProtocol'

export type Peer = { userId: string; email: string; color: number }

export const PEOPLE_COLORS = 7
export const PEER_AVATARS_MAX = 4
export const PEER_AVATARS_MAX_NARROW = 1
export const PEER_LABEL_MAX_CHARS = 24

// 서버가 도장 찍은 상태만 받는다 — user 가 없으면 아직 서버를 안 거친 상태다
export function readPeerState(raw: unknown): PeerState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const user = (raw as { user?: unknown }).user
  if (typeof user !== 'object' || user === null) return null
  const { id, email } = user as { id?: unknown; email?: unknown }
  if (typeof id !== 'string' || typeof email !== 'string') return null
  return { user: { id, email }, cursor: readPeerCursor((raw as { cursor?: unknown }).cursor) }
}

// FNV-1a 32비트 % 7 + 1 — 이 규칙이 계약이다. 바꾸면 모든 사람의 색이 바뀐다 (3.3)
export function peerColorIndex(userId: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash % PEOPLE_COLORS) + 1
}

function samePeers(a: readonly Peer[], b: readonly Peer[]): boolean {
  return a.length === b.length && a.every((p, i) => p.userId === b[i].userId && p.email === b[i].email)
}

// 한 사람 = 한 항목, 처음 보인 순서. 값이 같으면 prev 를 그대로 돌려준다 (7.1)
export function nextPeerList(prev: readonly Peer[], states: ReadonlyMap<number, unknown>, ownClientId: number): Peer[] {
  const present = new Map<string, string>()
  states.forEach((raw, clientId) => {
    if (clientId === ownClientId) return
    const state = readPeerState(raw)
    if (state && !present.has(state.user.id)) present.set(state.user.id, state.user.email)
  })
  const next: Peer[] = []
  for (const peer of prev) {
    const email = present.get(peer.userId)
    if (email === undefined) continue
    next.push(email === peer.email ? peer : { ...peer, email })
    present.delete(peer.userId)
  }
  present.forEach((email, userId) => next.push({ userId, email, color: peerColorIndex(userId) }))
  return samePeers(prev, next) ? (prev as Peer[]) : next
}

export function visiblePeers(
  peers: readonly Peer[],
  selfUserId: string | null,
  max: number,
): { shown: Peer[]; hidden: Peer[] } {
  const others = peers.filter((p) => p.userId !== selfUserId)
  return { shown: others.slice(0, max), hidden: others.slice(max) }
}

function localPart(email: string): string {
  const at = email.lastIndexOf('@')
  return at < 0 ? email : email.slice(0, at)
}

export function peerInitial(email: string): string {
  return (Array.from(localPart(email))[0] ?? '').toUpperCase()
}

export function peerLabel(email: string): string {
  const chars = Array.from(localPart(email))
  return chars.length > PEER_LABEL_MAX_CHARS ? `${chars.slice(0, PEER_LABEL_MAX_CHARS).join('')}…` : chars.join('')
}
