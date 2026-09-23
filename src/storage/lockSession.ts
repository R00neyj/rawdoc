// 편집 잠금 세션 id 보관·회전 — 탭 복제로 sessionStorage 가 복사되면 겹친 id 를 부팅 때 회전시킨다 (specs/features/F-297.md 5장)
import { CLAIM_WAIT_MS, TAB_CHANNEL_NAME, newTabId } from '../lib/tabChannel'

const LOCK_SESSION_STORAGE_KEY = 'md.lockSession'

export type LockSessionMessage =
  | { kind: 'session-query'; tabId: string; sessionId: string } // 이 id 를 내가 쓴다. 쓰는 탭 있나
  | { kind: 'session-hold'; tabId: string; sessionId: string } // 내가 쓰고 있다

export type LockSessionAction = { type: 'none' } | { type: 'reply-hold' } | { type: 'rotate' }

// 순수 — DOM·채널·타이머를 모른다
export function reduceLockSessionMessage(
  state: { tabId: string; sessionId: string; waiting: boolean },
  msg: unknown,
): LockSessionAction {
  if (!msg || typeof msg !== 'object') return { type: 'none' }
  const m = msg as { kind?: unknown; tabId?: unknown; sessionId?: unknown }
  if (m.kind !== 'session-query' && m.kind !== 'session-hold') return { type: 'none' } // F-296 메시지가 같은 채널로 들어온다
  if (m.tabId === state.tabId) return { type: 'none' } // 자기 무시 — F-296 6.1 과 같은 규칙
  if (m.sessionId !== state.sessionId) return { type: 'none' }
  if (m.kind === 'session-query') return { type: 'reply-hold' } // waiting 여부와 상관없이 답한다
  return state.waiting ? { type: 'rotate' } : { type: 'none' } // session-hold — 정착한 탭은 남의 답에 흔들리지 않는다
}

// 구동부 — 채널·타이머를 주입받는다. node 에서도 돈다
export function startLockSessionGuard(deps: {
  tabId: string
  post: (m: LockSessionMessage) => void
  wait: (ms: number, fn: () => void) => void
  read: () => string | null
  write: (v: string) => void
}): { handle: (msg: unknown) => void; ready: Promise<void>; settled: () => boolean; current: () => string } {
  const { tabId, post, wait, read, write } = deps
  const existing = read()
  let sessionId = existing ?? newTabId()
  let waiting = false
  let settledFlag = true
  let resolveReady: () => void = () => {}
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  function settle() {
    waiting = false
    settledFlag = true
    resolveReady()
  }

  if (existing) {
    waiting = true
    settledFlag = false
    post({ kind: 'session-query', tabId, sessionId })
    wait(CLAIM_WAIT_MS, () => {
      if (waiting) settle()
    })
  } else {
    write(sessionId) // 새로 만든 id 는 복제될 수 없으므로 질의를 보내지 않는다 (4.2)
  }

  function handle(msg: unknown) {
    const action = reduceLockSessionMessage({ tabId, sessionId, waiting }, msg)
    if (action.type === 'reply-hold') {
      post({ kind: 'session-hold', tabId, sessionId })
    } else if (action.type === 'rotate') {
      sessionId = newTabId()
      write(sessionId)
      settle()
    }
  }

  return {
    handle,
    ready: readyPromise,
    settled: () => settledFlag,
    current: () => sessionId,
  }
}

// ----- 모듈 배선 (5.4) -----

function resolveInitialSessionId(): string {
  try {
    const existing = globalThis.sessionStorage?.getItem(LOCK_SESSION_STORAGE_KEY)
    if (existing) return existing
    const created = newTabId()
    globalThis.sessionStorage?.setItem(LOCK_SESSION_STORAGE_KEY, created)
    return created
  } catch {
    return newTabId() // 사생활 보호 모드 등으로 접근이 막히면 메모리 값으로 간다 (4.4)
  }
}

function readStoredSessionId(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(LOCK_SESSION_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

function writeStoredSessionId(v: string): void {
  try {
    globalThis.sessionStorage?.setItem(LOCK_SESSION_STORAGE_KEY, v)
  } catch {
    // 못 써도 이번 탭 수명 동안은 메모리 값으로 맞게 동작한다 (4.4)
  }
}

const hasChannel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'

// 테스트 환경(node, BroadcastChannel 없음)은 채널을 만들지 않고 settled=true 로 시작한다
const guard = hasChannel
  ? (() => {
      const channel = new BroadcastChannel(TAB_CHANNEL_NAME) // 닫지 않는다 — 탭이 죽을 때 같이 사라진다 (5.4)
      const g = startLockSessionGuard({
        tabId: newTabId(),
        post: (m) => channel.postMessage(m),
        wait: (ms, fn) => setTimeout(fn, ms),
        read: readStoredSessionId,
        write: writeStoredSessionId,
      })
      channel.addEventListener('message', (e: MessageEvent) => g.handle(e.data))
      return g
    })()
  : null

const fallbackSessionId = guard ? null : resolveInitialSessionId()

export function getLockSessionId(): string {
  return guard ? guard.current() : (fallbackSessionId as string)
}

export function isLockSessionSettled(): boolean {
  return guard ? guard.settled() : true
}

export function lockSessionReady(): Promise<void> {
  return guard ? guard.ready : Promise.resolve()
}
