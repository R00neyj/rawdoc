// 로그인 전 금고 이관, 금고 잠그기·초기화 단계 — App.tsx 에서 옮김 (F-2073, F-2059)
import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { createIdbStore, markLocalE2eeMigrated, readE2eeRow } from '../storage/idbStore'
import type { ServerStore } from '../storage/serverStore'
import { checkLocalE2eeMigration, runLocalE2eeMigration } from './migrateLocal'
import type { LocalE2eeKeys } from '../e2ee/convert'
import { lockDocMetas, planE2eeReset, type E2eeStore } from '../e2ee/e2eeStore'
import type { Folder, Store } from '../types'
import type { AccountState } from './account'
import type { DocMeta, OpenDoc } from './docMeta'
import type { NoticeWithAction } from './NoticeBar'
import type { UseE2ee } from './useE2ee'

export type UseE2eeMigrateOptions = {
  store: Store
  bootPhase: 'booting' | 'ready'
  account: AccountState
  e2ee: UseE2ee | null
  currentDocId: string | null
  showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
  dismissNotice: (id: number) => void
  resyncFromStore: () => Promise<void>
  setDocs: Dispatch<SetStateAction<DocMeta[]>>
  setOpenDoc: Dispatch<SetStateAction<OpenDoc | null>>
  setViewerHtml: Dispatch<SetStateAction<string>>
  setCurrentDocId: Dispatch<SetStateAction<string | null>>
  replaceHashUrl: (docId: string | null) => void
  e2eeRef: RefObject<UseE2ee | null>
  docsRef: RefObject<DocMeta[]>
  foldersRef: RefObject<Folder[]>
  currentDocIdRef: RefObject<string | null>
  docSaverFlushRef: RefObject<() => Promise<boolean>>
  titleSavingRef: RefObject<Promise<unknown> | null>
  e2eeStoreRef: RefObject<E2eeStore | null>
  e2eeResetStepRef: RefObject<() => Promise<void>>
}

export type UseE2eeMigrateResult = {
  e2eeMigrateAsk: { count: number; bundle: string } | null
  e2eeMigrateDialogOpen: boolean
  setE2eeMigrateDialogOpen: Dispatch<SetStateAction<boolean>>
  runE2eeMigrateFlow: (keys: LocalE2eeKeys, bundle: string) => Promise<void>
  e2eeUnmountedDocId: string | null
  runE2eeReset: () => Promise<void>
}

