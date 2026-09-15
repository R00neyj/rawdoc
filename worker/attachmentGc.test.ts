import { describe, expect, it } from 'vitest'
import { cleanupServerAttachments } from './attachmentGc'

type DocRow = { id: string; content: string }
type AttachmentRow = { owner_id: string; id: string; ext: string; created_at: number }

function makeEnv(docs: DocRow[], attachments: AttachmentRow[], opts: { failR2Keys?: Set<string> } = {}) {
  const docList = [...docs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const attachmentRows = new Map(attachments.map((a) => [`${a.owner_id}:${a.id}`, a]))
  const failR2Keys = opts.failR2Keys ?? new Set<string>()
  const deletedKeys: string[] = []

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async all<T>() {
              if (sql.startsWith('SELECT content FROM docs')) {
                const [limit, offset] = args as [number, number]
                const page = docList.slice(offset, offset + limit).map((d) => ({ content: d.content }))
                return { results: page as unknown as T[] }
              }
              if (sql.startsWith('SELECT owner_id, id, ext, created_at FROM attachments')) {
                const [threshold] = args as [number]
                const rows = attachments.filter((a) => a.created_at < threshold).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
                return { results: rows as unknown as T[] }
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
            async run() {
              if (sql.startsWith('DELETE FROM attachments')) {
                const [ownerId, id] = args as [string, string]
                attachmentRows.delete(`${ownerId}:${id}`)
                return { meta: { changes: 1 } }
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
          }
        },
      }
    },
  }

  const BUCKET = {
    async delete(key: string) {
      if (failR2Keys.has(key)) throw new Error('r2 delete failed')
      deletedKeys.push(key)
    },
  }

  return { env: { DB, BUCKET } as unknown as Env, attachmentRows, deletedKeys }
}

const NOW = Date.parse('2026-09-15T00:00:00Z')
const HOUR = 60 * 60 * 1000

describe('F-219 A1 cleanupServerAttachments', () => {
  it('참조 없음·25시간 전 → R2·D1 삭제', async () => {
    const { env, attachmentRows, deletedKeys } = makeEnv(
      [{ id: 'd1', content: '내용' }],
      [{ owner_id: 'u1', id: 'aaaaaaaaaaaaaaaa', ext: 'png', created_at: NOW - 25 * HOUR }],
    )
    const result = await cleanupServerAttachments(env, NOW)
    expect(result).toEqual({ deleted: 1, failed: 0 })
    expect(attachmentRows.size).toBe(0)
    expect(deletedKeys).toEqual(['att/u1/aaaaaaaaaaaaaaaa.png'])
  })

  it('참조 있으면 남긴다', async () => {
    const { env, attachmentRows } = makeEnv(
      [{ id: 'd1', content: '<img src="attachments/aaaaaaaaaaaaaaaa.png" alt="">' }],
      [{ owner_id: 'u1', id: 'aaaaaaaaaaaaaaaa', ext: 'png', created_at: NOW - 25 * HOUR }],
    )
    const result = await cleanupServerAttachments(env, NOW)
    expect(result).toEqual({ deleted: 0, failed: 0 })
    expect(attachmentRows.size).toBe(1)
  })

  it('참조 없음·23시간 전 → 남긴다', async () => {
    const { env, attachmentRows } = makeEnv(
      [],
      [{ owner_id: 'u1', id: 'aaaaaaaaaaaaaaaa', ext: 'png', created_at: NOW - 23 * HOUR }],
    )
    const result = await cleanupServerAttachments(env, NOW)
    expect(result).toEqual({ deleted: 0, failed: 0 })
    expect(attachmentRows.size).toBe(1)
  })

  it('다른 사용자 문서가 참조하면 남긴다', async () => {
    const { env, attachmentRows } = makeEnv(
      [{ id: 'd1', content: '<img src="attachments/aaaaaaaaaaaaaaaa.png" alt="">' }],
      [{ owner_id: 'u2', id: 'aaaaaaaaaaaaaaaa', ext: 'png', created_at: NOW - 25 * HOUR }],
    )
    const result = await cleanupServerAttachments(env, NOW)
    expect(result).toEqual({ deleted: 0, failed: 0 })
    expect(attachmentRows.size).toBe(1)
  })

  it('R2 삭제 실패 → D1 행 남김', async () => {
    const key = 'att/u1/aaaaaaaaaaaaaaaa.png'
    const { env, attachmentRows } = makeEnv(
      [],
      [{ owner_id: 'u1', id: 'aaaaaaaaaaaaaaaa', ext: 'png', created_at: NOW - 25 * HOUR }],
      { failR2Keys: new Set([key]) },
    )
    const result = await cleanupServerAttachments(env, NOW)
    expect(result).toEqual({ deleted: 0, failed: 1 })
    expect(attachmentRows.size).toBe(1)
  })

  it('600개 대상 → 500개만 지운다', async () => {
    const attachments: AttachmentRow[] = Array.from({ length: 600 }, (_, i) => ({
      owner_id: 'u1',
      id: `a${String(i).padStart(15, '0')}`,
      ext: 'png',
      created_at: NOW - 25 * HOUR,
    }))
    const { env, attachmentRows } = makeEnv([], attachments)
    const result = await cleanupServerAttachments(env, NOW)
    expect(result).toEqual({ deleted: 500, failed: 0 })
    expect(attachmentRows.size).toBe(100)
  })

  it('문서가 200개 넘으면 페이지로 나눠 읽어도 참조를 모두 잡는다', async () => {
    const docs: DocRow[] = Array.from({ length: 250 }, (_, i) => ({ id: `d${String(i).padStart(3, '0')}`, content: '' }))
    docs[249] = { id: 'd249', content: '<img src="attachments/aaaaaaaaaaaaaaaa.png" alt="">' }
    const { env, attachmentRows } = makeEnv(
      docs,
      [{ owner_id: 'u1', id: 'aaaaaaaaaaaaaaaa', ext: 'png', created_at: NOW - 25 * HOUR }],
    )
    const result = await cleanupServerAttachments(env, NOW)
    expect(result).toEqual({ deleted: 0, failed: 0 })
    expect(attachmentRows.size).toBe(1)
  })
})
