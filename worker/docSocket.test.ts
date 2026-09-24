// /ws/doc/:id 업그레이드 판정 (specs/features/F-304.md 4장, A21·A22)
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./auth', () => ({
  getUser: vi.fn(),
}))

import { getUser } from './auth'
import { DOC_ROOM_HEADERS, readForwardedIdentity, resolveDocSocket } from './docSocket'
import { SITE_URL } from '../src/lib/siteMeta'

const DOC_ID = '22222222-2222-4222-8222-222222222222'
const SITE_ORIGIN = new URL(SITE_URL).origin

type Grant = { target_type: 'doc' | 'folder'; target_id: string; grantee_email: string; role: 'view' | 'edit' }

function makeEnv(
  opts: {
    doc?: { owner_id: string; version: number } | null
    grants?: Grant[]
    users?: { id: string; blocked_at: number | null }[]
    dev?: boolean
    local?: boolean
  } = {},
) {
  const sqls: string[] = []
  const doc = opts.doc === undefined ? { owner_id: 'owner', version: 7 } : opts.doc
  const grants = opts.grants ?? []
  const users = opts.users ?? []
  const DB = {
    prepare(sql: string) {
      sqls.push(sql)
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('FROM docs WHERE id = ?')) {
                if (!doc || args[0] !== DOC_ID) return null
                return { id: DOC_ID, owner_id: doc.owner_id, folder_id: null, version: doc.version } as T
              }
              if (sql.startsWith('SELECT role FROM grants')) {
                const [type, id, email] = args
                const g = grants.find((x) => x.target_type === type && x.target_id === id && x.grantee_email === email)
                return (g ? { role: g.role } : null) as T | null
              }
              if (sql.startsWith('SELECT write_day')) {
                const u = users.find((x) => x.id === args[0])
                if (!u) return null
                return { write_day: null, write_count: 0, content_bytes: 0, doc_count: 0, blocked_at: u.blocked_at, warned_at: null } as T
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
          }
        },
      }
    },
  }
  const env = {
    DB,
    BETTER_AUTH_URL: opts.dev || opts.local ? 'http://localhost:8790' : 'https://rawdoc.app',
    ...(opts.dev ? { DEV_AUTH_EMAIL: 'dev@example.com' } : {}),
  } as unknown as Env
  return { env, sqls }
}

function upgrade(headers: Record<string, string> = {}, method = 'GET') {
  return new Request(`${SITE_ORIGIN}/ws/doc/${DOC_ID}`, {
    method,
    headers: { Upgrade: 'websocket', Origin: SITE_ORIGIN, ...headers },
  })
}

async function statusOf(request: Request, env: Env, docId = DOC_ID) {
  const decision = await resolveDocSocket(request, env, docId)
  if (decision.type !== 'reject') return decision.type
  return decision.response.status
}

beforeEach(() => {
  vi.mocked(getUser).mockReset()
  vi.mocked(getUser).mockResolvedValue({ id: 'owner', email: 'owner@example.com' })
})