export function useE2eeMigrate(options: UseE2eeMigrateOptions): UseE2eeMigrateResult {
  const {
    store, bootPhase, account, e2ee, currentDocId, showNotice, dismissNotice, resyncFromStore, setDocs, setOpenDoc, setViewerHtml, setCurrentDocId,
    replaceHashUrl, e2eeRef, docsRef, foldersRef, currentDocIdRef, docSaverFlushRef, titleSavingRef, e2eeStoreRef, e2eeResetStepRef,
  } = options
  // 로그인 전 금고 이관 (F-408) — 판정은 페이지마다 한 번
  const e2eeMigrateCheckedRef = useRef(false)
  const [e2eeMigrateAsk, setE2eeMigrateAsk] = useState<{ count: number; bundle: string } | null>(null)
  const [e2eeMigrateDialogOpen, setE2eeMigrateDialogOpen] = useState(false)
  const e2eeMigrateNoticeIdRef = useRef<number | null>(null)
  const e2eeMigrateRunningRef = useRef(false)

  // 로그인 전 금고 이관(F-408) — 부팅이 끝나고 계정이 in 이고 막히지 않았을 때 페이지마다 한 번 판정한다 (4.1)
  useEffect(() => {
    if (bootPhase !== 'ready' || !e2ee || store.kind !== 'server' || account.state !== 'in' || account.blocked) return
    if (e2eeMigrateCheckedRef.current) return
    e2eeMigrateCheckedRef.current = true
    const userId = (store as ServerStore).userId
    void checkLocalE2eeMigration({
      userId,
      localDbExists: async () => {
        if (typeof indexedDB === 'undefined' || !indexedDB.databases) return true
        const dbs = await indexedDB.databases()
        return dbs.some((d) => d.name === 'md-docs')
      },
      readLocalRow: () => readE2eeRow('local'),
      readLocal: async () => {
        const local = await createIdbStore()
        const [localFolders, localDocs] = await Promise.all([local.listFolders(), local.list()])
        return { folders: localFolders, docs: localDocs }
      },
      accountIds: () => ({
        docIds: new Set(docsRef.current.map((d) => d.id)),
        folderIds: new Set(foldersRef.current.map((f) => f.id)),
      }),
      markMigrated: (bundle) => markLocalE2eeMigrated(userId, bundle),
    })
      .then((result) => {
        if (result.kind !== 'ask') return
        setE2eeMigrateAsk({ count: result.count, bundle: result.bundle })
        let noticeId = 0
        noticeId = showNotice(
          {
            type: 'info',
            message: `이 브라우저에 로그인 전 금고 문서 ${result.count.toLocaleString('ko-KR')}개가 있습니다. 금고 암호를 입력하면 계정 금고로 옮깁니다.`,
            action: {
              label: '옮기기',
              onClick: () => {
                dismissNotice(noticeId)
                setE2eeMigrateDialogOpen(true)
              },
            },
            secondaryAction: { label: '나중에', onClick: () => dismissNotice(noticeId) },
          },
          { sticky: true },
        )
        e2eeMigrateNoticeIdRef.current = noticeId
      })
      .catch((err) => console.error('e2ee_migrate_check_failed', err))
  }, [bootPhase, e2ee, store, account, showNotice, dismissNotice, docsRef, foldersRef])

  // 실행 — D-14 가 키를 얻으면 부른다 (4.4·4.5)
  async function runE2eeMigrateFlow(keys: LocalE2eeKeys, bundle: string) {
    if (e2eeMigrateRunningRef.current) return
    e2eeMigrateRunningRef.current = true
    setE2eeMigrateDialogOpen(false)
    const ring = e2eeRef.current
    const userId = (store as ServerStore).userId
    let progressId: number | null = null
    const onProgress = (done: number, total: number) => {
      if (progressId !== null) dismissNotice(progressId)
      progressId = showNotice(
        { type: 'info', message: `로그인 전 금고 문서를 계정 금고로 옮기는 중… ${done.toLocaleString('ko-KR')}/${total.toLocaleString('ko-KR')}` },
        { sticky: true },
      )
    }
    onProgress(0, e2eeMigrateAsk?.count ?? 0)
    let outcome: Awaited<ReturnType<typeof runLocalE2eeMigration>>
    try {
      outcome = await runLocalE2eeMigration({
        userId,
        localDbExists: async () => {
          if (typeof indexedDB === 'undefined' || !indexedDB.databases) return true
          const dbs = await indexedDB.databases()
          return dbs.some((d) => d.name === 'md-docs')
        },
        readLocalRow: () => readE2eeRow('local'),
        readLocal: async () => {
          const local = await createIdbStore()
          const [localFolders, localDocs] = await Promise.all([local.listFolders(), local.list()])
          return { folders: localFolders, docs: localDocs }
        },
        accountIds: () => ({
          docIds: new Set(docsRef.current.map((d) => d.id)),
          folderIds: new Set(foldersRef.current.map((f) => f.id)),
        }),
        markMigrated: (b) => markLocalE2eeMigrated(userId, b),
        bundle,
        keys,
        getLocalAttachment: async (id) => {
          const local = await createIdbStore()
          return local.getAttachment(id)
        },
        importLocalE2ee: (input) => (store as ServerStore).importLocalE2ee(input),
        keyAlive: () => (keys.mode === 'adopt' ? true : (ring?.keyring.getMasterKey() ?? null) !== null),
        noteActivity: () => ring?.keyring.noteActivity(),
        onProgress,
      })
    } finally {
      if (progressId !== null) dismissNotice(progressId)
      e2eeMigrateRunningRef.current = false
    }

    if (outcome.kind === 'done') {
      showNotice({ type: 'info', message: `로그인 전 금고 문서 ${outcome.count.toLocaleString('ko-KR')}개를 계정 금고에 넣었습니다. 서버로 보내는 중입니다.` })
      if (outcome.skippedImages > 0) {
        showNotice({ type: 'warn', message: `암호화할 수 없는 이미지 ${outcome.skippedImages.toLocaleString('ko-KR')}개는 옮기지 않았습니다.` })
      }
      await resyncFromStore()
      return
    }
    if (outcome.reason === 'locked') {
      showNotice({
        type: 'warn',
        message: `금고가 잠겨 로그인 전 금고 문서 ${outcome.done.toLocaleString('ko-KR')}/${outcome.total.toLocaleString('ko-KR')}개를 옮기고 멈췄습니다. 다시 누르면 남은 것부터 옮깁니다.`,
        action: { label: '옮기기', onClick: () => setE2eeMigrateDialogOpen(true) },
      })
      return
    }
    showNotice({ type: 'error', message: '로그인 전 금고 문서를 옮기지 못했습니다. 다시 시도하려면 새로고침하세요.' })
  }

  // 잠겨서 P1 이 뜬 문서 — 초점을 옮기지 않는다. 다른 문서로 가면 되돌린다 (F-405 6.2)
  const [e2eeUnmountedDocId, setE2eeUnmountedDocId] = useState<string | null>(null)
  const [e2eeUnmountTrackedDocId, setE2eeUnmountTrackedDocId] = useState(currentDocId)
  if (e2eeUnmountTrackedDocId !== currentDocId) {
    setE2eeUnmountTrackedDocId(currentDocId)
    setE2eeUnmountedDocId(null)
  }
  // 잠그기·초기화 단계 (F-405 2.2 표, 7.2)
  const e2eeKeyring = e2ee?.keyring ?? null
  useEffect(() => {
    if (!e2eeKeyring) return undefined
    const currentE2eeMeta = () => {
      const id = currentDocIdRef.current
      return id ? docsRef.current.find((d) => d.id === id) : undefined
    }
    const unFlush = e2eeKeyring.registerLockStep('flush', async () => {
      if (currentE2eeMeta()?.e2ee !== 'open') return
      const saved = await docSaverFlushRef.current()
      const titleSaving = titleSavingRef.current
      if (titleSaving) await titleSaving
      if (!saved) throw new Error('e2ee_flush_failed')
    })
    const unUnmount = e2eeKeyring.registerLockStep('unmount', () => {
      const meta = currentE2eeMeta()
      if (meta?.e2ee === 'open') {
        setE2eeUnmountedDocId(meta.id)
        setOpenDoc(null)
        setViewerHtml('')
      }
      setDocs((prev) => lockDocMetas(prev))
    })
    const unIndexes = e2eeKeyring.registerLockStep('indexes', () => e2eeStoreRef.current?.clearPlainCache())
    const unReset = e2eeKeyring.registerResetStep(() => e2eeResetStepRef.current())
    return () => {
      unFlush()
      unUnmount()
      unIndexes()
      unReset()
    }
  }, [e2eeKeyring, currentDocIdRef, docsRef, docSaverFlushRef, titleSavingRef, setOpenDoc, setViewerHtml, setDocs, e2eeStoreRef, e2eeResetStepRef])

  // 금고 초기화 단계 — 금고 문서·폴더를 지우고 서버에 닿기를 기다린다. 실패는 던진다 (F-405 7.9)
  async function runE2eeReset() {
    const [list, folderList] = await Promise.all([store.list(), store.listFolders()])
    const plan = planE2eeReset({ docs: list, folders: folderList })
    const openId = currentDocIdRef.current
    if (openId && list.some((d) => d.id === openId && d.e2ee)) {
      currentDocIdRef.current = null
      setCurrentDocId(null)
      replaceHashUrl(null)
    }
    for (const id of plan.folderIds) await store.removeFolder(id, 'delete-all')
    for (const id of plan.docIds) await store.remove(id)
    await (e2eeStoreRef.current as Partial<ServerStore> | null)?.flushOutbox?.()
    await resyncFromStore()
  }

  return { e2eeMigrateAsk, e2eeMigrateDialogOpen, setE2eeMigrateDialogOpen, runE2eeMigrateFlow, e2eeUnmountedDocId, runE2eeReset }
}
