// 탭 간 동기화 순수 함수 — 메시지 타입·저장소 감싸기·편집권 (specs/features/F-296.md 6장). DOM 은 useTabSync.ts 가 다룬다
import type { Store } from '../types'

// 채널 이름·클레임 대기 시간·탭 id 생성은 src/lib/tabChannel.ts 로 옮겨졌다 — storage 쪽(F-297 lockSession.ts)도 써야 해서다 (specs/features/F-297.md 5.1)
export { TAB_CHANNEL_NAME, CLAIM_WAIT_MS, newTabId } from '../lib/tabChannel'
export const RESYNC_DEBOUNCE_MS = 250
export const CLAIM_RETRY_MS = 15_000 // useDocLock.ts RETRY_INTERVAL_MS 와 같은 값

export type TabMessage =
  | { kind: 'docs-changed'; tabId: string }
  | { kind: 'claim-query'; tabId: string; docId: string }
  | { kind: 'claim-hold'; tabId: string; docId: string; since: number }
  | { kind: 'claim-release'; tabId: string; docId: string }

function wrap<A extends unknown[], R>(fn: (...args: A) => Promise<R>, notify: () => void): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const result = await fn(...args)
    notify()
    return result
  }
}

// 쓰기 메서드가 성공(resolve)한 뒤에만 "바뀌었다" 신호를 보낸다 (6.2). 읽기·첨부·kind 등은 그대로 통과한다
export function withTabBroadcast(store: Store, post: (m: TabMessage) => void, tabId: string): Store {
  const notify = () => post({ kind: 'docs-changed', tabId })
  return {
    ...store,
    create: wrap(store.create, notify),
    update: wrap(store.update, notify),
    remove: wrap(store.remove, notify),
    moveDoc: wrap(store.moveDoc, notify),
    setPinned: wrap(store.setPinned, notify),
    createFolder: wrap(store.createFolder, notify),
    renameFolder: wrap(store.renameFolder, notify),
    moveFolder: wrap(store.moveFolder, notify),
    removeFolder: wrap(store.removeFolder, notify),
  }
}

// 둘 다 열려 있을 때 한 쪽만 이긴다 — 먼저 연 쪽(since 이른 쪽), 같으면 tabId 사전순 (6.4)
export function claimWins(a: { since: number; tabId: string }, b: { since: number; tabId: string }): boolean {
  return a.since < b.since || (a.since === b.since && a.tabId < b.tabId)
}

export type ClaimState = { tabId: string; docId: string; since: number; held: boolean }

export type ClaimEffect =
  | { type: 'reply'; message: TabMessage }
  | { type: 'yielded' }
  | { type: 'retake' }
  | null

// 편집권 메시지 하나를 내 상태에 비추어 판정한다 — 채널·타이머는 useTabSync.ts 가 다룬다 (6.4)
export function reduceClaim(state: ClaimState, message: TabMessage): ClaimEffect {
  if (message.tabId === state.tabId) return null // 자기 자신이 보낸 메시지는 전부 무시한다 (6.1)
  if (message.kind === 'docs-changed') return null
  if (message.docId !== state.docId) return null // 다른 문서의 메시지는 무시한다

  if (message.kind === 'claim-query') {
    if (!state.held) return null
    return { type: 'reply', message: { kind: 'claim-hold', tabId: state.tabId, docId: state.docId, since: state.since } }
  }

  if (message.kind === 'claim-hold') {
    if (!state.held) return null
    const otherWins = claimWins({ since: message.since, tabId: message.tabId }, { since: state.since, tabId: state.tabId })
    return otherWins ? { type: 'yielded' } : null
  }

  // claim-release
  if (state.held) return null
  return { type: 'retake' }
}
