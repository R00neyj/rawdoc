// 계정 삭제 — 표지 판정·API 호출·이 기기 정리 순서 (specs/features/F-2038.md 6·7장, C2~C4·C7)
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_DELETE_DONE_MARKER,
  cleanUpAfterAccountDelete,
  decideAccountDeleteMarker,
  fetchAccountPreview,
  reauthLoginUrl,
  requestAccountDelete,
  resumeMarker,
  type CleanupDeps,
} from './accountDelete'
import type { AccountState } from './account'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const IN: AccountState = { state: 'in', id: 'u1', email: 'a@b.com', blocked: false, warned: false }
const NOW = 1_790_000_000_000

describe('F-2038 C2 다시 열기 표지 판정', () => {
  it('같은 id·9분 59초 → 열기, 10분 → 없음, 다른 id → 경고', () => {
    expect(decideAccountDeleteMarker(resumeMarker('u1', NOW - 599_000), IN, NOW)).toEqual({ action: 'open', clear: true })
    expect(decideAccountDeleteMarker(resumeMarker('u1', NOW - 600_000), IN, NOW)).toEqual({ action: 'none', clear: true })
    expect(decideAccountDeleteMarker(resumeMarker('other', NOW), IN, NOW)).toEqual({ action: 'warn', clear: true })
  })

  it('done → 완료 알림, 계정 상태와 무관', () => {
    for (const account of [IN, { state: 'out' } as AccountState, { state: 'offline' } as AccountState]) {
      expect(decideAccountDeleteMarker(ACCOUNT_DELETE_DONE_MARKER, account, NOW)).toEqual({ action: 'done', clear: true })
    }
  })

  it("'{'·'null'·{\"step\":\"x\"}·모양 틀림 → 없음", () => {
    for (const raw of ['{', 'null', '{"step":"x"}', '{"step":"resume","userId":1,"at":1}', '{"step":"resume","userId":"u1"}', '[]']) {
      expect([raw, decideAccountDeleteMarker(raw, IN, NOW)]).toEqual([raw, { action: 'none', clear: true }])
    }
  })

  it('표지 없음 → 아무것도 안 하고 지우지도 않는다', () => {
    expect(decideAccountDeleteMarker(null, IN, NOW)).toEqual({ action: 'none', clear: false })
  })

  it('resume 인데 offline 이면 남겨 두고, out 이면 지운다', () => {
    expect(decideAccountDeleteMarker(resumeMarker('u1', NOW), { state: 'offline' }, NOW)).toEqual({ action: 'none', clear: false })
    expect(decideAccountDeleteMarker(resumeMarker('u1', NOW), { state: 'out' }, NOW)).toEqual({ action: 'none', clear: true })
  })

  it('표지 모양 — 6.5 표 그대로', () => {
    expect(JSON.parse(resumeMarker('u1', NOW))).toEqual({ step: 'resume', userId: 'u1', at: NOW })
    expect(JSON.parse(ACCOUNT_DELETE_DONE_MARKER)).toEqual({ step: 'done' })
  })
})

describe('다시 로그인 주소 (4.3)', () => {
  it('지금 해시를 return 에, reauth=1', () => {
    expect(reauthLoginUrl('#/d/abc')).toBe('/login?return=%23%2Fd%2Fabc&reauth=1')
    expect(reauthLoginUrl('')).toBe('/login?return=&reauth=1')
  })
})

const PREVIEW = {
  email: 'a@b.com',
  docs: 3,
  e2eeDocs: 0,
  sharedDocs: 1,
  folders: 1,
  attachments: { count: 2, bytes: 1_572_864 },
  tokens: 0,
  fresh: true,
  freshUntil: NOW,
}

function respond(status: number, body?: unknown) {
  return vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }))
}

