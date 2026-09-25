// 금고 키 상태 기계 (specs/features/F-404.md 10.1 U1~U8)
import { describe, expect, it, vi } from 'vitest'
import { createKeyBundle, serializeKeyBundle } from './crypto'
import {
  createKeyring,
  isIdleExpired,
  parseLockMinutes,
  type E2eeBundleRead,
  type E2eeBundleSource,
  type E2eeBundleWrite,
  type E2eeScope,
} from './keyring'

const SCOPE: E2eeScope = { kind: 'local' }

// 메모리 출처 — 5.3 계약과 같은 모양. 반복 수를 낮춘 1,000회 묶음을 기본으로 쓴다(10.1 머리말)
function makeMemorySource(initial?: { bundle: string; rev: number }) {
  let row: { bundle: string; rev: number } | null = initial ?? null
  let readError: 'offline' | 'failed' | null = null
  const calls = { read: 0, create: 0, replace: 0, remove: 0 }

  const source: E2eeBundleSource = {
    async read(): Promise<E2eeBundleRead> {
      calls.read += 1
      if (readError) return { kind: 'error', reason: readError }
      if (!row) return { kind: 'none' }
      return { kind: 'found', bundle: row.bundle, rev: row.rev }
    },
    async create(bundle): Promise<E2eeBundleWrite> {
      calls.create += 1
      if (row) return { kind: 'conflict' }
      row = { bundle, rev: 0 }
      return { kind: 'ok' }
    },
    async replace(bundle, expected): Promise<E2eeBundleWrite> {
      calls.replace += 1
      if (!row || row.bundle !== expected.bundle) return { kind: 'conflict' }
      row = { bundle, rev: row.rev + 1 }
      return { kind: 'ok' }
    },
    async remove(): Promise<E2eeBundleWrite> {
      calls.remove += 1
      row = null
      return { kind: 'ok' }
    },
  }

  return { source, calls, setReadError: (v: 'offline' | 'failed' | null) => (readError = v), getRow: () => row }
}

async function makeBundle(password: string) {
  const { bundle } = await createKeyBundle(password, { iterations: 1_000 })
  return serializeKeyBundle(bundle)
}

describe('U1 — load', () => {
  it('없음 → none, 있음 → locked, 출처 오류 offline → unavailable. subscribe 가 상태마다 불린다', async () => {
    const { source: emptySource } = makeMemorySource()
    const emptyRing = createKeyring({ scope: SCOPE, source: emptySource })
    const seen: string[] = []
    emptyRing.subscribe(() => seen.push(emptyRing.getStatus()))
    await emptyRing.load()
    expect(emptyRing.getStatus()).toBe('none')
    expect(seen).toEqual(['loading', 'none'])

    const bundle = await makeBundle('충분히긴금고암호입니다')
    const { source: foundSource } = makeMemorySource({ bundle, rev: 0 })
    const foundRing = createKeyring({ scope: SCOPE, source: foundSource })
    await foundRing.load()
    expect(foundRing.getStatus()).toBe('locked')

    const { source: errSource, setReadError } = makeMemorySource()
    setReadError('offline')
    const errRing = createKeyring({ scope: SCOPE, source: errSource })
    await errRing.load()
    expect(errRing.getStatus()).toBe('unavailable')
  })
})

describe('U2 — 열기', () => {
  it('맞는 암호 → open, 틀린 암호 → wrong-password. 1,000회 묶음은 열린 뒤 replace 로 반복 수를 올린다', async () => {
    const password = '충분히긴금고암호입니다'
    const bundle = await makeBundle(password)
    const { source, calls } = makeMemorySource({ bundle, rev: 0 })
    const ring = createKeyring({ scope: SCOPE, source })

    const wrongErr = await ring.open('틀린암호입니다1234')
    expect(wrongErr).toBe('wrong-password')
    expect(ring.getStatus()).toBe('locked')

    const err = await ring.open(password)
    expect(err).toBeNull()
    expect(ring.getStatus()).toBe('open')
    const mk = ring.getMasterKey()
    expect(mk).not.toBeNull()
    expect((mk as CryptoKey).extractable).toBe(false)

    await vi.waitFor(() => expect(calls.replace).toBe(1))
    // upgradedBundle 은 서명된 반복 수로 다시 감싼 것 — expected 는 연 묶음 원문
    expect(calls.replace).toBe(1)
  }, 15_000)

  it('replace 가 conflict 여도 상태는 open 그대로', async () => {
    const password = '충분히긴금고암호입니다'
    const bundle = await makeBundle(password)
    const { source } = makeMemorySource({ bundle, rev: 0 })
    // 쓰는 동안 다른 곳이 먼저 바꾼 상황을 흉내낸다 — replace 는 항상 conflict
    source.replace = async () => ({ kind: 'conflict' })
    const ring = createKeyring({ scope: SCOPE, source })

    const err = await ring.open(password)
    expect(err).toBeNull()
    expect(ring.getStatus()).toBe('open')
  }, 15_000)
})

