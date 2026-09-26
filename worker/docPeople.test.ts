// 접근 집합 — 소유자·문서 초대·폴더 사슬 초대 (specs/features/F-502.md 7장, 13.4 P1~P5)
import { describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'

import { asD1, openTestDb } from './testD1'
import { loadDocPeople } from './docPeople'

function setup() {
  const sqlDb = openTestDb()
  const user = sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
  user.run('owner', 'Owner@Example.com', 1)
  user.run('other', 'other@example.com', 1)
  const d1 = asD1(sqlDb)
  let prepares = 0
  const DB = {
    prepare(sql: string) {
      prepares++
      return d1.prepare(sql)
    },
    batch: d1.batch.bind(d1),
  } as unknown as D1Database
  return { sqlDb, env: { DB } as unknown as Env, prepares: () => prepares }
}

function folder(sqlDb: DatabaseSync, id: string, parentId: string | null, ownerId = 'owner') {
  sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(id, ownerId, id, parentId, 1, 1)
}

function doc(sqlDb: DatabaseSync, id: string, folderId: string | null, e2eeKey: string | null = null) {
  sqlDb
    .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, 'owner', 't', '', 'lf', folderId, 1, 1, 1, e2eeKey)
}

function grant(sqlDb: DatabaseSync, type: 'doc' | 'folder', targetId: string, email: string, role: 'view' | 'edit', ownerId = 'owner') {
  sqlDb
    .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(type, targetId, ownerId, email, role, 1)
}

describe('F-502 P1 역할·순서', () => {
  it('소유자 먼저, 높은 역할, 소문자·사전순', async () => {
    const { sqlDb, env } = setup()
    folder(sqlDb, 'top', null)
    folder(sqlDb, 'mid', 'top')
    doc(sqlDb, 'd1', 'mid')
    grant(sqlDb, 'doc', 'd1', 'zed@example.com', 'view')
    grant(sqlDb, 'folder', 'top', 'amy@example.com', 'edit')
    grant(sqlDb, 'doc', 'd1', 'Both@Example.com', 'view')
    grant(sqlDb, 'folder', 'mid', 'both@example.com', 'edit')
    grant(sqlDb, 'doc', 'd1', 'owner@example.com', 'view')
    expect(await loadDocPeople(env, 'd1')).toEqual([
      { email: 'owner@example.com', role: 'owner' },
      { email: 'amy@example.com', role: 'edit' },
      { email: 'both@example.com', role: 'edit' },
      { email: 'zed@example.com', role: 'view' },
    ])
  })
})

describe('F-502 P2 들어가지 않는 초대', () => {
  it('사슬 밖 폴더, 다른 소유자의 초대', async () => {
    const { sqlDb, env } = setup()
    folder(sqlDb, 'top', null)
    folder(sqlDb, 'side', null)
    doc(sqlDb, 'd1', 'top')
    grant(sqlDb, 'folder', 'side', 'side@example.com', 'edit')
    grant(sqlDb, 'folder', 'top', 'stranger@example.com', 'edit', 'other')
    grant(sqlDb, 'doc', 'd1', 'stranger2@example.com', 'edit', 'other')
    expect(await loadDocPeople(env, 'd1')).toEqual([{ email: 'owner@example.com', role: 'owner' }])
  })
})

describe('F-502 P3 질의 수', () => {
  it('폴더 있음 3 / 없음 2', async () => {
    const withFolder = setup()
    folder(withFolder.sqlDb, 'top', null)
    doc(withFolder.sqlDb, 'd1', 'top')
    await loadDocPeople(withFolder.env, 'd1')
    expect(withFolder.prepares()).toBe(3)

    const noFolder = setup()
    doc(noFolder.sqlDb, 'd1', null)
    await loadDocPeople(noFolder.env, 'd1')
    expect(noFolder.prepares()).toBe(2)
  })
})

describe('F-502 P4 없음', () => {
  it('없는 문서 / 금고 문서 → null', async () => {
    const { sqlDb, env } = setup()
    doc(sqlDb, 'vault', null, 'KEY')
    expect(await loadDocPeople(env, 'missing')).toBeNull()
    expect(await loadDocPeople(env, 'vault')).toBeNull()
  })
})

describe('F-502 P5 순환', () => {
  it('사슬에 순환이 있어도 끝난다', async () => {
    const { sqlDb, env } = setup()
    folder(sqlDb, 'a', 'b')
    folder(sqlDb, 'b', 'a')
    doc(sqlDb, 'd1', 'a')
    grant(sqlDb, 'folder', 'b', 'loop@example.com', 'view')
    expect(await loadDocPeople(env, 'd1')).toEqual([
      { email: 'owner@example.com', role: 'owner' },
      { email: 'loop@example.com', role: 'view' },
    ])
  })
})
