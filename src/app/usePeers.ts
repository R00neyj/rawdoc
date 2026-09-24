// awareness 를 듣고 접속자 목록을 돌려주는 훅 — 목록이 값으로 같으면 다시 그리지 않는다 (specs/features/F-307.md 7.4)
import { useSyncExternalStore } from 'react'
import type { Awareness } from 'y-protocols/awareness'

import { nextPeerList } from '../lib/peers'
import type { Peer } from '../lib/peers'

const NO_PEERS: Peer[] = []

type PeerStore = { subscribe(listener: () => void): () => void; get(): Peer[] }

const stores = new WeakMap<Awareness, PeerStore>()

// awareness 하나에 저장소 하나 — 편집기 다시 마운트·App 다시 그리기에도 목록과 순서가 이어진다
function storeOf(awareness: Awareness): PeerStore {
  const existing = stores.get(awareness)
  if (existing) return existing
  let peers = nextPeerList(NO_PEERS, awareness.getStates(), awareness.clientID)
  const listeners = new Set<() => void>()
  const onChange = () => {
    const next = nextPeerList(peers, awareness.getStates(), awareness.clientID)
    if (next === peers) return
    peers = next
    listeners.forEach((listener) => listener())
  }
  const store: PeerStore = {
    subscribe(listener) {
      if (listeners.size === 0) awareness.on('change', onChange)
      listeners.add(listener)
      onChange()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) awareness.off('change', onChange)
      }
    },
    get: () => peers,
  }
  stores.set(awareness, store)
  return store
}

const noopSubscribe = () => () => {}
const getNoPeers = () => NO_PEERS

export function usePeers(awareness: Awareness | null): Peer[] {
  const store = awareness ? storeOf(awareness) : null
  const subscribe = store ? store.subscribe : noopSubscribe
  const get = store ? store.get : getNoPeers
  return useSyncExternalStore(subscribe, get, get)
}