describe('U3 — 만들기', () => {
  it('createConfirm 전에는 none 이고 MK 가 없다. conflict → vault-exists·locked·MK 없음', async () => {
    const { source } = makeMemorySource()
    const ring = createKeyring({ scope: SCOPE, source })

    const start = await ring.createStart('충분히긴금고암호입니다')
    expect(start.ok).toBe(true)
    expect(ring.getStatus()).toBe('none')
    expect(ring.getMasterKey()).toBeNull()

    source.create = async () => ({ kind: 'conflict' })
    const confirm = await ring.createConfirm()
    expect(confirm).toEqual({ ok: false, error: 'vault-exists' })
    expect(ring.getStatus()).toBe('locked')
    expect(ring.getMasterKey()).toBeNull()
  })

  it('create 가 offline 이면 상태는 none, 같은 묶음으로 다시 부르면 두 번째 create 인자가 첫 번째와 같다', async () => {
    const { source } = makeMemorySource()
    const calledWith: string[] = []
    source.create = async (bundle) => {
      calledWith.push(bundle)
      if (calledWith.length === 1) return { kind: 'error', reason: 'offline' }
      return { kind: 'ok' }
    }
    const ring = createKeyring({ scope: SCOPE, source })

    const start = await ring.createStart('충분히긴금고암호입니다')
    expect(start.ok).toBe(true)

    const first = await ring.createConfirm()
    expect(first).toEqual({ ok: false, error: 'offline' })
    expect(ring.getStatus()).toBe('none')

    const second = await ring.createConfirm()
    expect(second).toEqual({ ok: true })
    expect(calledWith[0]).toBe(calledWith[1])
  })
})

describe('U4 — 잠그기 순서', () => {
  it('flush,flush,unmount,unmount,indexes,indexes,blobs,blobs 순서로 돈다. 해제한 단계는 안 불린다', async () => {
    const password = '충분히긴금고암호입니다'
    const bundle = await makeBundle(password)
    const { source } = makeMemorySource({ bundle, rev: 0 })
    const ring = createKeyring({ scope: SCOPE, source })
    await ring.open(password)

    const order: string[] = []
    const mkDuringSteps: (CryptoKey | null)[] = []
    const mkPush = (label: string) => () => {
      order.push(label)
      mkDuringSteps.push(ring.getMasterKey())
    }
    ring.registerLockStep('flush', mkPush('flush'))
    ring.registerLockStep('flush', mkPush('flush'))
    ring.registerLockStep('unmount', mkPush('unmount'))
    ring.registerLockStep('unmount', mkPush('unmount'))
    ring.registerLockStep('indexes', mkPush('indexes'))
    ring.registerLockStep('indexes', mkPush('indexes'))
    ring.registerLockStep('blobs', mkPush('blobs'))
    const unregisterSecondBlobs = ring.registerLockStep('blobs', mkPush('blobs'))
    unregisterSecondBlobs()

    const outcome = await ring.lock('manual')
    expect(order).toEqual(['flush', 'flush', 'unmount', 'unmount', 'indexes', 'indexes', 'blobs'])
    expect(mkDuringSteps.every((mk) => mk !== null)).toBe(true)
    expect(ring.getMasterKey()).toBeNull()
    expect(ring.getStatus()).toBe('locked')
    expect(outcome).toBe('locked')
  })
})

