// 개발 빌드 전용 두 탭 연결 — BroadcastChannel 로 같은 문서를 연 탭끼리 Yjs 업데이트를 주고받는다 (specs/features/F-303.md 9장). 운영 빌드에는 실리지 않는다
import type { YLinkPort, YProviderFactory } from '../editor/remoteGate'
import { DEV_YSYNC_NOGATE } from '../editor/devSyncFlag'
import { CLAIM_WAIT_MS, newTabId } from '../lib/tabChannel'
import { claimWins } from './tabSync'

export const DEV_LINK_CHANNEL = 'md-ydev'
export const DEV_LINK_LOG_FIRST = '[ysync] 연결됨 · 먼저 연 탭'
export const DEV_LINK_LOG_ADOPTED = '[ysync] 연결됨 · 다른 탭의 내용을 받음'
export const DEV_LINK_LOG_DOUBLED = '[ysync] 이 탭에서 먼저 편집해 본문이 두 벌이 될 수 있습니다'
export const DEV_LINK_LOG_NOGATE = '[ysync] 게이트 끔 (nogate)'

export type DevLinkMessage =
  | { kind: 'hello'; docId: string; linkId: string; openedAt: number; synced: boolean }
  | { kind: 'state'; docId: string; linkId: string; openedAt: number; to: string | null; update: Uint8Array }
  | { kind: 'update'; docId: string; linkId: string; update: Uint8Array }

type Rival = { linkId: string; openedAt: number }

export type DevLinkState = {
  docId: string
  linkId: string
  openedAt: number
  synced: boolean
  rivals: Rival[]
}

export type DevLinkEvent =
  | { type: 'connected' }
  | { type: 'timer' }
  | { type: 'message'; message: DevLinkMessage }
  | { type: 'local'; update: Uint8Array }

// postState 는 구동부가 그 순간의 encodeState() 를 실어 보낸다. adopt 는 구동부가 결과에 따라 콘솔을 찍는다
export type DevLinkAction =
  | { type: 'post'; message: DevLinkMessage }
  | { type: 'postState'; to: string | null }
  | { type: 'adopt'; update: Uint8Array }
  | { type: 'applyRemote'; update: Uint8Array }
  | { type: 'startTimer' }
  | { type: 'log'; level: 'info' | 'warn'; text: string }

export function initialDevLinkState({
  docId,
  linkId,
  openedAt,
}: {
  docId: string
  linkId: string
  openedAt: number
}): DevLinkState {
  return { docId, linkId, openedAt, synced: false, rivals: [] }
}

function hello(state: DevLinkState): DevLinkAction {
  return {
    type: 'post',
    message: { kind: 'hello', docId: state.docId, linkId: state.linkId, openedAt: state.openedAt, synced: state.synced },
  }
}

function beats(rival: Rival, me: DevLinkState): boolean {
  return claimWins({ since: rival.openedAt, tabId: rival.linkId }, { since: me.openedAt, tabId: me.linkId })
}

// 순수 함수 — BroadcastChannel·Yjs 를 모른다 (9.3)
export function reduceDevLink(state: DevLinkState, event: DevLinkEvent): { state: DevLinkState; actions: DevLinkAction[] } {
  if (event.type === 'connected') {
    const next = { ...state, synced: false }
    return { state: next, actions: [hello(next), { type: 'startTimer' }] }
  }

  if (event.type === 'timer') {
    if (state.synced) return { state, actions: [] }
    if (state.rivals.some((rival) => beats(rival, state))) {
      const next = { ...state, rivals: [] }
      return { state: next, actions: [hello(next), { type: 'startTimer' }] }
    }
    // 대기 중 적어 둔 늦은 탭에게 바로 답한다 — 그 탭의 다시 보낸 hello 가 내가 synced 되기 전에 왔을 수 있다
    const next = { ...state, synced: true, rivals: [] }
    const answers: DevLinkAction[] = state.rivals.map((rival) => ({ type: 'postState', to: rival.linkId }))
    return { state: next, actions: [{ type: 'log', level: 'info', text: DEV_LINK_LOG_FIRST }, ...answers] }
  }

  if (event.type === 'local') {
    if (!state.synced) return { state, actions: [] }
    return {
      state,
      actions: [{ type: 'post', message: { kind: 'update', docId: state.docId, linkId: state.linkId, update: event.update } }],
    }
  }

  const message = event.message
  if (message.docId !== state.docId || message.linkId === state.linkId) return { state, actions: [] }

  if (message.kind === 'hello') {
    if (state.synced) return { state, actions: [{ type: 'postState', to: message.linkId }] }
    const rivals = state.rivals.filter((rival) => rival.linkId !== message.linkId)
    rivals.push({ linkId: message.linkId, openedAt: message.openedAt })
    return { state: { ...state, rivals }, actions: [] }
  }

  if (message.kind === 'state') {
    if (state.synced) return { state, actions: [{ type: 'applyRemote', update: message.update }] }
    if (message.to !== null && message.to !== state.linkId) return { state, actions: [] }
    const next = { ...state, synced: true, rivals: [] }
    return { state: next, actions: [{ type: 'adopt', update: message.update }, { type: 'postState', to: null }, hello(next)] }
  }

  if (!state.synced) return { state, actions: [] }
  return { state, actions: [{ type: 'applyRemote', update: message.update }] }
}

// 연결 하나 = 채널 하나. destroy 에 닫는다 (9.2)
function connectDevLink(port: YLinkPort): { destroy(): void } {
  const channel = new BroadcastChannel(DEV_LINK_CHANNEL)
  let state = initialDevLinkState({ docId: port.docId, linkId: newTabId(), openedAt: Date.now() })
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  function perform(action: DevLinkAction) {
    if (action.type === 'post') channel.postMessage(action.message)
    else if (action.type === 'postState') {
      const message: DevLinkMessage = {
        kind: 'state',
        docId: state.docId,
        linkId: state.linkId,
        openedAt: state.openedAt,
        to: action.to,
        update: port.encodeState(),
      }
      channel.postMessage(message)
    } else if (action.type === 'adopt') {
      if (port.adopt(action.update)) console.info(DEV_LINK_LOG_ADOPTED)
      else console.warn(DEV_LINK_LOG_DOUBLED)
    } else if (action.type === 'applyRemote') port.applyRemote(action.update)
    else if (action.type === 'startTimer') {
      clearTimeout(timer)
      timer = setTimeout(() => run({ type: 'timer' }), CLAIM_WAIT_MS)
    } else if (action.level === 'warn') console.warn(action.text)
    else console.info(action.text)
  }

  function run(event: DevLinkEvent) {
    if (closed) return
    const result = reduceDevLink(state, event)
    state = result.state
    result.actions.forEach(perform)
  }

  channel.onmessage = (event: MessageEvent<DevLinkMessage>) => run({ type: 'message', message: event.data })
  const unsubscribe = port.onLocalUpdate((update) => run({ type: 'local', update }))
  if (DEV_YSYNC_NOGATE) console.info(DEV_LINK_LOG_NOGATE)
  run({ type: 'connected' })

  return {
    destroy() {
      if (closed) return
      closed = true
      clearTimeout(timer)
      unsubscribe()
      channel.close()
    },
  }
}

export function installDevLink(): void {
  const factory: YProviderFactory = connectDevLink
  window.__yProviderFactory = factory
}