describe('F-304 A21 HTTP 거절', () => {
  it('업그레이드가 아니면 426', async () => {
    const { env } = makeEnv()
    const plain = new Request(`${SITE_ORIGIN}/ws/doc/${DOC_ID}`, { headers: { Origin: SITE_ORIGIN } })
    const decision = await resolveDocSocket(plain, env, DOC_ID)
    expect(decision.type).toBe('reject')
    if (decision.type === 'reject') {
      expect(decision.response.status).toBe(426)
      expect(await decision.response.json()).toEqual({ error: 'upgrade_required' })
    }
    expect(await statusOf(upgrade({}, 'POST'), env)).toBe(426)
  })

  it('Upgrade 는 대소문자를 가리지 않는다', async () => {
    const { env } = makeEnv()
    expect(await statusOf(upgrade({ Upgrade: 'WebSocket' }), env)).toBe('forward')
  })

  it('Origin 없음·다른 출처 → 403 forbidden_origin', async () => {
    const { env } = makeEnv()
    const noOrigin = new Request(`${SITE_ORIGIN}/ws/doc/${DOC_ID}`, { headers: { Upgrade: 'websocket' } })
    const decision = await resolveDocSocket(noOrigin, env, DOC_ID)
    expect(decision.type).toBe('reject')
    if (decision.type === 'reject') {
      expect(decision.response.status).toBe(403)
      expect(await decision.response.json()).toEqual({ error: 'forbidden_origin' })
    }
    expect(await statusOf(upgrade({ Origin: 'https://evil.example' }), env)).toBe(403)
  })

  it('SITE_URL 출처는 통과', async () => {
    const { env } = makeEnv()
    expect(await statusOf(upgrade(), env)).toBe('forward')
  })

  it('http://localhost:8791 은 로컬 인증 모드일 때만 통과', async () => {
    const local = { Origin: 'http://localhost:8791' }
    expect(await statusOf(upgrade(local), makeEnv().env)).toBe(403)
    expect(await statusOf(upgrade(local), makeEnv({ dev: true }).env)).toBe('forward')
    expect(await statusOf(upgrade({ Origin: 'http://127.0.0.1:5000' }), makeEnv({ dev: true }).env)).toBe('forward')
    expect(await statusOf(upgrade({ Origin: 'https://localhost:8791' }), makeEnv({ dev: true }).env)).toBe(403)
    expect(await statusOf(upgrade({ Origin: 'http://evil.example' }), makeEnv({ dev: true }).env)).toBe(403)
  })

  it('로컬 인증 모드면 wrangler dev 가 바꿔 쓴 요청 출처(http://{routes 호스트})도 통과', async () => {
    const rewritten = () =>
      new Request(`http://rawdoc.app/ws/doc/${DOC_ID}`, { headers: { Upgrade: 'websocket', Origin: 'http://rawdoc.app' } })
    expect(await statusOf(rewritten(), makeEnv({ dev: true }).env)).toBe('forward')
    expect(await statusOf(rewritten(), makeEnv().env)).toBe(403)
  })

  it('F-2033 U22 로컬 인증 모드면 DEV_AUTH_EMAIL 없이도 localhost 출처를 받는다', async () => {
    expect(await statusOf(upgrade({ Origin: 'http://localhost:8790' }), makeEnv({ local: true }).env)).toBe('forward')
  })

  it('UUID 가 아닌 id → HTTP 404', async () => {
    const { env } = makeEnv()
    expect(await statusOf(upgrade(), env, 'not-a-uuid')).toBe(404)
  })
})

