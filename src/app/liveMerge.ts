// 병합 알림 판정 — 끊긴 동안 내 편집과 서버 쪽 본문 변경이 둘 다 있었나 (specs/features/F-306.md 7장, F-301 3.7)
import type * as Y from 'yjs'

import { Y_CONTENT_NAME } from '../lib/docRoomProtocol'

export type MergeTracker = {
  setLive(live: boolean): boolean
  unsyncedLocal(): boolean
  destroy(): void
}

export type MergeTrackerOptions = {
  initialUnsynced: boolean
  isLocalOrigin: (origin: unknown) => boolean
  isLoadOrigin: (origin: unknown) => boolean
  onUnsyncedChange: (value: boolean) => void
}

export function createMergeTracker(doc: Y.Doc, options: MergeTrackerOptions): MergeTracker {
  const content = doc.getText(Y_CONTENT_NAME)
  let live = false
  let unsynced = options.initialUnsynced
  let remoteChanged = false

  function setUnsynced(value: boolean) {
    if (unsynced === value) return
    unsynced = value
    options.onUnsyncedChange(value)
  }

  // 본문·제목 모두 — live 인 동안의 내 편집은 그 자리에서 서버로 간다 (7.2)
  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (!live && options.isLocalOrigin(origin)) setUnsynced(true)
  }

  // 제목만 바뀐 것은 세지 않는다 — content Y.Text 만 본다
  const onContent = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
    if (live || options.isLocalOrigin(transaction.origin) || options.isLoadOrigin(transaction.origin)) return
    remoteChanged = true
  }

  doc.on('update', onUpdate)
  content.observe(onContent)

  return {
    setLive(next) {
      live = next
      if (!next) return false
      const merged = unsynced && remoteChanged
      remoteChanged = false
      setUnsynced(false)
      return merged
    },
    unsyncedLocal: () => unsynced,
    destroy() {
      doc.off('update', onUpdate)
      content.unobserve(onContent)
    },
  }
}
