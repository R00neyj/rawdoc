// 설정 `이 기기에서 푸시 받기` 상태·흐름 배선, 부팅 다시 알리기, 서비스 워커 push-open 수신 (F-2110 5장)
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { getPref, setPref } from './prefs'
import { storedAccount, type AccountState } from './account'
import type { DocMeta } from './docMeta'
import type { NoticeWithAction } from './NoticeBar'
import type { SettingsPush } from './SettingsDialog'
import {
  PUSH_SW_READY_TIMEOUT_MS,
  fetchPushKey,
  isIosLike,
  isPublicBoot,
  pushOpenTarget,
  pushSettingsView,
  sendTestPush,
  syncPushOnBoot,
  turnOffPush,
  turnOnPush,
  type PushDeps,
  type PushKeyState,
  type PushManagerLike,
  type PushPermission,
  type PushSettingsInput,
} from './pushClient'

export type UsePushDeviceOptions = {
  bootPhase: 'booting' | 'ready'
  account: AccountState
  online: boolean
  showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
  docsRef: RefObject<DocMeta[]>
  resyncFromStore: () => Promise<void>
}
export type UsePushDeviceResult = { settingsPush: SettingsPush | undefined }

const PERMISSIONS: readonly string[] = ['default', 'granted', 'denied']

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function isStandalone(): boolean {
  const nav = navigator as unknown as { standalone?: unknown }
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

function readPermission(): PushPermission {
  const value = typeof Notification === 'undefined' ? 'denied' : Notification.permission
  return PERMISSIONS.includes(value) ? (value as PushPermission) : 'default'
}

function readyPushManager(): Promise<PushManagerLike | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PUSH_SW_READY_TIMEOUT_MS))
  const ready = navigator.serviceWorker.ready.then((reg) => reg.pushManager as unknown as PushManagerLike)
  return Promise.race([ready, timeout]).catch(() => null)
}

function browserDeps(): PushDeps {
  return {
    platform: {
      supported: isSupported,
      permission: readPermission,
      requestPermission: async () => {
        const result = await Notification.requestPermission()
        return PERMISSIONS.includes(result) ? result : 'default'
      },
      pushManager: readyPushManager,
    },
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    getPref: (key) => getPref(key, ''),
    setPref: (key, value) => setPref(key, value),
  }
}

