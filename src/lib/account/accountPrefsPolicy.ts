// 계정에 실어 다른 기기가 따르는 설정의 허용 키·값 — 서버와 앱이 같이 쓴다 (small 2026-11-04)

export const ACCOUNT_PREFS_MAX_BODY_BYTES = 1024

const ALLOWED = {
  lineBreaks: ['on', 'off'],
} as const

export type AccountPrefKey = keyof typeof ALLOWED
export type AccountPrefs = { [K in AccountPrefKey]?: (typeof ALLOWED)[K][number] }

export const ACCOUNT_PREF_KEYS = Object.keys(ALLOWED) as AccountPrefKey[]

const isKey = (key: string): key is AccountPrefKey => Object.hasOwn(ALLOWED, key)
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const allowedValue = (key: AccountPrefKey, value: unknown) => (ALLOWED[key] as readonly unknown[]).includes(value)

export function validateAccountPrefs(v: unknown): { ok: true; prefs: AccountPrefs } | { ok: false } {
  if (!isObject(v)) return { ok: false }
  const entries = Object.entries(v)
  if (entries.length === 0) return { ok: false }
  for (const [key, value] of entries) if (!isKey(key) || !allowedValue(key, value)) return { ok: false }
  return { ok: true, prefs: v as AccountPrefs }
}

export function pickAccountPrefs(v: unknown): AccountPrefs {
  const out: Record<string, unknown> = {}
  if (!isObject(v)) return out
  for (const key of ACCOUNT_PREF_KEYS) if (allowedValue(key, v[key])) out[key] = v[key]
  return out as AccountPrefs
}