describe('U5 — flush 실패', () => {
  it('flush 가 거부되면 aborted, open, MK 그대로, 뒤 단계 안 불림', async () => {
    const password = '충분히긴금고암호입니다'
    const bundle = await makeBundle(password)
    const { source } = makeMemorySource({ bundle, rev: 0 })
    const ring = createKeyring({ scope: SCOPE, source })
    await ring.open(password)

    const calledAfter: string[] = []
    ring.registerLockStep('flush', async () => {
      throw new Error('flush 실패')
    })
    ring.registerLockStep('unmount', () => {
      calledAfter.push('unmount')
    })

    const outcome = await ring.lock('manual')
    expect(outcome).toBe('aborted')
    expect(ring.getStatus()).toBe('open')
    expect(ring.getMasterKey()).not.toBeNull()
    expect(calledAfter).toEqual([])
  })

  it('unmount 가 던지면 기록만 하고 계속해서 locked', async () => {
    const password = '충분히긴금고암호입니다'
    const bundle = await makeBundle(password)
    const { source } = makeMemorySource({ bundle, rev: 0 })
    const ring = createKeyring({ scope: SCOPE, source })
    await ring.open(password)

    ring.registerLockStep('unmount', () => {
      throw new Error('unmount 실패')
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const outcome = await ring.lock('manual')
    spy.mockRestore()
    expect(outcome).toBe('locked')
    expect(ring.getStatus()).toBe('locked')
  })
})

describe('U6 — 조합 미룸', () => {
  it('조합 중이면 deferred, 조합이 끝나면 잠긴다. 미룬 동안 더 불러도 단계는 한 번만', async () => {
    const password = '충분히긴금고암호입니다'
    const bundle = await makeBundle(password)
    const { source } = makeMemorySource({ bundle, rev: 0 })
    let composing = true
    const ring = createKeyring({ scope: SCOPE, source, isComposing: () => composing })
    await ring.open(password)

    let stepCalls = 0
    ring.registerLockStep('flush', () => {
      stepCalls += 1
    })

    const outcome1 = await ring.lock('idle')
    expect(outcome1).toBe('deferred')
    expect(ring.getStatus()).toBe('open')

    const outcome2 = await ring.lock('manual')
    expect(outcome2).toBe('deferred')

    composing = false
    const retried = await ring.retryDeferredLock()
    expect(retried).toBe('locked')
    expect(stepCalls).toBe(1)
    expect(ring.getStatus()).toBe('locked')
  })
})

describe('U7 — 방송', () => {
  it('manual·idle·reset 은 방송 한 번, other-tab·account·page-restore 는 0번, not-open 은 0번', async () => {
    const reasons: Array<'manual' | 'idle' | 'reset' | 'other-tab' | 'account' | 'page-restore'> = [
      'manual',
      'idle',
      'reset',
      'other-tab',
      'account',
      'page-restore',
    ]
    for (const reason of reasons) {
      const password = '충분히긴금고암호입니다'
      const bundle = await makeBundle(password)
      const { source } = makeMemorySource({ bundle, rev: 0 })
      const onBroadcastLock = vi.fn()
      const ring = createKeyring({ scope: SCOPE, source, onBroadcastLock })
      await ring.open(password)
      await ring.lock(reason)
      if (reason === 'manual' || reason === 'idle' || reason === 'reset') {
        expect(onBroadcastLock).toHaveBeenCalledTimes(1)
      } else {
        expect(onBroadcastLock).toHaveBeenCalledTimes(0)
      }
    }

    const { source } = makeMemorySource()
    const onBroadcastLock = vi.fn()
    const ring = createKeyring({ scope: SCOPE, source, onBroadcastLock })
    const outcome = await ring.lock('manual')
    expect(outcome).toBe('not-open')
    expect(onBroadcastLock).toHaveBeenCalledTimes(0)
  })
})

describe('U8 — 자동 잠금 함수', () => {
  it('isIdleExpired 경계값', () => {
    expect(isIdleExpired(0, 1_799_999, 30)).toBe(false)
    expect(isIdleExpired(0, 1_800_000, 30)).toBe(true)
  })

  it('parseLockMinutes', () => {
    expect(parseLockMinutes('5')).toBe(5)
    expect(parseLockMinutes('240')).toBe(240)
    expect(parseLockMinutes('10')).toBe(30)
    expect(parseLockMinutes('')).toBe(30)
    expect(parseLockMinutes('abc')).toBe(30)
    expect(parseLockMinutes('30.0')).toBe(30)
  })

  it('주입 시계로 열고 29분 59초 뒤 검사 → 열림, 활동 기록 후 20분 뒤 검사 → 열림, 그 뒤 30분 → 잠김(idle)', async () => {
    const password = '충분히긴금고암호입니다'
    const bundle = await makeBundle(password)
    const { source } = makeMemorySource({ bundle, rev: 0 })
    let now = 0
    const ring = createKeyring({ scope: SCOPE, source, now: () => now })
    await ring.open(password)

    now += 29 * 60_000 + 59_000
    await ring.checkIdle(30)
    expect(ring.getStatus()).toBe('open')

    ring.noteActivity()
    now += 20 * 60_000
    await ring.checkIdle(30)
    expect(ring.getStatus()).toBe('open')

    now += 30 * 60_000
    await ring.checkIdle(30)
    expect(ring.getStatus()).toBe('locked')
  })

  it('40분 비운 뒤 활동 이벤트 — 검사가 먼저이므로 그 호출이 잠근다', async () => {
    const password = '충분히긴금고암호입니다'
    const bundle = await makeBundle(password)
    const { source } = makeMemorySource({ bundle, rev: 0 })
    let now = 0
    const ring = createKeyring({ scope: SCOPE, source, now: () => now })
    await ring.open(password)

    now += 40 * 60_000
    // 활동 이벤트 처리 순서: 먼저 검사, 그 다음 시각을 적는다 (F-404.md 4.3)
    await ring.checkIdle(30)
    ring.noteActivity()
    expect(ring.getStatus()).toBe('locked')
  })
})
