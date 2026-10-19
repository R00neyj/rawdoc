// GitHub 연결·가져오기 화면의 상태·연결 캐시·돌아오기·진입점 props 조립 (specs/features/F-2128.md 2~6장, 당기기 F-2129)
import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { GithubLink, GithubLinkPut } from '../lib/githubContract'
import type { ServerStore } from '../storage/serverStore'
import type { Doc, Store } from '../types'
import type { AccountState } from './account'
import { deleteDocGithub, deleteGithubAccount, getDocGithub, getDocGithubRaw, postDocGithubImageSources, postGithubFile, putDocGithub, putDocGithubImage, type GithubResult } from './githubApi'
import { randomAttachmentId, runGithubImageImport } from './githubImages'
import type { GithubImagesHandle } from './useGithubImages'
import { uploadAttachment } from '../storage/attachmentsApi'
import { toWebp } from '../storage/toWebp'
import { runGithubImport } from './githubImport'
import {
  decideGithubResume, githubConnectErrorMessage, githubConnectUrl, githubDocRole, githubDocTitle, githubErrorMessage, githubTopBarKind, GITHUB_LINK_FRESH_MS,
  GITHUB_RESUME_KEY, readGithubReturn, resumeMarker, urlWithoutGithubParams, type GithubFailure,
} from './githubUi'
import { linkPushFailedMessage, PUSH_OFFLINE_MESSAGE, readPushAttachment, type PushOutcome } from './githubPush'
import type { GithubDialogsProps, GithubPickerMode } from './GithubPickerDialog'
import type { GithubMenuProps } from './GithubMenu'
import { replaceAppEntry } from './historyEntries'
import { sortByUpdatedAtDesc, stripContent, type DocMeta } from './docMeta'
import type { NoticeWithAction } from './NoticeBar'
import type { PaletteContext } from './paletteContract'
import type { SettingsGithub } from './SettingsDialog'
import type { SidebarGithub } from './Sidebar'
import type { LiveStatus } from './StatusBar'
import { useGithubPull } from './useGithubPull'
import { useGithubPush } from './useGithubPush'
import { useGithubStatus } from './useGithubStatus'
import type { EditorHandle } from '../editor/Editor'

export type UseGithubFlowOptions = {
  account: AccountState
  bootPhase: 'booting' | 'ready'
  store: Store
  online: boolean
  showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
  docs: DocMeta[]
  currentDoc: DocMeta | null
  currentDocId: string | null
  setDocs: Dispatch<SetStateAction<DocMeta[]>>
  selectDoc: (id: string) => Promise<void>
  docSaverFlushRef: RefObject<() => Promise<boolean>>
  editorRef?: RefObject<EditorHandle | null>
  liveStatus?: LiveStatus | null
  githubImages?: Pick<GithubImagesHandle, 'setMap' | 'addImage'>
}
export type UseGithubFlowResult = {
  sidebar: SidebarGithub | undefined
  topBar: GithubMenuProps | undefined
  settings: SettingsGithub | undefined
  palette: PaletteContext['github']
  dialogs: GithubDialogsProps | undefined
}

type LinkEntry = { at: number; link: GithubLink | null }
const NO_FAILURE: GithubFailure = { status: 0, error: null, body: null }