describe('F-2038 C3 미리 보기 호출', () => {
  it('200 → 값, 401 → out, fetch 던짐 → offline, 500 → failed', async () => {
    const ok = respond(200, PREVIEW)
    expect(await fetchAccountPreview(ok as unknown as typeof fetch)).toEqual({ kind: 'ok', preview: PREVIEW })
    expect(ok).toHaveBeenCalledWith('/api/account', { credentials: 'same-origin', redirect: 'manual' })
    expect(await fetchAccountPreview(respond(401, { error: 'unauthenticated' }) as unknown as typeof fetch)).toEqual({ kind: 'out' })
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await fetchAccountPreview(down as unknown as typeof fetch)).toEqual({ kind: 'offline' })
    expect(await fetchAccountPreview(respond(500, { error: 'internal' }) as unknown as typeof fetch)).toEqual({ kind: 'failed' })
  })

  it('응답 숫자가 숫자가 아니면 failed', async () => {
    for (const bad of [
      { ...PREVIEW, docs: '3' },
      { ...PREVIEW, attachments: { count: 2 } },
      { ...PREVIEW, fresh: 'yes' },
      { ...PREVIEW, freshUntil: 'x' },
      { ...PREVIEW, email: 1 },
    ]) {
      expect(await fetchAccountPreview(respond(200, bad) as unknown as typeof fetch)).toEqual({ kind: 'failed' })
    }
    const notJson = vi.fn(async () => new Response('<html>', { status: 200 }))
    expect(await fetchAccountPreview(notJson as unknown as typeof fetch)).toEqual({ kind: 'failed' })
    expect(await fetchAccountPreview(respond(200, { ...PREVIEW, freshUntil: null }) as unknown as typeof fetch)).toEqual({
      kind: 'ok',
      preview: { ...PREVIEW, freshUntil: null },
    })
  })
})

describe('F-2038 C4 삭제 호출', () => {
  it('204 → ok, 403 reauth_required·401 → reauth, 던짐 → network, 500·403 forbidden_origin → failed', async () => {
    const ok = respond(204)
    expect(await requestAccountDelete(ok as unknown as typeof fetch)).toBe('ok')
    expect(ok).toHaveBeenCalledWith('/api/account', { method: 'DELETE', credentials: 'same-origin', redirect: 'manual' })
    expect(await requestAccountDelete(respond(403, { error: 'reauth_required', freshMinutes: 10 }) as unknown as typeof fetch)).toBe('reauth')
    expect(await requestAccountDelete(respond(401, { error: 'unauthenticated' }) as unknown as typeof fetch)).toBe('reauth')
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await requestAccountDelete(down as unknown as typeof fetch)).toBe('network')
    expect(await requestAccountDelete(respond(500, { error: 'internal' }) as unknown as typeof fetch)).toBe('failed')
    expect(await requestAccountDelete(respond(403, { error: 'forbidden_origin' }) as unknown as typeof fetch)).toBe('failed')
  })
})

function cleanupDeps(over: Partial<CleanupDeps> = {}) {
  const log: string[] = []
  const deps: CleanupDeps = {
    lockVault: () => log.push('lock'),
    clearRemoteCache: async () => {
      log.push('remote')
    },
    clearYjs: async () => {
      log.push('yjs')
    },
    clearE2eeRow: async () => {
      log.push('e2ee')
    },
    setPref: (key, value) => log.push(`pref ${key}=${value}`),
    writeMarker: (value) => log.push(`marker ${value}`),
    navigate: (url) => log.push(`go ${url}`),
    ...over,
  }
  return { deps, log }
}

describe('F-2038 C7 이 기기 정리 순서', () => {
  it('잠금 → 세 지우기 → localStorage 두 값 → 표지 → 이동', async () => {
    const { deps, log } = cleanupDeps()
    await cleanUpAfterAccountDelete(deps)
    expect(log[0]).toBe('lock')
    expect(log.slice(1, 4).sort()).toEqual(['e2ee', 'remote', 'yjs'])
    expect(log.slice(4)).toEqual(['pref md.account=', 'pref md.lastDocId=', 'marker {"step":"done"}', 'go /?app=1'])
  })

  it('하나가 던져도 나머지와 뒤 단계가 불린다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps, log } = cleanupDeps({
      clearYjs: async () => {
        throw new Error('idb broken')
      },
    })
    await cleanUpAfterAccountDelete(deps)
    expect(log).toContain('remote')
    expect(log).toContain('e2ee')
    expect(log.slice(-2)).toEqual(['marker {"step":"done"}', 'go /?app=1'])
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('하나가 끝나지 않으면 3,000ms 뒤 이동', async () => {
    vi.useFakeTimers()
    const { deps, log } = cleanupDeps({ clearRemoteCache: () => new Promise<void>(() => {}) })
    const done = cleanUpAfterAccountDelete(deps)
    await vi.advanceTimersByTimeAsync(2_999)
    expect(log).not.toContain('go /?app=1')
    await vi.advanceTimersByTimeAsync(1)
    await done
    expect(log.slice(-2)).toEqual(['marker {"step":"done"}', 'go /?app=1'])
  })
})
