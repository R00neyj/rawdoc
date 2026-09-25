// 금고 키 묶음 서버 API — GET·PUT·DELETE /api/e2ee/keys 호출과 응답 분류 (specs/features/F-404.md 5.2, 라우트는 F-401.md 3.1)
export type KeysErrorReason = 'offline' | 'unauthorized' | 'rate-limited' | 'account-blocked' | 'failed'

export type KeysGet = { kind: 'found'; bundle: string; rev: number } | { kind: 'none' } | { kind: 'error'; reason: KeysErrorReason }
export type KeysPut = { kind: 'ok'; rev: number } | { kind: 'conflict'; rev: number } | { kind: 'error'; reason: KeysErrorReason }
export type KeysDelete =
  | { kind: 'ok' }
  | { kind: 'not-empty'; docs: number; folders: number }
  | { kind: 'error'; reason: KeysErrorReason }

const PATH = '/api/e2ee/keys'

async function send(init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(PATH, { credentials: 'same-origin', ...init })
  } catch {
    return null
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function classifyCommonError(status: number): KeysErrorReason | null {
  if (status === 401) return 'unauthorized'
  if (status === 429) return 'rate-limited'
  return null
}

export async function getKeys(): Promise<KeysGet> {
  const res = await send()
  if (!res) return { kind: 'error', reason: 'offline' }

  if (res.status === 200) {
    const data = (await readJson(res)) as { bundle?: unknown; rev?: unknown } | null
    if (data && typeof data.bundle === 'string' && typeof data.rev === 'number' && data.rev >= 0) {
      return { kind: 'found', bundle: data.bundle, rev: data.rev }
    }
    return { kind: 'error', reason: 'failed' }
  }
  if (res.status === 404) {
    const data = (await readJson(res)) as { error?: unknown } | null
    if (data && data.error === 'no_vault') return { kind: 'none' }
    return { kind: 'error', reason: 'failed' }
  }
  const common = classifyCommonError(res.status)
  if (common) return { kind: 'error', reason: common }
  if (res.status === 403) {
    const data = (await readJson(res)) as { error?: unknown } | null
    if (data && data.error === 'account_blocked') return { kind: 'error', reason: 'account-blocked' }
    return { kind: 'error', reason: 'failed' }
  }
  return { kind: 'error', reason: 'failed' }
}

export async function putKeys(bundle: string, baseRev: number): Promise<KeysPut> {
  const res = await send({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bundle, baseRev }),
  })
  if (!res) return { kind: 'error', reason: 'offline' }

  if (res.status === 200) {
    const data = (await readJson(res)) as { rev?: unknown } | null
    if (data && typeof data.rev === 'number') return { kind: 'ok', rev: data.rev }
    return { kind: 'error', reason: 'failed' }
  }
  if (res.status === 409) {
    const data = (await readJson(res)) as { error?: unknown; rev?: unknown } | null
    if (data && data.error === 'conflict' && typeof data.rev === 'number') return { kind: 'conflict', rev: data.rev }
    return { kind: 'error', reason: 'failed' }
  }
  const common = classifyCommonError(res.status)
  if (common) return { kind: 'error', reason: common }
  if (res.status === 403) {
    const data = (await readJson(res)) as { error?: unknown } | null
    if (data && data.error === 'account_blocked') return { kind: 'error', reason: 'account-blocked' }
    return { kind: 'error', reason: 'failed' }
  }
  return { kind: 'error', reason: 'failed' }
}

export async function deleteKeys(): Promise<KeysDelete> {
  const res = await send({ method: 'DELETE' })
  if (!res) return { kind: 'error', reason: 'offline' }

  if (res.status === 204) return { kind: 'ok' }
  if (res.status === 409) {
    const data = (await readJson(res)) as { error?: unknown; docs?: unknown; folders?: unknown } | null
    if (data && data.error === 'vault_not_empty' && typeof data.docs === 'number' && typeof data.folders === 'number') {
      return { kind: 'not-empty', docs: data.docs, folders: data.folders }
    }
    return { kind: 'error', reason: 'failed' }
  }
  const common = classifyCommonError(res.status)
  if (common) return { kind: 'error', reason: common }
  if (res.status === 403) {
    const data = (await readJson(res)) as { error?: unknown } | null
    if (data && data.error === 'account_blocked') return { kind: 'error', reason: 'account-blocked' }
    return { kind: 'error', reason: 'failed' }
  }
  return { kind: 'error', reason: 'failed' }
}
