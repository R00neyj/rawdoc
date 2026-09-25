// 금고 키 상태 기계 — 상태·잠그는 순서·자동 잠금 판정. DOM·React·IndexedDB 를 직접 쓰지 않고 출처·시계·조합 여부·방송을 주입받는다 (F-404.md 3·4장)
import {
  E2eeError,
  changePassword as cryptoChangePassword,
  createKeyBundle,
  openWithPassword,
  openWithRecoveryCode,
  parseKeyBundle,
  resetWithRecoveryCode,
  serializeKeyBundle,
  type E2eeErrorCode,
  type E2eeKeyBundle,
} from './crypto'

export type E2eeScope = { kind: 'local' } | { kind: 'account'; userId: string }
export type E2eeStatus = 'unknown' | 'loading' | 'unavailable' | 'none' | 'locked' | 'open'
export type E2eeLockReason = 'manual' | 'idle' | 'other-tab' | 'account' | 'reset' | 'page-restore'
export type E2eeLockPhase = 'flush' | 'unmount' | 'indexes' | 'blobs'
export type E2eeLockOutcome = 'locked' | 'deferred' | 'aborted' | 'not-open'

// 화면이 문구를 고르는 오류 코드 (F-404.md 7.9 표)
export type E2eeActionError =
  | 'wrong-password'
  | 'wrong-recovery-code'
  | 'password-too-short'
  | 'vault-exists'
  | 'conflict'
  | 'no-vault'
  | 'vault-not-empty'
  | 'offline'
  | 'rate-limited'
  | 'account-blocked'
  | 'bad-bundle'
  | 'unsupported-version'
  | 'failed'

export const E2EE_LOCK_MINUTES = [5, 15, 30, 60, 240] as const
export type E2eeLockMinutes = (typeof E2EE_LOCK_MINUTES)[number]
export const E2EE_DEFAULT_LOCK_MINUTES = 30
export const E2EE_IDLE_CHECK_MS = 15_000

// 목록 밖·빈 값·숫자 아님·정수가 아닌 표기(예: '30.0')는 모두 기본값 30 (F-404.md 3.3)
export function parseLockMinutes(raw: string): E2eeLockMinutes {
  const n = Number(raw)
  if (String(n) === raw && (E2EE_LOCK_MINUTES as readonly number[]).includes(n)) {
    return n as E2eeLockMinutes
  }
  return E2EE_DEFAULT_LOCK_MINUTES
}

export function isIdleExpired(lastActivityAt: number, now: number, lockMinutes: number): boolean {
  return now - lastActivityAt >= lockMinutes * 60_000
}

// bundleSource.ts 의 E2eeBundleSource 와 구조적으로 같은 모양 — keyring.ts 는 storage 를 import 하지 않는다 (F-404.md 1장 의존 방향)
export type E2eeBundleRead =
  | { kind: 'found'; bundle: string; rev: number }
  | { kind: 'none' }
  | { kind: 'error'; reason: 'offline' | 'failed' }
export type E2eeBundleWrite =
  | { kind: 'ok' }
  | { kind: 'conflict' }
  | { kind: 'not-empty'; docs: number; folders: number }
  | { kind: 'error'; reason: 'offline' | 'rate-limited' | 'account-blocked' | 'failed' }
export type E2eeBundleSource = {
  read(): Promise<E2eeBundleRead>
  create(bundle: string): Promise<E2eeBundleWrite>
  replace(bundle: string, expected: { bundle: string; rev: number }): Promise<E2eeBundleWrite>
  remove(): Promise<E2eeBundleWrite>
}

export type E2eeActionResult = { ok: true } | { ok: false; error: E2eeActionError }
export type E2eeActionResultWithCode = { ok: true; recoveryCode: string } | { ok: false; error: E2eeActionError }
export type E2eeResetResult = { ok: true } | { ok: false; error: E2eeActionError; docs?: number; folders?: number }

export type KeyringDeps = {
  scope: E2eeScope
  source: E2eeBundleSource
  now?: () => number
  isComposing?: () => boolean
  onBroadcastLock?: () => void
}

