// F-3014 A1 마이그레이션 0023, A16 횟수 (specs/features/F-3014.md 3장)
import { describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'
import { checkGithubQuota, countGithubUse, loadGithubSettings } from '../../worker/githubSettings'
import { githubMonth, githubQuotaResetAt } from '../../src/lib/githubContract'

const NOW = Date.UTC(2026, 9, 31, 23, 59)

function withUsers(): DatabaseSync {
  const db = openTestDb()
  db.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@example.com', 1), ('u2', 'b@example.com', 1)").run()
  return db
}

function addAccount(db: DatabaseSync, userId: string, githubId: number) {
  db.prepare(
    "INSERT INTO github_accounts (user_id, github_id, login, access_token, access_expires_at, refresh_token, refresh_expires_at, token_rev, created_at, updated_at) VALUES (?, ?, 'l', 'v1.a.b', 1, 'v1.a.b', 1, 1, 1, 1)",
  ).run(userId, githubId)
}

describe('F-3014 A1 0023 마이그레이션', () => {
  it('설정 행 (1, 0, NULL, 0), id = 2 거절, github_id 중복 거절, foreign_keys 켜짐', () => {
    const db = withUsers()
    expect(db.prepare('SELECT id, enabled, monthly_limit, updated_at FROM github_settings').all()).toEqual([
      { id: 1, enabled: 0, monthly_limit: null, updated_at: 0 },
    ])
    expect(() => db.prepare('INSERT INTO github_settings (id, enabled, monthly_limit, updated_at) VALUES (2, 1, NULL, 0)').run()).toThrow(/CHECK/)
    addAccount(db, 'u1', 42)
    expect(() => addAccount(db, 'u2', 42)).toThrow(/UNIQUE/)
    expect(() => addAccount(db, 'nobody', 43)).toThrow(/FOREIGN KEY/)
  })

  it('github_links 를 둔 채 docs 를 지우면 FK 실패, links 를 먼저 지우면 된다', () => {
    const db = withUsers()
    db.prepare("INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d1', 'u1', 't', '', 'lf', 1, 1, 1)").run()
    db.prepare("INSERT INTO github_links (doc_id, owner_id, repo_id, repo, branch, path, created_at) VALUES ('d1', 'u1', 1, 'o/r', 'main', 'a.md', 1)").run()
    expect(() => db.prepare("DELETE FROM docs WHERE id = 'd1'").run()).toThrow(/FOREIGN KEY/)
    db.prepare("DELETE FROM github_links WHERE doc_id = 'd1'").run()
    db.prepare("DELETE FROM docs WHERE id = 'd1'").run()
  })
})

describe('F-3014 loadGithubSettings', () => {
  it('행 그대로, 행이 없으면 꺼짐·무제한', async () => {
    const db = withUsers()
    expect(await loadGithubSettings(asD1(db))).toEqual({ enabled: false, monthlyLimit: null })
    db.prepare('UPDATE github_settings SET enabled = 1, monthly_limit = 5').run()
    expect(await loadGithubSettings(asD1(db))).toEqual({ enabled: true, monthlyLimit: 5 })
    db.prepare('DELETE FROM github_settings').run()
    expect(await loadGithubSettings(asD1(db))).toEqual({ enabled: false, monthlyLimit: null })
  })
})

describe('F-3014 A16 횟수', () => {
  it('monthlyLimit null → D1 을 읽지 않고 null', async () => {
    const prepare = vi.fn(() => {
      throw new Error('read')
    })
    expect(await checkGithubQuota({ prepare } as unknown as D1Database, 'u1', null, NOW)).toBeNull()
    expect(prepare).not.toHaveBeenCalled()
  })

  it('2/3 → null, 3/3 → 429 github_quota { limit, resetAt }', async () => {
    const db = withUsers()
    const d1 = asD1(db)
    await countGithubUse(d1, 'u1', NOW)
    await countGithubUse(d1, 'u1', NOW)
    expect(await checkGithubQuota(d1, 'u1', 3, NOW)).toBeNull()
    await countGithubUse(d1, 'u1', NOW)
    const res = (await checkGithubQuota(d1, 'u1', 3, NOW))!
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'github_quota', limit: 3, resetAt: githubQuotaResetAt(NOW) })
    expect(await checkGithubQuota(d1, 'u2', 3, NOW)).toBeNull()
  })

  it('countGithubUse 두 번 → 2, 달마다 따로', async () => {
    const db = withUsers()
    const d1 = asD1(db)
    await countGithubUse(d1, 'u1', NOW)
    await countGithubUse(d1, 'u1', NOW)
    await countGithubUse(d1, 'u1', NOW + 60_000 * 2)
    const rows = db.prepare('SELECT month, count FROM github_usage WHERE user_id = ? ORDER BY month').all('u1')
    expect(rows).toEqual([
      { month: githubMonth(NOW), count: 2 },
      { month: '2026-11', count: 1 },
    ])
  })
})