export function usePushDevice(options: UsePushDeviceOptions): UsePushDeviceResult {
  const { bootPhase, account, online } = options
  const [busy, setBusy] = useState<PushSettingsInput['busy']>(null)
  const [key, setKey] = useState<PushKeyState>({ kind: 'unknown' })
  const [, setTick] = useState(0)
  const keyRef = useRef(key)
  const mountedRef = useRef(true)
  const busyRef = useRef(busy)
  const optionsRef = useRef(options)
  const syncedBootRef = useRef(false)
  const pendingOpenRef = useRef<{ hash: string; docId: string } | null>(null)
  const bootedPublicRef = useRef<boolean | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  useEffect(() => {
    optionsRef.current = options
    busyRef.current = busy
    keyRef.current = key
  })

  const userId = account.state === 'in' ? account.id : account.state === 'offline' ? storedAccount()?.id : undefined

  const remember = useCallback((next: PushKeyState) => {
    keyRef.current = next
    if (mountedRef.current) setKey(next)
  }, [])
  const changeBusy = useCallback((next: PushSettingsInput['busy']) => {
    busyRef.current = next
    if (mountedRef.current) setBusy(next)
  }, [])

  // 부팅 다시 알리기 — 계정이 in 이 된 첫 때 한 번 (4.4)
  useEffect(() => {
    if (bootPhase !== 'ready' || account.state !== 'in' || syncedBootRef.current) return
    syncedBootRef.current = true
    void syncPushOnBoot(browserDeps(), account.id)
  }, [bootPhase, account])

  // push-open 적용 — 문서가 목록에 없으면 목록을 다시 읽고 옮긴다 (5.2 3)
  const applyOpen = useCallback(async (target: { hash: string; docId: string }) => {
    const { docsRef, resyncFromStore } = optionsRef.current
    if (!docsRef.current.some((d) => d.id === target.docId) && navigator.onLine) await resyncFromStore().catch(() => {})
    location.hash = target.hash
  }, [])

  // push-open 수신 — 부팅 때부터 듣는다 (5.2 1)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    bootedPublicRef.current ??= isPublicBoot(location.hash)
    const sw = navigator.serviceWorker
    function onMessage(event: MessageEvent) {
      const target = pushOpenTarget(event.data, bootedPublicRef.current === true)
      if (target.kind === 'none') return
      if (target.kind === 'reload') {
        history.replaceState(null, '', target.url)
        location.reload()
        return
      }
      if (optionsRef.current.bootPhase !== 'ready') pendingOpenRef.current = target
      else void applyOpen(target)
    }
    sw.addEventListener('message', onMessage)
    return () => sw.removeEventListener('message', onMessage)
  }, [applyOpen])
  useEffect(() => {
    if (bootPhase !== 'ready' || !pendingOpenRef.current) return
    const pending = pendingOpenRef.current
    pendingOpenRef.current = null
    void applyOpen(pending)
  }, [bootPhase, applyOpen])

  if (!userId) return { settingsPush: undefined }

  const enabled = getPref('md.push', '') === userId
  const supported = isSupported()
  const input: PushSettingsInput = {
    supported,
    ios: isIosLike(navigator.userAgent, navigator.maxTouchPoints),
    standalone: isStandalone(),
    permission: readPermission(),
    online: account.state === 'in' && online,
    enabled,
    key: key.kind,
    busy,
  }
  const view = pushSettingsView(input)

  async function onShown() {
    setTick((n) => n + 1)
    const current = pushSettingsView({ ...input, permission: readPermission(), enabled: getPref('md.push', '') === userId })
    const k = keyRef.current.kind
    if (current.kind !== 'off' || busyRef.current !== null || (k !== 'unknown' && k !== 'error')) return
    const next = await fetchPushKey((i, init) => fetch(i, init))
    remember(next)
  }

  async function onToggle() {
    if (view.locked || view.disabled || !userId) return
    const { showNotice } = optionsRef.current
    const deps = browserDeps()
    if (!enabled) {
      changeBusy('on')
      const { result, key: latest } = await turnOnPush(deps, userId, keyRef.current)
      remember(latest)
      if (result === 'permission-refused') showNotice({ type: 'info', message: '알림 권한을 받지 못해 켜지 않았습니다.' })
      else if (result === 'unsupported-service') showNotice({ type: 'error', message: '이 브라우저의 푸시 서비스는 지원하지 않습니다.' })
      else if (result === 'failed') showNotice({ type: 'error', message: '푸시를 켜지 못했습니다. 잠시 뒤 다시 시도하세요.' })
    } else {
      changeBusy('off')
      const result = await turnOffPush(deps)
      if (result === 'failed') showNotice({ type: 'error', message: '푸시를 끄지 못했습니다. 연결을 확인한 뒤 다시 시도하세요.' })
    }
    changeBusy(null)
  }

  async function onTest() {
    if (view.testLocked || view.testDisabled) return
    const { showNotice } = optionsRef.current
    changeBusy('test')
    const result = await sendTestPush(browserDeps())
    if (result === 'sent') showNotice({ type: 'info', message: '테스트 알림을 보냈습니다. 몇 초 안에 오지 않으면 기기의 알림 설정을 확인하세요.' })
    else showNotice({ type: 'error', message: '테스트 알림을 보내지 못했습니다.' })
    changeBusy(null)
  }

  return { settingsPush: { view, onShown: () => void onShown(), onToggle: () => void onToggle(), onTest: () => void onTest() } }
}