export type Keyring = {
  readonly scope: E2eeScope
  getStatus(): E2eeStatus
  subscribe(listener: () => void): () => void
  getMasterKey(): CryptoKey | null
  registerLockStep(phase: E2eeLockPhase, step: () => void | Promise<void>): () => void
  registerResetStep(step: () => Promise<void>): () => void
  lock(reason: E2eeLockReason): Promise<E2eeLockOutcome>
  // 조합이 끝난 뒤(한 틱 뒤) useE2ee.ts 가 부른다 — 미뤄 둔 잠그기가 있으면 다시 시도한다
  retryDeferredLock(): Promise<E2eeLockOutcome | null>

  // 다른 명세가 이 이름·모양을 그대로 쓰지 않는다(부르는 곳은 useE2ee.ts 하나뿐, F-404.md 3.4)
  load(): Promise<void>
  open(password: string): Promise<E2eeActionError | null>
  createStart(password: string): Promise<E2eeActionResultWithCode>
  createConfirm(): Promise<E2eeActionResult>
  createCancel(): void
  changePassword(oldPassword: string, newPassword: string): Promise<E2eeActionError | null>
  recoveryVerify(recoveryCode: string): Promise<E2eeActionResult>
  recoveryReset(newPassword: string): Promise<E2eeActionResultWithCode>
  recoveryConfirm(): Promise<E2eeActionResult>
  recoveryCancel(): void
  reset(): Promise<E2eeResetResult>

  // 자동 잠금 — useE2ee.ts 가 활동 이벤트·타이머에서 부른다 (F-404.md 4.3)
  noteActivity(): void
  checkIdle(lockMinutes: number): Promise<E2eeLockOutcome> | null
}

function mapCryptoError(code: E2eeErrorCode): E2eeActionError {
  switch (code) {
    case 'wrong-password':
      return 'wrong-password'
    case 'wrong-recovery-code':
    case 'bad-recovery-code':
      return 'wrong-recovery-code'
    case 'password-too-short':
      return 'password-too-short'
    case 'bad-bundle':
      return 'bad-bundle'
    case 'unsupported-version':
      return 'unsupported-version'
    default:
      return 'failed'
  }
}

function mapWriteErrorReason(reason: 'offline' | 'rate-limited' | 'account-blocked' | 'failed'): E2eeActionError {
  return reason
}

type PendingCreate = { bundleJson: string; masterKey: CryptoKey; recoveryCode: string }
type PendingRecoveryVerify = { bundleJson: string; bundle: E2eeKeyBundle; rev: number; code: string }
type PendingRecoveryCommit = {
  bundleJson: string
  masterKey: CryptoKey
  recoveryCode: string
  expectedBundleJson: string
  expectedRev: number
}

