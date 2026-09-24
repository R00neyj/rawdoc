// 문서 행 조건부 쓰기 한 벌 (specs/features/F-308.md 6.1, A9)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rowToDoc, updateDocRow } from './docWrite'
import type { DocRow } from './docWrite'
import { V1_EXAMPLES } from './v1Contract'

const UPDATE_SQL = 'UPDATE docs SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?'

function row(overrides: Partial<DocRow> = {}): DocRow {
  return {
    id: 'd1', owner_id: 'u1', title: 't', content: 'c', line_ending: 'lf',
    folder_id: null, pinned_at: null, version: 3, created_at: 1, updated_at: 2,
    ...overrides,
  }
}

function makeDb(changes: number) {
  const calls: { sql: string; args: unknown[] }[] = []
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              calls.push({ sql, args })
              return { meta: { changes } }
            },
          }
        },
      }
    },
  }
  return { env: { DB } as unknown as Env, calls }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(5_000_000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('F-308 A9 updateDocRow·rowToDoc', () => {
  it('문장이 글자까지 같고, 없는 필드는 existing 값, version + 1, 가짜 시계, 조건 existing.version', async () => {
    const { env, calls } = makeDb(1)
    const result = await updateDocRow(env, row(), { content: 'new' })
    expect(calls).toHaveLength(1)
    expect(calls[0].sql).toBe(UPDATE_SQL)
    expect(calls[0].args).toEqual(['t', 'new', 4, 5_000_000, 'd1', 'u1', 3])
    expect(result).toEqual({ ok: true, row: row({ content: 'new', version: 4, updated_at: 5_000_000 }) })

    const titled = makeDb(1)
    await updateDocRow(titled.env, row(), { title: '새 제목' })
    expect(titled.calls[0].args).toEqual(['새 제목', 'c', 4, 5_000_000, 'd1', 'u1', 3])
  })

  it('0행이면 { ok: false }', async () => {
    const { env } = makeDb(0)
    await expect(updateDocRow(env, row(), { title: 'x', content: 'y' })).resolves.toEqual({ ok: false })
  })

  it('rowToDoc 키 집합이 V1_EXAMPLES.doc 과 같다', () => {
    expect(Object.keys(rowToDoc(row())).sort()).toEqual(Object.keys(V1_EXAMPLES.doc).sort())
    expect(rowToDoc(row())).toEqual({
      id: 'd1', title: 't', content: 'c', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 3, createdAt: 1, updatedAt: 2,
    })
  })
})
