// 최근 연 컴퓨터 파일 — 불러오기·열림 구독·다시 열기·빼기 (specs/features/F-2158.md 3장)
import { useCallback, useEffect, useRef, useState } from 'react'
import { ensureWritePermission, localFileSupported } from '../../lib/fileSystemAccess'
import type { RecentFileItem, RecentFileRow } from '../../lib/recentFiles'
import { createRecentFilesStore, type RecentFilesStore } from '../../storage/recentFilesStore'
import type { NoticeWithAction } from '../NoticeBar'
import type { UseLocalFileResult } from './useLocalFile'

export type UseRecentFilesResult = { files: readonly RecentFileItem[]; open(id: string): Promise<void>; remove(id: string): Promise<void> }

export function useRecentFiles(o: { localFile: UseLocalFileResult; showNotice: (n: NoticeWithAction) => number }): UseRecentFilesResult {
  const supported = localFileSupported()
  const [files, setFiles] = useState<readonly RecentFileItem[]>([])
  const storeRef = useRef<RecentFilesStore | null>(null)
  const handlesRef = useRef(new Map<string, FileSystemFileHandle>())
  const oRef = useRef(o)
  useEffect(() => {
    oRef.current = o
  })

  const apply = useCallback((rows: readonly RecentFileRow[]) => {
    handlesRef.current = new Map(rows.map((r) => [r.id, r.handle]))
    setFiles(rows.map((r) => ({ id: r.id, name: r.name, openedAt: r.openedAt })))
  }, [])

  const getStore = useCallback(() => (storeRef.current ??= createRecentFilesStore()), [])

  useEffect(() => {
    if (!supported) return
    let alive = true
    const load = () => {
      getStore().list().then((rows) => { if (alive) apply(rows) }, () => {})
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      alive = false
      window.removeEventListener('focus', load)
    }
  }, [supported, apply, getStore])

  const { subscribeOpened } = o.localFile
  useEffect(() => {
    if (!supported) return
    return subscribeOpened((session) => {
      getStore().add(session.handle, session.name, Date.now()).then(apply, () => {})
    })
  }, [supported, subscribeOpened, apply, getStore])

  const remove = useCallback(async (id: string) => {
    try {
      apply(await getStore().remove(id))
    } catch {
      // IndexedDB 를 못 쓰면 목록은 그대로 둔다
    }
  }, [apply, getStore])

  const open = useCallback(async (id: string) => {
    const handle = handlesRef.current.get(id)
    if (!handle) return
    await ensureWritePermission(handle, { gesture: true })
    const result = await oRef.current.localFile.openLocalFile(handle, { gesture: true })
    if (result === 'missing') {
      await remove(id)
      oRef.current.showNotice({ type: 'info', message: `"${handle.name}" 을(를) 찾을 수 없어 목록에서 뺐습니다.` })
    }
  }, [remove])

  return { files: supported ? files : [], open, remove }
}
