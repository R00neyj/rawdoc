// F-221 A1 계정당 이미지 저장 한도 — 서버 판정 (specs/features/F-221.md 2.2)
import { describe, expect, it, vi } from 'vitest'

vi.mock('./auth', () => ({
  requireUser: vi.fn(async (request: Request) => {
    const id = request.headers.get('x-test-user') ?? 'u1'
    return { id, email: `${id}@example.com` }
  }),
}))

import { handleGetUsage, handleUploadAttachment, ATTACHMENT_QUOTA_BYTES } from './attachments'

type AttachmentRow = { owner_id: string; id: string; ext: string; mime: string; size: number; width: number; height: number; created_at: number }

function pngBytes(size: number): Uint8Array {
  // IHDR 24바이트 뒤 나머지는 0으로 채운다 — sniffImage 는 IHDR 만 본다 (worker/imageSniff.ts)
  const bytes = new Uint8Array(Math.max(size, 24))
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  sig.forEach((b, i) => (bytes[i] = b))
  bytes.set([0, 0, 0, 13], 8)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12) // IHDR
  bytes.set([0, 0, 0, 2], 16) // width 2
  bytes.set([0, 0, 0, 2], 20) // height 2
  return bytes
}

function makeEnv(rows: AttachmentRow[] = []) {
  const attachments = new Map(rows.map((r) => [`${r.owner_id}:${r.id}`, r]))
  const putCalls: string[] = []
  const insertCalls: unknown[][] = []

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.startsWith('SELECT * FROM attachments WHERE owner_id')) {
                const [ownerId, id] = args as [string, string]
                return (attachments.get(`${ownerId}:${id}`) as T) ?? null
              }
              if (sql.startsWith('SELECT COALESCE(SUM(size),0)')) {
                const [ownerId] = args as [string]
                const used = [...attachments.values()].filter((a) => a.owner_id === ownerId).reduce((sum, a) => sum + a.size, 0)
                return { used } as T
              }
              if (sql.startsWith('SELECT write_day')) return null
              throw new Error(`unhandled sql: ${sql}`)
            },
            async run() {
              if (sql.startsWith('INSERT INTO attachments')) {
                insertCalls.push(args)
                const [ownerId, id, ext, mime, size, width, height, createdAt] = args as [
                  string, string, string, string, number, number, number, number,
                ]
                attachments.set(`${ownerId}:${id}`, { owner_id: ownerId, id, ext, mime, size, width, height, created_at: createdAt })
                return { meta: { changes: 1 } }
              }
              if (sql.startsWith('UPDATE users SET')) return { meta: { changes: 1 } }
              throw new Error(`unhandled sql: ${sql}`)
            },
          }
        },
      }
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      return results
    },
  }

  const BUCKET = {
    async put(key: string) {
      putCalls.push(key)
    },
  }

  return { env: { DB, BUCKET } as unknown as Env, attachments, putCalls, insertCalls }
}

function uploadRequest(bytes: Uint8Array, ownerId = 'u1'): Request {
  return new Request(`http://local.test/api/attachments/x`, {
    method: 'PUT',
    headers: { 'Content-Length': String(bytes.length), 'x-test-user': ownerId },
    body: bytes,
  })
}

describe('F-221 A1 handleUploadAttachment 한도', () => {
  it('합계 + 새 크기가 한도 이하면 201', async () => {
    const { env, putCalls, insertCalls } = makeEnv()
    const bytes = pngBytes(100)
    const res = await handleUploadAttachment(uploadRequest(bytes), env, {} as ExecutionContext, { idext: 'aaaaaaaaaaaaaaaa.png' })
    expect(res.status).toBe(201)
    expect(putCalls.length).toBe(1)
    expect(insertCalls.length).toBe(1)
  })

  it('합계 + 새 크기가 한도 초과면 507, R2·D1 에 쓰지 않는다', async () => {
    const existing: AttachmentRow = {
      owner_id: 'u1', id: 'bbbbbbbbbbbbbbbb', ext: 'png', mime: 'image/png',
      size: ATTACHMENT_QUOTA_BYTES - 50, width: 2, height: 2, created_at: 1,
    }
    const { env, putCalls, insertCalls } = makeEnv([existing])
    const bytes = pngBytes(100)
    const res = await handleUploadAttachment(uploadRequest(bytes), env, {} as ExecutionContext, { idext: 'aaaaaaaaaaaaaaaa.png' })
    expect(res.status).toBe(507)
    const body = (await res.json()) as { error: string; used: number; limit: number }
    expect(body.error).toBe('quota_exceeded')
    expect(body.used).toBe(ATTACHMENT_QUOTA_BYTES - 50)
    expect(body.limit).toBe(ATTACHMENT_QUOTA_BYTES)
    expect(putCalls.length).toBe(0)
    expect(insertCalls.length).toBe(0)
  })

  it('같은 id 가 이미 있으면 한도 검사 없이 200', async () => {
    const existing: AttachmentRow = {
      owner_id: 'u1', id: 'aaaaaaaaaaaaaaaa', ext: 'png', mime: 'image/png',
      size: 10, width: 2, height: 2, created_at: 1,
    }
    const { env, putCalls, insertCalls } = makeEnv([existing])
    const bytes = pngBytes(100)
    const res = await handleUploadAttachment(uploadRequest(bytes), env, {} as ExecutionContext, { idext: 'aaaaaaaaaaaaaaaa.png' })
    expect(res.status).toBe(200)
    expect(putCalls.length).toBe(0)
    expect(insertCalls.length).toBe(0)
  })
})

describe('F-221 A1 handleGetUsage', () => {
  it('owner_id 합계를 돌려준다', async () => {
    const rows: AttachmentRow[] = [
      { owner_id: 'u1', id: 'a1', ext: 'png', mime: 'image/png', size: 100, width: 1, height: 1, created_at: 1 },
      { owner_id: 'u1', id: 'a2', ext: 'png', mime: 'image/png', size: 200, width: 1, height: 1, created_at: 1 },
      { owner_id: 'u2', id: 'a3', ext: 'png', mime: 'image/png', size: 999, width: 1, height: 1, created_at: 1 },
    ]
    const { env } = makeEnv(rows)
    const req = new Request('http://local.test/api/usage', { headers: { 'x-test-user': 'u1' } })
    const res = await handleGetUsage(req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { used: number; limit: number }
    expect(body.used).toBe(300)
    expect(body.limit).toBe(ATTACHMENT_QUOTA_BYTES)
  })
})