export function useGithubFlow(o: UseGithubFlowOptions): UseGithubFlowResult {
  const { account, bootPhase, store, online, showNotice, docs, currentDoc, currentDocId, setDocs, selectDoc, docSaverFlushRef } = o
  const { status, on, refresh } = useGithubStatus({ account, bootPhase, storeKind: store.kind })
  const userId = account.state === 'in' ? account.id : null
  const [mode, setMode] = useState<GithubPickerMode | null>(null)
  const [unlinkDocId, setUnlinkDocId] = useState<string | null>(null)
  const [unlinkError, setUnlinkError] = useState<string | null>(null)
  const [links, setLinks] = useState<Record<string, LinkEntry>>({})
  const linksRef = useRef(links)
  const docsRef = useRef(docs)
  const returnRef = useRef<{ connected: boolean } | null>(null)

  const imagesRef = useRef(o.githubImages)
  useEffect(() => {
    linksRef.current = links
    docsRef.current = docs
    imagesRef.current = o.githubImages
  })

  const setImageMap = o.githubImages?.setMap
  const putCache = useCallback(
    (docId: string, link: GithubLink | null) => {
      setLinks((prev) => ({ ...prev, [docId]: { at: Date.now(), link } }))
      setImageMap?.(docId, link ? { path: link.path, images: link.images ?? {} } : null)
    },
    [setImageMap],
  )

  const watch = useCallback(
    <T,>(r: GithubResult<T>): GithubResult<T> => {
      if (!r.ok && (r.error === 'github_disabled' || r.error === 'github_reconnect')) void refresh()
      return r
    },
    [refresh],
  )

  // 저장소 그림 받아 넣기 — 같은 문서가 돌고 있으면 끝난 뒤 마지막 본문으로 한 번만 더, 계정이 바뀌면 멈춘다 (F-2131 5.1)
  const importsRef = useRef(new Map<string, { next: { content: string; mdPath: string } | null }>())
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    const ctl = new AbortController()
    abortRef.current = ctl
    return () => ctl.abort()
  }, [userId])
  const importImages = useCallback(
    (docId: string, input: { content: string; mdPath: string }) => {
      const running = importsRef.current.get(docId)
      if (running) {
        running.next = input
        return
      }
      const signal = abortRef.current?.signal
      if (!signal || signal.aborted) return
      const slot: { next: { content: string; mdPath: string } | null } = { next: null }
      importsRef.current.set(docId, slot)
      void (async () => {
        try {
          let cur: typeof input | null = input
          while (cur && !signal.aborted) {
            await runGithubImageImport(cur, {
              imageSources: async (paths) => watch(await postDocGithubImageSources(docId, { paths })),
              raw: async (path) => watch(await getDocGithubRaw(docId, path)),
              putImage: async (body) => watch(await putDocGithubImage(docId, body)),
              toWebp,
              upload: (id, ext, blob) => uploadAttachment(id, ext, blob),
              newId: randomAttachmentId,
              onMapped: (path, attachment) => imagesRef.current?.addImage(docId, path, attachment),
              signal,
            })
            cur = slot.next
            slot.next = null
          }
        } catch {
          // 실패는 알리지 않는다 — 그림은 프록시로 남고 다음 당기기가 다시 시도한다 (5.2)
        } finally {
          importsRef.current.delete(docId)
        }
      })()
    },
    [watch],
  )

  const server = store as Partial<ServerStore>
  const noEditorRef = useRef<EditorHandle | null>(null)
  const pull = useGithubPull({
    editorRef: o.editorRef ?? noEditorRef,
    liveStatus: o.liveStatus ?? null,
    currentDocId,
    lineEnding: currentDoc?.lineEnding ?? 'crlf',
    blocked: mode !== null || unlinkDocId !== null,
    showNotice,
    watch,
    linkOf: (docId) => linksRef.current[docId]?.link ?? null,
    onSynced: (docId, sha, bom) => {
      setLinks((prev) => {
        const link = prev[docId]?.link
        if (!link) return prev
        const now = Date.now()
        return { ...prev, [docId]: { at: now, link: { ...link, remoteSha: sha, remoteBom: bom, syncedAt: now } } }
      })
      const mdPath = linksRef.current[docId]?.link?.path
      const owner = githubDocRole(docsRef.current.find((d) => d.id === docId) ?? null) === 'owner'
      const content = docId === currentDocId && owner ? o.editorRef?.current?.getText('lf') : undefined
      if (mdPath && content !== undefined) importImages(docId, { content, mdPath })
    },
    selectDoc,
  })

  const push = useGithubPush({
    editorRef: o.editorRef ?? noEditorRef,
    liveStatus: o.liveStatus ?? null,
    currentDocId,
    lineEnding: currentDoc?.lineEnding ?? 'crlf',
    blocked: mode !== null || unlinkDocId !== null || pull.state !== null,
    showNotice,
    watch,
    linkOf: (docId) => linksRef.current[docId]?.link ?? null,
    flush: async () => { try { await server.flushOutbox?.() } catch { /* 올리지 못한 그림은 push-plan 의 skipped 로 드러난다 */ } },
    readAttachment: (name) => readPushAttachment(store, name),
    onPushed: (docId, sha) =>
      setLinks((prev) => {
        const link = prev[docId]?.link
        if (!link) return prev
        const now = Date.now()
        return { ...prev, [docId]: { at: now, link: { ...link, remoteSha: sha, syncedAt: now } } }
      }),
    startPull: pull.startPull,
  })

  const role = githubDocRole(currentDoc)
  useEffect(() => {
    if (!on || !currentDocId || role === null) return
    const cached = linksRef.current[currentDocId]
    if (cached && Date.now() - cached.at < GITHUB_LINK_FRESH_MS) return
    let live = true
    void getDocGithub(currentDocId).then((r) => {
      if (!live) return
      if (r.ok) putCache(currentDocId, r.value)
      else if (r.status === 404) putCache(currentDocId, null)
      else watch(r)
    })
    return () => {
      live = false
    }
  }, [on, currentDocId, role, putCache, watch])

  const loadLink = useCallback(
    async (docId: string) => {
      const r = watch(await getDocGithub(docId))
      if (r.ok) putCache(docId, r.value)
      else if (r.status === 404) putCache(docId, null)
      return r
    },
    [putCache, watch],
  )

  async function importFile(file: { repo: string; branch: string; path: string; size: number }) {
    await runGithubImport(file, {
      postFile: async (p) => watch(await postGithubFile(p)),
      create: (input) => store.create(input),
      flushOutbox: async () => { await server.flushOutbox?.() },
      hasPendingChanges: async (id) => (await server.hasPendingChanges?.(id)) ?? false,
      putLink: async (id, put) => {
        const r = watch(await putDocGithub(id, put))
        if (r.ok) putCache(id, r.value)
        return r
      },
      remove: (id) => store.remove(id),
      open: (id, created: Doc | null) => {
        if (created) setDocs((prev) => sortByUpdatedAtDesc([...prev, stripContent(created)]))
        if (created) importImages(id, { content: created.content, mdPath: file.path })
        void selectDoc(id)
      },
      notify: (n) => { showNotice(n) },
    })
  }

  async function putLink(docId: string, put: GithubLinkPut): Promise<GithubFailure | null> {
    try {
      await server.flushOutbox?.()
      if (await server.hasPendingChanges?.(docId)) return NO_FAILURE
    } catch {
      return NO_FAILURE
    }
    const r = watch(await putDocGithub(docId, put))
    if (!r.ok) return r
    putCache(docId, r.value)
    return null
  }

  function noticeFirstPush(outcome: PushOutcome | null) {
    if (outcome === null) showNotice({ type: 'error', message: linkPushFailedMessage({ kind: 'failed', message: PUSH_OFFLINE_MESSAGE }) })
    else if (outcome.kind !== 'pushed') showNotice({ type: 'error', message: linkPushFailedMessage(outcome) })
  }

  async function linkDoc(docId: string, put: GithubLinkPut, existed: boolean, pushMessage: string | null): Promise<GithubFailure | null> {
    const failure = await putLink(docId, put)
    if (failure) return failure
    if (pushMessage !== null) {
      noticeFirstPush(await push.pushCurrent(docId, pushMessage))
      return null
    }
    showNotice({
      type: 'info',
      message: existed ? 'GitHub 파일에 연결했습니다. 당기기로 내용을 맞춰 주세요' : `GitHub에 연결했습니다. 첫 푸시가 ${put.path} 파일을 만듭니다`,
    })
    if (existed) pull.requestPull(docId)
    return null
  }

  // 빈 새 문서를 만들어 연결하고 첫 커밋까지 — 연결이 안 되면 문서를 지운다 (small 2026-10-13)
  async function createLinked(put: GithubLinkPut, pushMessage: string): Promise<GithubFailure | null> {
    let doc: Doc
    try {
      doc = await store.create({ title: githubDocTitle(put.path), content: '', lineEnding: 'crlf', folderId: null })
    } catch {
      return NO_FAILURE
    }
    const failure = await putLink(doc.id, put)
    if (failure) {
      await store.remove(doc.id).catch(() => undefined)
      return failure
    }
    setDocs((prev) => sortByUpdatedAtDesc([...prev, stripContent(doc)]))
    noticeFirstPush(await push.send(doc.id, '', pushMessage, () => {}))
    void selectDoc(doc.id)
    return null
  }

  async function confirmUnlink() {
    if (unlinkDocId === null) return
    const r = watch(await deleteDocGithub(unlinkDocId))
    if (!r.ok) {
      setUnlinkError(githubErrorMessage(r))
      return
    }
    putCache(unlinkDocId, null)
    setUnlinkDocId(null)
    setUnlinkError(null)
    setMode(null)
    showNotice({ type: 'info', message: 'GitHub 연결을 해제했습니다' })
  }

  function connect(from: GithubPickerMode | null) {
    void (async () => {
      await docSaverFlushRef.current()
      if (from && userId) {
        try {
          sessionStorage.setItem(GITHUB_RESUME_KEY, resumeMarker(from.kind === 'link' ? { kind: 'link', docId: from.docId } : { kind: from.kind }, userId, Date.now()))
        } catch {
          // 표지를 못 써도 연결은 이어 간다 — 돌아와 대화상자만 다시 안 열린다
        }
      }
      location.assign(githubConnectUrl(location.hash))
    })()
  }

  async function disconnectAccount() {
    const r = watch(await deleteGithubAccount())
    if (!r.ok) {
      showNotice({ type: 'error', message: githubErrorMessage(r) })
      return
    }
    showNotice({ type: 'info', message: 'GitHub 연결을 해제했습니다' })
    void refresh()
  }

  useEffect(() => {
    const ret = readGithubReturn(location.search)
    if (!ret) return
    replaceAppEntry(urlWithoutGithubParams(location.pathname, location.search, location.hash))
    returnRef.current = { connected: ret.kind === 'connected' }
    showNotice(ret.kind === 'connected' ? { type: 'info', message: 'GitHub에 연결했습니다' } : { type: 'error', message: githubConnectErrorMessage(ret.code) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!returnRef.current || userId === null || bootPhase !== 'ready') return
    const pending = returnRef.current
    returnRef.current = null
    void (async () => {
      const next = await refresh()
      let raw: string | null = null
      try {
        raw = sessionStorage.getItem(GITHUB_RESUME_KEY)
        sessionStorage.removeItem(GITHUB_RESUME_KEY)
      } catch {
        raw = null
      }
      if (!pending.connected || !next?.enabled) return
      const resume = decideGithubResume(raw, userId, Date.now())
      if (resume?.kind === 'import' || resume?.kind === 'create') setMode({ kind: resume.kind })
      else if (resume?.kind === 'link') {
        const doc = docsRef.current.find((d) => d.id === resume.docId)
        if (doc) setMode({ kind: 'link', docId: doc.id, title: doc.title })
      }
    })()
  }, [userId, bootPhase, refresh])

  if (!on) return { sidebar: undefined, topBar: undefined, settings: undefined, palette: undefined, dialogs: undefined }

  const entry = currentDocId ? links[currentDocId] : undefined
  const link = entry?.link ?? null
  const barKind = githubTopBarKind(role, entry ? entry.link : undefined)
  const linkedDocIds = new Set(Object.keys(links).filter((id) => links[id].link !== null))
  const onPush = role === 'owner' && link && currentDocId ? () => void push.openPush(currentDocId) : undefined
  const onPull = role === 'owner' && link && currentDocId ? () => void pull.startPull(currentDocId) : undefined
  const onLinkCurrent = barKind === 'unlinked' && currentDoc ? () => setMode({ kind: 'link', docId: currentDoc.id, title: currentDoc.title }) : undefined
  return {
    sidebar: { onImport: () => setMode({ kind: 'import' }), onNewFile: () => setMode({ kind: 'create' }), onLinkDoc: (d) => setMode({ kind: 'link', docId: d.id, title: d.title }), linkedDocIds },
    topBar:
      role !== null && barKind !== null && currentDocId
        ? { role, link, onLink: onLinkCurrent, onUnlink: role === 'owner' && link ? () => { setUnlinkError(null); setUnlinkDocId(currentDocId) } : undefined, onPull, onPush }
        : undefined,
    settings: { status, online, onShown: () => void refresh(), onConnect: () => connect(null), onDisconnect: () => void disconnectAccount() },
    palette: { importFile: () => setMode({ kind: 'import' }), newFile: () => setMode({ kind: 'create' }), pull: onPull, push: onPush },
    dialogs: {
      picker: {
        mode, status, refreshStatus: refresh, onClose: () => setMode(null), onConnect: connect, onImport: importFile, loadLink, onLink: linkDoc, onCreate: createLinked,
        pushableDocId: role === 'owner' && o.liveStatus === 'live' ? currentDocId : null,
        onRequestUnlink: (docId) => { setUnlinkError(null); setUnlinkDocId(docId) },
      },
      unlink: { open: unlinkDocId !== null, error: unlinkError, onCancel: () => setUnlinkDocId(null), onConfirm: () => void confirmUnlink() },
      pull: pull.dialog,
      push: push.dialog,
    },
  }
}