describe('F-304 A22 닫기 코드와 넘기기', () => {
  it('사용자 없음 → 4401 unauthenticated', async () => {
    vi.mocked(getUser).mockResolvedValue(null)
    const decision = await resolveDocSocket(upgrade(), makeEnv().env, DOC_ID)
    expect(decision).toEqual({ type: 'close', code: 4401, reason: 'unauthenticated' })
  })

  it('문서 없음·권한 없음 → 4404 not_found', async () => {
    expect(await resolveDocSocket(upgrade(), makeEnv({ doc: null }).env, DOC_ID)).toEqual({
      type: 'close',
      code: 4404,
      reason: 'not_found',
    })
    vi.mocked(getUser).mockResolvedValue({ id: 'stranger', email: 'stranger@example.com' })
    expect(await resolveDocSocket(upgrade(), makeEnv().env, DOC_ID)).toEqual({
      type: 'close',
      code: 4404,
      reason: 'not_found',
    })
  })

  it('보기 → 4403 forbidden', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'v', email: 'viewer@example.com' })
    const { env } = makeEnv({ grants: [{ target_type: 'doc', target_id: DOC_ID, grantee_email: 'viewer@example.com', role: 'view' }] })
    expect(await resolveDocSocket(upgrade(), env, DOC_ID)).toEqual({ type: 'close', code: 4403, reason: 'forbidden' })
  })

  it('편집·소유 → 넘기기에 네 헤더, 클라이언트가 보낸 같은 이름 헤더는 우리 값으로 바뀐다', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'e', email: 'editor@example.com' })
    const { env, sqls } = makeEnv({ grants: [{ target_type: 'doc', target_id: DOC_ID, grantee_email: 'editor@example.com', role: 'edit' }] })
    const forged = upgrade({
      [DOC_ROOM_HEADERS.userId]: 'owner',
      [DOC_ROOM_HEADERS.role]: 'owner',
      'X-WS-Extra': 'forged',
    })
    const decision = await resolveDocSocket(forged, env, DOC_ID)
    expect(decision.type).toBe('forward')
    if (decision.type !== 'forward') return
    const h = decision.request.headers
    expect(h.get(DOC_ROOM_HEADERS.userId)).toBe('e')
    expect(h.get(DOC_ROOM_HEADERS.email)).toBe('editor@example.com')
    expect(h.get(DOC_ROOM_HEADERS.role)).toBe('edit')
    expect(h.get(DOC_ROOM_HEADERS.docVersion)).toBe('7')
    expect(h.get('X-WS-Extra')).toBeNull()
    expect(h.get('Upgrade')).toBe('websocket')
    expect(readForwardedIdentity(h)).toEqual({ userId: 'e', email: 'editor@example.com', role: 'edit', docVersion: 7 })

    const docSql = sqls.find((s) => s.includes('FROM docs WHERE id = ?'))!
    const columns = docSql.slice('SELECT '.length, docSql.indexOf(' FROM'))
    expect(columns).not.toContain('content')
    expect(columns).not.toContain('*')
  })

  it('소유자 → role owner', async () => {
    const decision = await resolveDocSocket(upgrade(), makeEnv().env, DOC_ID)
    expect(decision.type).toBe('forward')
    if (decision.type === 'forward') expect(decision.request.headers.get(DOC_ROOM_HEADERS.role)).toBe('owner')
  })

  it('헤더가 빠졌거나 모양이 다르면 readForwardedIdentity 는 null', () => {
    expect(readForwardedIdentity(new Headers())).toBeNull()
    expect(
      readForwardedIdentity(
        new Headers({
          [DOC_ROOM_HEADERS.userId]: 'u',
          [DOC_ROOM_HEADERS.email]: 'u@example.com',
          [DOC_ROOM_HEADERS.role]: 'view',
          [DOC_ROOM_HEADERS.docVersion]: '1',
        }),
      ),
    ).toBeNull()
    expect(
      readForwardedIdentity(
        new Headers({
          [DOC_ROOM_HEADERS.userId]: 'u',
          [DOC_ROOM_HEADERS.email]: 'u@example.com',
          [DOC_ROOM_HEADERS.role]: 'edit',
          [DOC_ROOM_HEADERS.docVersion]: 'x',
        }),
      ),
    ).toBeNull()
  })
})

describe('F-2028 DS1~DS3 막힌 계정·막힌 소유자', () => {
  const usage = (blockedAt: number | null) => ({
    writeDay: null,
    writeCount: 0,
    contentBytes: 0,
    docCount: 0,
    blockedAt,
    warnedAt: null,
  })

  it('DS1 막힌 소유자 본인 → 4403 forbidden', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'owner', email: 'owner@example.com', usage: usage(123) })
    expect(await resolveDocSocket(upgrade(), makeEnv().env, DOC_ID)).toEqual({ type: 'close', code: 4403, reason: 'forbidden' })
  })

  it('DS2 편집 초대 사용자, 소유자 막힘 → 4403 forbidden', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'e', email: 'editor@example.com', usage: usage(null) })
    const { env } = makeEnv({
      grants: [{ target_type: 'doc', target_id: DOC_ID, grantee_email: 'editor@example.com', role: 'edit' }],
      users: [{ id: 'owner', blocked_at: 123 }],
    })
    expect(await resolveDocSocket(upgrade(), env, DOC_ID)).toEqual({ type: 'close', code: 4403, reason: 'forbidden' })
  })

  it('DS3 안 막힌 소유자 → forward, 사용량 문장 0', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'owner', email: 'owner@example.com', usage: usage(null) })
    const { env, sqls } = makeEnv()
    const decision = await resolveDocSocket(upgrade(), env, DOC_ID)
    expect(decision.type).toBe('forward')
    expect(sqls.filter((s) => s.startsWith('SELECT write_day'))).toEqual([])
  })
})