export function createKeyring(deps: KeyringDeps): Keyring {
  const { scope, source } = deps
  const clockNow = deps.now ?? (() => Date.now())
  const isComposing = deps.isComposing ?? (() => false)
  const onBroadcastLock = deps.onBroadcastLock

  let status: E2eeStatus = 'unknown'
  let masterKey: CryptoKey | null = null
  let lastActivityAt = clockNow()
  const listeners = new Set<() => void>()

  const lockSteps: Record<E2eeLockPhase, Array<() => void | Promise<void>>> = {
    flush: [],
    unmount: [],
    indexes: [],
    blobs: [],
  }
  const resetSteps: Array<() => Promise<void>> = []

  let actionInFlight: Promise<unknown> | null = null
  let lockInFlight: Promise<E2eeLockOutcome> | null = null
  let deferredReason: E2eeLockReason | null = null

  let pendingCreate: PendingCreate | null = null
  let pendingRecoveryVerify: PendingRecoveryVerify | null = null
  let pendingRecoveryCommit: PendingRecoveryCommit | null = null

  function setStatus(next: E2eeStatus) {
    if (status === next) return
    status = next
    for (const listener of listeners) listener()
  }

  function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (actionInFlight) return actionInFlight as Promise<T>
    const p = fn()
    const wrapped = p.finally(() => {
      if (actionInFlight === wrapped) actionInFlight = null
    })
    actionInFlight = wrapped
    return p
  }

  async function runLockSteps(reason: E2eeLockReason): Promise<E2eeLockOutcome> {
    for (const step of lockSteps.flush) {
      try {
        await step()
      } catch {
        return 'aborted'
      }
    }
    for (const phase of ['unmount', 'indexes', 'blobs'] as const) {
      for (const step of lockSteps[phase]) {
        try {
          await step()
        } catch (err) {
          console.error(err)
        }
      }
    }
    masterKey = null
    setStatus('locked')
    if (reason === 'manual' || reason === 'idle' || reason === 'reset') {
      onBroadcastLock?.()
    }
    return 'locked'
  }

  async function lock(reason: E2eeLockReason): Promise<E2eeLockOutcome> {
    if (deferredReason) return 'deferred'
    if (lockInFlight) return lockInFlight
    if (status !== 'open') return 'not-open'
    if (isComposing()) {
      deferredReason = reason
      return 'deferred'
    }
    const p = runLockSteps(reason)
    lockInFlight = p
    try {
      return await p
    } finally {
      lockInFlight = null
    }
  }

  async function retryDeferredLock(): Promise<E2eeLockOutcome | null> {
    if (!deferredReason) return null
    const reason = deferredReason
    deferredReason = null
    return lock(reason)
  }

  async function load(): Promise<void> {
    if (status === 'open') {
      const result = await source.read()
      if (result.kind === 'none') {
        await lock('reset')
        setStatus('none')
      }
      return
    }
    setStatus('loading')
    const result = await source.read()
    if (result.kind === 'found') {
      setStatus('locked')
      return
    }
    if (result.kind === 'none') {
      setStatus('none')
      return
    }
    setStatus('unavailable')
  }

  function open(password: string): Promise<E2eeActionError | null> {
    return runExclusive(async () => {
      const result = await source.read()
      if (result.kind === 'none') {
        setStatus('none')
        return 'no-vault'
      }
      if (result.kind === 'error') {
        setStatus('unavailable')
        return result.reason === 'offline' ? 'offline' : 'failed'
      }
      let bundle: E2eeKeyBundle
      try {
        bundle = parseKeyBundle(result.bundle)
      } catch {
        setStatus('locked')
        return 'bad-bundle'
      }
      try {
        const { masterKey: mk, upgradedBundle } = await openWithPassword(bundle, password)
        masterKey = mk
        lastActivityAt = clockNow()
        setStatus('open')
        if (upgradedBundle) {
          void source.replace(serializeKeyBundle(upgradedBundle), { bundle: result.bundle, rev: result.rev }).catch(() => {})
        }
        return null
      } catch (err) {
        setStatus('locked')
        if (err instanceof E2eeError) return mapCryptoError(err.code)
        return 'failed'
      }
    })
  }

  function createStart(password: string): Promise<E2eeActionResultWithCode> {
    return runExclusive(async () => {
      const result = await source.read()
      if (result.kind === 'error') {
        return { ok: false, error: result.reason === 'offline' ? 'offline' : 'failed' }
      }
      if (result.kind === 'found') {
        setStatus('locked')
        return { ok: false, error: 'vault-exists' }
      }
      setStatus('none')
      try {
        const { bundle, recoveryCode, masterKey: mk } = await createKeyBundle(password)
        pendingCreate = { bundleJson: serializeKeyBundle(bundle), masterKey: mk, recoveryCode }
        return { ok: true, recoveryCode }
      } catch (err) {
        if (err instanceof E2eeError) return { ok: false, error: mapCryptoError(err.code) }
        return { ok: false, error: 'failed' }
      }
    })
  }

  function createConfirm(): Promise<E2eeActionResult> {
    return runExclusive(async () => {
      if (!pendingCreate) return { ok: false, error: 'failed' }
      const { bundleJson, masterKey: mk } = pendingCreate
      const result = await source.create(bundleJson)
      if (result.kind === 'ok') {
        masterKey = mk
        lastActivityAt = clockNow()
        pendingCreate = null
        setStatus('open')
        return { ok: true }
      }
      if (result.kind === 'conflict') {
        pendingCreate = null
        setStatus('locked')
        return { ok: false, error: 'vault-exists' }
      }
      const reason = result.kind === 'error' ? result.reason : 'failed'
      return { ok: false, error: mapWriteErrorReason(reason) }
    })
  }

  function createCancel(): void {
    pendingCreate = null
  }

  function changePassword(oldPassword: string, newPassword: string): Promise<E2eeActionError | null> {
    return runExclusive(async () => {
      const result = await source.read()
      if (result.kind === 'none') {
        setStatus('none')
        return 'no-vault'
      }
      if (result.kind === 'error') {
        return result.reason === 'offline' ? 'offline' : 'failed'
      }
      let bundle: E2eeKeyBundle
      try {
        bundle = parseKeyBundle(result.bundle)
      } catch {
        return 'bad-bundle'
      }
      try {
        const newBundle = await cryptoChangePassword(bundle, oldPassword, newPassword)
        const writeResult = await source.replace(serializeKeyBundle(newBundle), { bundle: result.bundle, rev: result.rev })
        if (writeResult.kind === 'ok') return null
        if (writeResult.kind === 'conflict') return 'conflict'
        return mapWriteErrorReason(writeResult.kind === 'error' ? writeResult.reason : 'failed')
      } catch (err) {
        if (err instanceof E2eeError) return mapCryptoError(err.code)
        return 'failed'
      }
    })
  }

  function recoveryVerify(recoveryCode: string): Promise<E2eeActionResult> {
    return runExclusive(async () => {
      const result = await source.read()
      if (result.kind === 'none') {
        setStatus('none')
        return { ok: false, error: 'no-vault' }
      }
      if (result.kind === 'error') {
        return { ok: false, error: result.reason === 'offline' ? 'offline' : 'failed' }
      }
      let bundle: E2eeKeyBundle
      try {
        bundle = parseKeyBundle(result.bundle)
      } catch {
        return { ok: false, error: 'bad-bundle' }
      }
      try {
        await openWithRecoveryCode(bundle, recoveryCode)
        pendingRecoveryVerify = { bundleJson: result.bundle, bundle, rev: result.rev, code: recoveryCode }
        return { ok: true }
      } catch (err) {
        if (err instanceof E2eeError) return { ok: false, error: mapCryptoError(err.code) }
        return { ok: false, error: 'failed' }
      }
    })
  }

  function recoveryReset(newPassword: string): Promise<E2eeActionResultWithCode> {
    return runExclusive(async () => {
      if (!pendingRecoveryVerify) return { ok: false, error: 'failed' }
      try {
        const { bundle: newBundle, recoveryCode, masterKey: mk } = await resetWithRecoveryCode(
          pendingRecoveryVerify.bundle,
          pendingRecoveryVerify.code,
          newPassword,
        )
        pendingRecoveryCommit = {
          bundleJson: serializeKeyBundle(newBundle),
          masterKey: mk,
          recoveryCode,
          expectedBundleJson: pendingRecoveryVerify.bundleJson,
          expectedRev: pendingRecoveryVerify.rev,
        }
        return { ok: true, recoveryCode }
      } catch (err) {
        if (err instanceof E2eeError) return { ok: false, error: mapCryptoError(err.code) }
        return { ok: false, error: 'failed' }
      }
    })
  }

  function recoveryConfirm(): Promise<E2eeActionResult> {
    return runExclusive(async () => {
      if (!pendingRecoveryCommit) return { ok: false, error: 'failed' }
      const { bundleJson, masterKey: mk, expectedBundleJson, expectedRev } = pendingRecoveryCommit
      const result = await source.replace(bundleJson, { bundle: expectedBundleJson, rev: expectedRev })
      if (result.kind === 'ok') {
        masterKey = mk
        lastActivityAt = clockNow()
        pendingRecoveryVerify = null
        pendingRecoveryCommit = null
        setStatus('open')
        return { ok: true }
      }
      if (result.kind === 'conflict') return { ok: false, error: 'conflict' }
      return { ok: false, error: mapWriteErrorReason(result.kind === 'error' ? result.reason : 'failed') }
    })
  }

  function recoveryCancel(): void {
    pendingRecoveryVerify = null
    pendingRecoveryCommit = null
  }

  function reset(): Promise<E2eeResetResult> {
    return runExclusive(async () => {
      let broadcastedByLock = false
      if (status === 'open') {
        const outcome = await lock('reset')
        if (outcome !== 'locked') return { ok: false, error: 'failed' }
        broadcastedByLock = true
      }
      for (const step of resetSteps) {
        try {
          await step()
        } catch (err) {
          console.error(err)
        }
      }
      const result = await source.remove()
      if (result.kind === 'ok') {
        setStatus('none')
        if (!broadcastedByLock) onBroadcastLock?.()
        return { ok: true }
      }
      if (result.kind === 'not-empty') {
        return { ok: false, error: 'vault-not-empty', docs: result.docs, folders: result.folders }
      }
      return { ok: false, error: mapWriteErrorReason(result.kind === 'error' ? result.reason : 'failed') }
    })
  }

  function noteActivity(): void {
    lastActivityAt = clockNow()
  }

  function checkIdle(lockMinutes: number): Promise<E2eeLockOutcome> | null {
    if (status !== 'open') return null
    if (!isIdleExpired(lastActivityAt, clockNow(), lockMinutes)) return null
    return lock('idle')
  }

  return {
    scope,
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getMasterKey: () => masterKey,
    registerLockStep(phase, step) {
      lockSteps[phase].push(step)
      return () => {
        const idx = lockSteps[phase].indexOf(step)
        if (idx !== -1) lockSteps[phase].splice(idx, 1)
      }
    },
    registerResetStep(step) {
      resetSteps.push(step)
      return () => {
        const idx = resetSteps.indexOf(step)
        if (idx !== -1) resetSteps.splice(idx, 1)
      }
    },
    lock,
    retryDeferredLock,
    load,
    open,
    createStart,
    createConfirm,
    createCancel,
    changePassword,
    recoveryVerify,
    recoveryReset,
    recoveryConfirm,
    recoveryCancel,
    reset,
    noteActivity,
    checkIdle,
  }
}
