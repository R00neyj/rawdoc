// GitHub 앱 설정·켜짐 판정·월 횟수 (specs/features/F-3014.md 3장)
import { jsonResponse } from './http'
import { readVar } from './origin'
import { importTokenKey } from './githubCrypto'
import { githubMonth, githubQuotaResetAt } from '../src/lib/githubContract'

export type GithubConfig = { clientId: string; clientSecret: string; slug: string; key: CryptoKey; baseUrl: string }
export type GithubSettings = { enabled: boolean; monthlyLimit: number | null }

let warnedMissingConfig = false

function baseUrlOf(env: Env): string | null {
  try {
    return new URL(readVar(env, 'BETTER_AUTH_URL') ?? '').origin
  } catch {
    return null
  }
}

// 비밀 값이 없으면 기능이 꺼진다 — 푸시 loadVapid 선례 (3장)
export async function loadGithubConfig(env: Env): Promise<GithubConfig | null> {
  const clientId = readVar(env, 'GITHUB_APP_CLIENT_ID') ?? ''
  const slug = readVar(env, 'GITHUB_APP_SLUG') ?? ''
  const clientSecret = typeof env.GITHUB_APP_CLIENT_SECRET === 'string' ? env.GITHUB_APP_CLIENT_SECRET : ''
  const key = clientId && slug && clientSecret ? await importTokenKey(env.GITHUB_TOKEN_KEY) : null
  const baseUrl = baseUrlOf(env)
  if (!key || !baseUrl) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true
      console.error('github_config_missing')
    }
    return null
  }
  return { clientId, clientSecret, slug, key, baseUrl }
}

export async function loadGithubSettings(db: D1Database): Promise<GithubSettings> {
  const row = await db
    .prepare('SELECT enabled, monthly_limit FROM github_settings WHERE id = ?')
    .bind(1)
    .first<{ enabled: number; monthly_limit: number | null }>()
  if (!row) return { enabled: false, monthlyLimit: null }
  return { enabled: row.enabled === 1, monthlyLimit: row.monthly_limit }
}

export async function githubUsedThisMonth(db: D1Database, userId: string, now: number): Promise<number> {
  const row = await db
    .prepare('SELECT count FROM github_usage WHERE user_id = ? AND month = ?')
    .bind(userId, githubMonth(now))
    .first<{ count: number }>()
  return row?.count ?? 0
}

export async function checkGithubQuota(db: D1Database, userId: string, monthlyLimit: number | null, now: number): Promise<Response | null> {
  if (monthlyLimit === null) return null
  const used = await githubUsedThisMonth(db, userId, now)
  if (used < monthlyLimit) return null
  return jsonResponse({ error: 'github_quota', limit: monthlyLimit, resetAt: githubQuotaResetAt(now) }, 429)
}

export async function countGithubUse(db: D1Database, userId: string, now: number): Promise<void> {
  await db
    .prepare('INSERT INTO github_usage (user_id, month, count) VALUES (?, ?, 1) ON CONFLICT (user_id, month) DO UPDATE SET count = count + 1')
    .bind(userId, githubMonth(now))
    .run()
}

export async function loadEnabledGithub(env: Env): Promise<{ config: GithubConfig; settings: GithubSettings } | null> {
  const settings = await loadGithubSettings(env.DB)
  if (!settings.enabled) return null
  const config = await loadGithubConfig(env)
  return config ? { config, settings } : null
}
