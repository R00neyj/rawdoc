// 가져오기(md·zip·볼트·OS 열기)·끌어놓기·이미지 — App.tsx 에서 옮김 (F-2068, F-2059)
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { AttachmentExt, Doc, Folder, LineEnding, Store } from '../types'
import { ancestorsOfDoc, folderAncestors } from '../lib/folderTree'
import type { ShareDoc } from '../lib/shareCodec'
import { stripContent, sortByUpdatedAtDesc, type DocMeta, type OpenDoc } from './docMeta'
import type { DocPathKind } from './docPath'
import { setPref } from './prefs'
import { e2eeCreateErrorMessage } from './appNotices'
import { fetchUsage } from '../storage/attachmentsApi'
import {
  readZipEntries,
  detectZipKind,
  planWorkspaceImport,
  applyImportPlan,
  ZIP_UNREADABLE_MESSAGE,
  type ApplyStore,
  type ImportPlan,
} from './importWorkspace'
import {
  scanVault,
  vaultWantsBytes,
  filesAsEntries,
  defaultVaultTarget,
  vaultTargetOptions,
  planVaultImport,
  applyVaultImport,
  vaultUploadNames,
  type VaultEntry,
  type VaultScan,
  type VaultTarget,
  type VaultPlan,
  type ApplyVaultStore,
} from './importVault'
import type { ImportDialogState, ImportTargetPicker } from './ImportPreviewDialog'
import { importFiles } from './importFiles'
import { isExternalFileDrag, pickMarkdownFiles, pickImageFiles, isImageOnlyDrag, classifyDroppedEntries, readDroppedDirectory } from './fileDrop'
import { toWebp } from '../storage/toWebp'
import { attachImages } from './attachImages'
import { setupFileLaunch } from '../pwa/fileLaunch'
import type { NoticeWithAction } from './NoticeBar'
import { canRemountWithFresh, shouldRemountAfterImport } from './importResult'

export type UseImportFlowOptions = {
  store: Store
  folders: Folder[]
  currentDoc: DocMeta | null
  bootPhase: 'booting' | 'ready'
  setDocs: Dispatch<SetStateAction<DocMeta[]>>
  setFolders: Dispatch<SetStateAction<Folder[]>>
  setCurrentDocId: Dispatch<SetStateAction<string | null>>
  setOpenDoc: Dispatch<SetStateAction<OpenDoc | null>>
  setEditorRemountNonce: Dispatch<SetStateAction<number>>
  setSharedDoc: Dispatch<SetStateAction<ShareDoc | null>>
  setSharesOpen: Dispatch<SetStateAction<boolean>>
  setHelpOpen: Dispatch<SetStateAction<boolean>>
  setMapRoute: Dispatch<SetStateAction<{ centerDocId: string | null; returnDocId: string | null } | null>>
  showNotice: (input: NoticeWithAction) => number
  keepLiveTitle: (list: DocMeta[]) => DocMeta[]
  beforeLeaveDoc: () => Promise<void>
  addOpenFolders: (ids: string[] | null | undefined) => void
  closeSidebarIfNarrow: () => void
  closeSettings: () => void
  newDocFolderId: () => string | null
  ensureE2eeOpenForFolder: (folderId: string | null) => Promise<boolean>
  pushHashUrl: (docId: string | null) => void
  importInputRef: RefObject<HTMLInputElement | null>
  importZipInputRef: RefObject<HTMLInputElement | null>
  importFolderInputRef: RefObject<HTMLInputElement | null>
  docsRef: RefObject<DocMeta[]>
  foldersRef: RefObject<Folder[]>
  currentDocIdRef: RefObject<string | null>
  sharedDocRef: RefObject<ShareDoc | null>
  docPathRef: RefObject<{ docId: string | null; path: DocPathKind | null }>
  focusEditorRef: RefObject<boolean>
  docSaverFlushRef: RefObject<() => Promise<boolean>>
  dropBlockedRef: RefObject<boolean>
  imageDropBlockedRef: RefObject<boolean>
  readOnlyDocRef: RefObject<boolean>
}

export type UseImportFlowResult = {
  dropActive: boolean
  importState: ImportDialogState | null
  requestImport: () => void
  handleImportInputChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>
  requestImportZip: () => void
  handleImportZipInputChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>
  requestImportFolder: () => void
  handleImportFolderInputChange: (e: ChangeEvent<HTMLInputElement>) => Promise<void>
  handleImportTargetChange: (value: string) => void
  cancelImportPreview: () => void
  cancelImportProgress: () => void
  closeImportResult: () => void
  confirmImport: () => Promise<void>
  handleImageFiles: (
    files: FileList | File[],
    options?: { source?: 'paste' | 'drop'; blocked?: boolean },
  ) => Promise<Awaited<ReturnType<typeof attachImages>>['inserted']>
}

export function useImportFlow(options: UseImportFlowOptions): UseImportFlowResult {
  const {
    store, folders, currentDoc, bootPhase, setDocs, setFolders, setCurrentDocId, setOpenDoc, setEditorRemountNonce, setSharedDoc, setSharesOpen,
    setHelpOpen, setMapRoute, showNotice, keepLiveTitle, beforeLeaveDoc, addOpenFolders, closeSidebarIfNarrow, closeSettings, newDocFolderId,
    ensureE2eeOpenForFolder, pushHashUrl, importInputRef, importZipInputRef, importFolderInputRef, docsRef, foldersRef, currentDocIdRef,
    sharedDocRef, docPathRef, focusEditorRef, docSaverFlushRef, dropBlockedRef, imageDropBlockedRef, readOnlyDocRef,
  } = options
  // 외부 .md 파일을 창 위로 끄는 동안의 덮개 (F-145.md 2.4)
  const [dropActive, setDropActive] = useState(false)
  // zip 가져오기 미리보기·진행·결과 대화상자 (F-282.md 3.8)
  const [importState, setImportState] = useState<ImportDialogState | null>(null)
  // zip 가져오기 — 선택 input, 확정된 계획, 취소 신호 (F-282.md 3.1·3.9)
  const importFileRef = useRef<File | null>(null)
  const importPlanRef = useRef<ImportPlan | null>(null)
  const importCancelRef = useRef(false)
  // 폴더 가져오기(볼트) — 선택 input, 1차 훑기 결과·원천·계획 (F-2019.md 4.2·12장)
  type VaultSource = { kind: 'zip'; file: File } | { kind: 'folder'; files: Array<{ path: string; file: File }> }
  const importVaultContextRef = useRef<{
    scan: VaultScan
    source: VaultSource
    docs: Doc[]
    folders: Folder[]
    attachments: Map<string, AttachmentExt>
    remainingBytes: number | null
    target: VaultTarget
    fileName: string
  } | null>(null)
  const importVaultPlanRef = useRef<VaultPlan | null>(null)
  // 창 전체 폴더 끌어놓기 — 매 커밋 최신 previewImportFolder 를 읽는다(runImportFilesRef 와 같은 이유)
  const previewImportFolderRef = useRef<(files: Array<{ path: string; file: File }>, fileName: string) => Promise<void>>(async () => {})
  // OS 파일 열기 연동(F-119)이 최신 store·beforeLeaveDoc 을 쓰도록 매 렌더 후 갱신한다
  const runImportFilesRef = useRef<(files: File[]) => Promise<Doc | null>>(async () => null)
  // OS 파일 열기 재중복 방지(F-231)도 같은 이유로 매 렌더 후 최신 참조로 갱신한다
  const openOrImportLaunchedFilesRef = useRef<
    (items: { file: File; handle: FileSystemFileHandle }[]) => Promise<void>
  >(async () => {})

  // ----- OS 에서 .md 파일로 열기 연동 (specs/features/F-119.md, ia.md 3.14) -----
  // 저장소가 준비된 뒤(부팅 완료 후) consumer 를 등록한다
  useEffect(() => {
    if (bootPhase !== 'ready') return
    setupFileLaunch({
      onFiles: (items) => {
        openOrImportLaunchedFilesRef.current(items)
      },
    })
  }, [bootPhase])

  // runImportFiles 는 store·showNotice 를 클로저로 담아 매 커밋 후 갱신해야 file launch consumer 가 낡은 상태를 쓰지 않는다 (F-119)
  useEffect(() => {
    runImportFilesRef.current = runImportFiles
    openOrImportLaunchedFilesRef.current = openOrImportLaunchedFiles
    previewImportFolderRef.current = previewImportFolder
  })

  // 창 전체 .md 파일 끌어놓기(F-145.md 2장) — 외부 파일만 반응, depth 로 진입 횟수를 센다
  useEffect(() => {
    let depth = 0

    function handleDragEnter(e: DragEvent) {
      if (!isExternalFileDrag(e.dataTransfer)) return
      e.preventDefault()
      depth++
      // 이미지 파일만 끌 때는 F-145 덮개를 띄우지 않는다 — 에디터 위 CM6 dropCursor 가 놓을 자리를 보인다 (F-156.md 2.5)
      if (!dropBlockedRef.current && !isImageOnlyDrag(e.dataTransfer)) setDropActive(true)
    }

    function handleDragOver(e: DragEvent) {
      if (!isExternalFileDrag(e.dataTransfer)) return
      // 받지 않는 때에도 브라우저 기본 파일 열기를 막는다 (2.1)
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = dropBlockedRef.current ? 'none' : 'copy'
    }

    function handleDragLeave(e: DragEvent) {
      if (!isExternalFileDrag(e.dataTransfer)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDropActive(false)
    }

    function handleDrop(e: DragEvent) {
      if (!isExternalFileDrag(e.dataTransfer)) return
      e.preventDefault()
      depth = 0
      setDropActive(false)
      // 대화상자·공유 화면에서는 이미지도 md 도 다 막는다 (F-145.md 2.1, F-156.md 2.5)
      if (imageDropBlockedRef.current) return

      // 폴더 판정을 pickMarkdownFiles 보다 먼저 — 이벤트가 끝나면 dataTransfer.items 에 못 닿는다 (F-2019.md 4.3·12장)
      const droppedEntries = e.dataTransfer ? Array.from(e.dataTransfer.items).filter((it) => it.kind === 'file').map((it) => it.webkitGetAsEntry()) : []
      const dropClass = classifyDroppedEntries(droppedEntries)
      if (dropClass.kind === 'folder') {
        if (dropBlockedRef.current) return // 메모리 저장소는 .md 처럼 조용히 무시
        readDroppedDirectory(dropClass.entry)
          .then(async (files) => {
            const fileName = files[0]?.path.split('/')[0] ?? dropClass.entry.name
            await docSaverFlushRef.current()
            await previewImportFolderRef.current(files, fileName)
          })
          .catch(() => showNotice({ type: 'error', message: '가져오지 못했습니다.' }))
        return
      }
      if (dropClass.kind === 'too-many') {
        if (dropBlockedRef.current) return
        showNotice({ type: 'info', message: '폴더는 한 번에 하나만 가져올 수 있습니다.' })
        return
      }

      const files = Array.from(e.dataTransfer!.files)
      const { mdFiles, allNonMd } = pickMarkdownFiles(files)
      // 여기선 대화상자·공유 화면은 이미 걸러졌으니 dropBlockedRef 가 true 면 store.kind==='memory' 뿐 — md 는 막고 이미지는 예외로 받는다(F-156.md 2.5)
      const memoryBlocked = dropBlockedRef.current

      if (mdFiles.length > 0) {
        if (memoryBlocked) return
        // md 와 이미지가 섞이면 md 만 가져오고 알린다(F-156.md 2.5) — 가져오기 성공 알림(F-145)이 먼저 뜨므로 그 뒤에 띄워야 마지막에 보인다
        const showMixedNotice = mdFiles.length < files.length && pickImageFiles(files).imageFiles.length > 0
        Promise.resolve(runImportFilesRef.current(mdFiles)).then(() => {
          if (showMixedNotice) {
            showNotice({ type: 'info', message: '.md 파일만 가져왔습니다. 이미지는 따로 놓아 주세요.' })
          }
        })
        return
      }

      if (allNonMd) {
        // 편집 영역 위 순수 이미지 드롭은 imageInsert.js 가 stopPropagation 으로 먼저 처리하므로, 여기 닿는 건 항상 편집 영역 밖이다(F-156.md 2.5)
        const { imageFiles } = pickImageFiles(files)
        if (imageFiles.length > 0) {
          showNotice({ type: 'info', message: '이미지는 편집 영역에 놓아 넣을 수 있습니다.' })
          return
        }
        if (memoryBlocked) return
        showNotice({ type: 'info', message: '마크다운(.md) 파일만 가져올 수 있습니다.' })
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && depth > 0) {
        depth = 0
        setDropActive(false)
      }
    }

    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showNotice, docSaverFlushRef, dropBlockedRef, imageDropBlockedRef])

  // ----- .md 가져오기 (specs/features/F-114.md 2.2·2.3) -----
  function requestImport() {
    importInputRef.current?.click()
    closeSidebarIfNarrow()
  }

  // 가져오기 실행(F-114.md 2.2) — 파일 선택 input 과 OS 파일 열기 연동(F-119)이 함께 쓴다
  // 현재 문서가 속한 폴더 안에 만든다(F-126.md 5.3) — importFiles.js 는 범위 밖이라 store.create 를 감싸 folderId 를 주입한다
  async function runImportFiles(files: File[]): Promise<Doc | null> { // 마지막으로 만든 문서를 돌려준다 — OS 파일 열기 재중복 방지(F-231)가 handle 연결에 쓴다
    if (files.length === 0) return null

    const targetFolderId = newDocFolderId() // F-138 3.4 — 끊긴 folderId 는 최상위로
    // 금고 폴더면 여러 파일이어도 한 번만 묻는다 (F-405 7.6)
    if (!(await ensureE2eeOpenForFolder(targetFolderId))) return null

    await beforeLeaveDoc()

    // 금고 한 겹이 거절한 이유는 가져오기 알림 대신 금고 문구로 보인다 (F-405 7.6)
    let lastE2eeError: unknown = null
    const scopedStore = {
      ...store,
      create: (args: { title: string; content: string; lineEnding: LineEnding }) =>
        store.create({ ...args, folderId: targetFolderId }).catch((err: unknown) => {
          if (e2eeCreateErrorMessage(err)) lastE2eeError = err
          throw err
        }),
    }

    const createdMetas: DocMeta[] = []
    let lastCreatedDoc: Doc | null = null

    await importFiles(files, {
      store: scopedStore,
      onCreated: (doc: Doc, { isLast }: { isLast: boolean }) => {
        createdMetas.push(stripContent(doc))
        if (isLast) lastCreatedDoc = doc
      },
      notify: (notice) => {
        const e2eeMessage = notice?.type === 'error' ? e2eeCreateErrorMessage(lastE2eeError) : null
        if (e2eeMessage) showNotice({ type: 'error', message: e2eeMessage })
        else if (notice) showNotice(notice)
      },
    })

    if (createdMetas.length > 0) {
      setDocs((prev) => sortByUpdatedAtDesc([...prev, ...createdMetas]))
    }

    // lastCreatedDoc 은 onCreated 콜백 안에서만 대입돼 TS 가 못 보고 never 로 좁힌다 — 단언으로 실제 타입을 되돌린다
    const createdDoc = lastCreatedDoc as Doc | null
    if (createdDoc) {
      // 공유 보기(F-130 4장)·공유 관리·도움말·지도(F-2054 6.4)를 떠난다 — 가져온 게 없으면 화면과 주소를 그대로 둔다
      setSharedDoc(null)
      setSharesOpen(false)
      setHelpOpen(false)
      setMapRoute(null)
      focusEditorRef.current = true
      setCurrentDocId(createdDoc.id)
      setPref('md.lastDocId', createdDoc.id)
      pushHashUrl(createdDoc.id) // 추가 (ia.md 3.10)
      addOpenFolders(ancestorsOfDoc({ folders, doc: stripContent(createdDoc) }))
    }
    return createdDoc
  }

  async function handleImportInputChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // 같은 파일을 연달아 고를 수 있게 (F-114.md 2.3)
    await runImportFiles(files)
  }

  // ----- zip 가져오기 — 설정 `데이터` 절 (specs/features/F-282.md 3.1~3.9) -----
  function requestImportZip() {
    closeSettings() // 설정 위에 미리보기를 겹쳐 열지 않는다 (3.1)
    importZipInputRef.current?.click()
  }

  async function handleImportZipInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    e.target.value = '' // 같은 파일을 연달아 고를 수 있게
    if (!file) return
    await docSaverFlushRef.current() // 지금 열린 문서가 갱신 대상일 수 있다 (3.1)
    await previewImportZip(file)
  }

  // ----- 폴더 가져오기(볼트) — 설정 `데이터` 절 (F-2019.md 4.2·10.1) -----
  function requestImportFolder() {
    closeSettings() // 설정 위에 미리보기를 겹쳐 열지 않는다 (F-282.md 3.1 과 같은 이유)
    importFolderInputRef.current?.click()
  }

  async function handleImportFolderInputChange(e: ChangeEvent<HTMLInputElement>) {
    // e.target.files 는 살아있는 참조라 value 를 비우면 같이 비워진다 — 배열로 먼저 떠 둔다
    const files = Array.from(e.target.files ?? []).map((file) => ({ path: file.webkitRelativePath, file }))
    e.target.value = '' // 같은 폴더를 연달아 고를 수 있게
    if (files.length === 0) return // 빈 폴더 — 이름조차 알 수 없다 (4.2)
    const fileName = files[0]?.path.split('/')[0] ?? ''
    await docSaverFlushRef.current()
    await previewImportFolder(files, fileName)
  }

  // 폴더 선택·폴더 끌어놓기 공통 — 1차 훑기 뒤 볼트 미리보기로 (F-2019.md 4.2·4.3)
  async function previewImportFolder(files: Array<{ path: string; file: File }>, fileName: string) {
    if (files.length === 0) return
    const scan = await scanVault({ root: { kind: 'folder' }, entries: filesAsEntries(files, vaultWantsBytes) })
    await startVaultPreview({ kind: 'folder', files }, scan, fileName)
  }

  // 1차 훑기 — manifest.json 은 판별에, .md·.markdown·이미지는 워크스페이스 zip 요약(존재만)이나 볼트 훑기(5.1 이하)에 쓴다 (F-2019.md 4.1)
  async function previewImportZip(file: File) {
    const names: string[] = []
    let manifestBytes: Uint8Array | null = null
    const vaultEntries: VaultEntry[] = []
    try {
      for await (const entry of readZipEntries(file.stream(), {
        want: (name) => name === 'manifest.json' || vaultWantsBytes(name),
      })) {
        names.push(entry.name)
        if (entry.name === 'manifest.json') {
          manifestBytes = entry.bytes
          continue
        }
        vaultEntries.push(entry)
      }
    } catch {
      showNotice({ type: 'error', message: ZIP_UNREADABLE_MESSAGE })
      return
    }
    if (names.length === 0) {
      showNotice({ type: 'error', message: ZIP_UNREADABLE_MESSAGE })
      return
    }

    const kindResult = detectZipKind(manifestBytes)
    if (kindResult.kind === 'rejected') {
      showNotice({ type: 'error', message: kindResult.message })
      return
    }

    if (kindResult.kind === 'plain') {
      // manifest.json 없는 zip 은 전부 볼트 가져오기다 — F-282 3.7 을 대신한다(개요 4장 "한다" 4, 17장)
      const scan = await scanVault({
        root: { kind: 'zip', fileName: file.name },
        entries: (async function* () {
          for (const e of vaultEntries) yield e
        })(),
      })
      await startVaultPreview({ kind: 'zip', file }, scan, file.name)
      return
    }

    const now = Date.now()
    const zipPaths = new Set(names)
    const attachmentMetas = await store.listAttachments()
    const plan: ImportPlan = planWorkspaceImport({
      manifest: kindResult.manifest,
      existingDocs: docsRef.current.map((d) => ({ id: d.id, updatedAt: d.updatedAt, role: d.role })),
      existingFolders: foldersRef.current.map((f) => ({ id: f.id, parentId: f.parentId })),
      zipPaths,
      existingAttachmentIds: new Set(attachmentMetas.map((a) => a.id)),
      now,
    })

    importFileRef.current = file
    importPlanRef.current = plan
    setImportState({ stage: 'preview', fileName: file.name, plan })
  }

  // 볼트 가져오기 — 1차 훑기 결과로 store.list() 등을 한 번 읽고 넣을 폴더 기본값으로 첫 계획을 세운다 (F-2019.md 3장·7.1)
  async function startVaultPreview(source: VaultSource, scan: VaultScan, fileName: string) {
    const [vaultDocs, vaultFolders, attachmentMetas] = await Promise.all([store.list(), store.listFolders(), store.listAttachments()])
    const attachments = new Map(attachmentMetas.map((a) => [a.id, a.ext]))
    let remainingBytes: number | null = null
    if (store.kind === 'server') {
      try {
        const usage = await fetchUsage()
        remainingBytes = usage.limit - usage.used
      } catch {
        remainingBytes = null
      }
    }
    const target = defaultVaultTarget(scan, vaultFolders)
    importVaultContextRef.current = { scan, source, docs: vaultDocs, folders: vaultFolders, attachments, remainingBytes, target, fileName }
    planAndShowVault()
  }

  // 계획을 (다시) 세워 미리보기 대화상자를 그린다 — 넣을 폴더를 바꿀 때도 이 함수 하나로 (F-2019.md 7.6 마지막 줄·10.2)
  function planAndShowVault() {
    const ctx = importVaultContextRef.current
    if (!ctx) return
    const plan = planVaultImport({
      scan: ctx.scan,
      target: ctx.target,
      docs: ctx.docs,
      folders: ctx.folders,
      attachments: ctx.attachments,
      storeKind: store.kind,
      remainingBytes: ctx.remainingBytes,
    })
    importVaultPlanRef.current = plan
    const options = vaultTargetOptions(ctx.scan, ctx.folders)
    const value = ctx.target.kind === 'new' ? 'new' : ctx.target.kind === 'top' ? 'top' : `folder:${ctx.target.folderId}`
    const target: ImportTargetPicker = { options, value }
    setImportState({ stage: 'preview', fileName: ctx.fileName, plan: { counts: plan.counts, warnings: [...plan.warnings] }, target })
  }

  function handleImportTargetChange(value: string) {
    const ctx = importVaultContextRef.current
    if (!ctx) return
    ctx.target = value === 'new' ? { kind: 'new' } : value === 'top' ? { kind: 'top' } : { kind: 'folder', folderId: value.slice('folder:'.length) }
    planAndShowVault()
  }

  function cancelImportPreview() {
    importFileRef.current = null
    importPlanRef.current = null
    importVaultContextRef.current = null
    importVaultPlanRef.current = null
    setImportState(null)
  }

  function cancelImportProgress() {
    importCancelRef.current = true
  }

  function closeImportResult() {
    setImportState(null)
  }

  // 볼트 적용 — 넣을 새 폴더 → 폴더 → 이미지(2차 훑기) → 문서, F-282 3.9 와 같은 결과 화면 (F-2019.md 9장·12장)
  async function confirmVaultImport() {
    const ctx = importVaultContextRef.current
    const plan = importVaultPlanRef.current
    if (!ctx || !plan) return

    const uploadNames = vaultUploadNames(plan)
    const total = plan.uploadImages.size + plan.judgements.filter((j) => j.action !== 'skip').length
    const updatedIds = new Set(plan.judgements.filter((j) => j.action === 'update').map((j) => j.id))
    const openBeforeId = currentDocIdRef.current
    const fileName = ctx.fileName

    importCancelRef.current = false
    setImportState({ stage: 'progress', fileName, done: 0, total })

    const entries: AsyncIterable<VaultEntry> =
      ctx.source.kind === 'zip'
        ? readZipEntries(ctx.source.file.stream(), { want: (name) => uploadNames.has(name) })
        : filesAsEntries(ctx.source.files, (name) => uploadNames.has(name))

    const result = await applyVaultImport({
      plan,
      scan: ctx.scan,
      entries,
      store: store as ApplyVaultStore,
      encode: store.kind === 'server' ? toWebp : undefined,
      isCancelled: () => importCancelRef.current,
      onProgress: ({ done, total }) => setImportState({ stage: 'progress', fileName, done, total }),
    })

    importVaultContextRef.current = null
    importVaultPlanRef.current = null

    const [newFolders, newDocs] = await Promise.all([store.listFolders(), store.list()])
    setFolders(newFolders)
    const strippedDocs = keepLiveTitle(sortByUpdatedAtDesc(newDocs.map(stripContent)))
    setDocs(strippedDocs)

    if (openBeforeId && shouldRemountAfterImport({ openBeforeId, updatedIds, currentDocId: currentDocIdRef.current, docPath: docPathRef.current })) {
      const fresh = await store.get(openBeforeId)
      if (canRemountWithFresh(fresh, currentDocIdRef.current)) {
        setOpenDoc({ id: fresh.id, content: fresh.content, lineEnding: fresh.lineEnding })
        focusEditorRef.current = false
        setEditorRemountNonce((n) => n + 1)
      }
    }

    // 넣을 폴더와 그 조상을 편다 — T 가 최상위면 targetFolderId 가 null 이라 펼칠 것이 없다 (17장 Q4)
    if (result.targetFolderId !== null) addOpenFolders(folderAncestors(newFolders, result.targetFolderId))

    if (result.cancelled) {
      showNotice({
        type: 'warn',
        message: `가져오기를 멈췄습니다. 문서 ${result.createdCount + result.updatedCount}개를 들였습니다.`,
      })
      setImportState(null)
    } else if (result.failures.length === 0) {
      showNotice({
        type: 'info',
        message:
          result.updatedCount > 0
            ? `문서 ${result.createdCount}개를 가져오고 ${result.updatedCount}개를 갱신했습니다.`
            : `문서 ${result.createdCount}개를 가져왔습니다.`,
      })
      setImportState(null)
    } else {
      const allFailed = result.createdCount + result.updatedCount === 0
      showNotice({
        type: allFailed ? 'error' : 'warn',
        message: allFailed ? '가져오지 못했습니다.' : `${result.failures.length}개를 가져오지 못했습니다.`,
      })
      setImportState({
        stage: 'result',
        fileName,
        createdCount: result.createdCount,
        updatedCount: result.updatedCount,
        failures: result.failures,
      })
    }

    if (result.quotaSkippedCount > 0) {
      showNotice({
        type: 'error',
        message: `이미지 저장 공간(300MB)이 가득 차 이미지 ${result.quotaSkippedCount}개를 넣지 못했습니다.`,
      })
    }
  }

  async function confirmImport() {
    if (importVaultContextRef.current) {
      await confirmVaultImport()
      return
    }
    const file = importFileRef.current
    const plan = importPlanRef.current
    if (!file || !plan) return

    const wantedPaths = new Set<string>([...plan.docs.map((d) => d.path), ...plan.attachments.map((a) => a.path)])
    const total = plan.docs.length + plan.attachments.length
    const updatedIds = new Set(plan.docs.filter((d) => d.action === 'update').map((d) => d.id))
    const openBeforeId = currentDocIdRef.current

    importCancelRef.current = false
    setImportState({ stage: 'progress', fileName: file.name, done: 0, total })

    const result = await applyImportPlan({
      plan,
      entries: readZipEntries(file.stream(), { want: (name) => wantedPaths.has(name) }),
      store: store as ApplyStore,
      isCancelled: () => importCancelRef.current,
      onProgress: ({ done, total }) => setImportState({ stage: 'progress', fileName: file.name, done, total }),
    })

    importFileRef.current = null
    importPlanRef.current = null

    const [newFolders, newDocs] = await Promise.all([store.listFolders(), store.list()])
    setFolders(newFolders)
    const strippedDocs = keepLiveTitle(sortByUpdatedAtDesc(newDocs.map(stripContent)))
    setDocs(strippedDocs)

    // 열려 있던 문서가 갱신 대상이었으면 에디터를 다시 마운트한다 — 안 하면 옛 EditorState 가 다음 저장 때 가져온 내용을 덮어쓴다 (3.9, F-213 2.3 과 같은 방식)
    // 실시간 경로면 건너뛴다 — 편집기는 방 Doc 에서 만들어지고, 가져온 본문은 DO 가 흡수할 때 들어온다 (F-305 10.1)
    if (openBeforeId && shouldRemountAfterImport({ openBeforeId, updatedIds, currentDocId: currentDocIdRef.current, docPath: docPathRef.current })) {
      const fresh = await store.get(openBeforeId)
      if (canRemountWithFresh(fresh, currentDocIdRef.current)) {
        setOpenDoc({ id: fresh.id, content: fresh.content, lineEnding: fresh.lineEnding })
        focusEditorRef.current = false
        setEditorRemountNonce((n) => n + 1)
      }
    }

    if (result.cancelled) {
      showNotice({
        type: 'warn',
        message: `가져오기를 멈췄습니다. 문서 ${result.createdCount + result.updatedCount}개를 들였습니다.`,
      })
      setImportState(null)
    } else if (result.failures.length === 0) {
      showNotice({
        type: 'info',
        message:
          result.updatedCount > 0
            ? `문서 ${result.createdCount}개를 가져오고 ${result.updatedCount}개를 갱신했습니다.`
            : `문서 ${result.createdCount}개를 가져왔습니다.`,
      })
      setImportState(null)
    } else {
      const allFailed = result.createdCount + result.updatedCount === 0
      showNotice({
        type: allFailed ? 'error' : 'warn',
        message: allFailed ? '가져오지 못했습니다.' : `${result.failures.length}개를 가져오지 못했습니다.`,
      })
      setImportState({
        stage: 'result',
        fileName: file.name,
        createdCount: result.createdCount,
        updatedCount: result.updatedCount,
        failures: result.failures,
      })
    }

    if (result.quotaSkippedCount > 0) {
      showNotice({
        type: 'error',
        message: `이미지 저장 공간(300MB)이 가득 차 이미지 ${result.quotaSkippedCount}개를 넣지 못했습니다.`,
      })
    }
  }

  // OS 파일 열기 재중복 방지 — idb 이고 판정 메서드가 둘 다 있을 때만 handle 로 찾는다 (F-231.md 3.3)
  async function openOrImportLaunchedFiles(items: { file: File; handle: FileSystemFileHandle }[]) {
    if (items.length === 0) return

    const canDedupe = store.kind === 'idb' && Boolean(store.findDocByFileHandle) && Boolean(store.linkFileHandle)
    if (!canDedupe) {
      await runImportFiles(items.map((item) => item.file))
      return
    }

    for (const { file, handle } of items) {
      let matchedId: string | null = null
      try {
        matchedId = await store.findDocByFileHandle!(handle)
      } catch {
        matchedId = null
      }

      const matchedDoc = matchedId ? docsRef.current.find((d) => d.id === matchedId) : undefined
      if (matchedId && matchedDoc) {
        if (matchedId !== currentDocIdRef.current || sharedDocRef.current) {
          await beforeLeaveDoc()
          setSharedDoc(null)
          focusEditorRef.current = true
          setCurrentDocId(matchedId)
          setPref('md.lastDocId', matchedId)
          pushHashUrl(matchedId)
          addOpenFolders(ancestorsOfDoc({ folders: foldersRef.current, doc: matchedDoc }))
          closeSidebarIfNarrow()
        }
        showNotice({ type: 'info', message: `"${matchedDoc.title}" 을(를) 열었습니다. (이미 가져온 파일)` })
        continue
      }

      const createdDoc = await runImportFiles([file])
      if (createdDoc) {
        try {
          await store.linkFileHandle!(createdDoc.id, handle)
        } catch {
          // 연결 실패해도 가져오기는 이미 끝났다 — 다음엔 새 문서로 다시 가져올 뿐 기능은 막히지 않는다
        }
      }
    }
  }

  // 이미지 붙여넣기·끌어놓기(F-156.md 2.2·2.4·2.5·2.6, F-406.md 2.2) — 위치 계산·삽입은 imageInsert.js 가 하고, 여기는 검사·저장·알림만. blocked:true 면 저장을 시도하지 않는다
  const handleImageFiles = useCallback(
    async (
      files: FileList | File[],
      { source, blocked }: { source?: 'paste' | 'drop'; blocked?: boolean } = {},
    ) => {
      if (blocked || readOnlyDocRef.current) {
        showNotice({ type: 'info', message: '이 위치에는 이미지를 넣을 수 없습니다.' })
        return []
      }
      const { inserted, notice } = await attachImages(files, { store, source, ...(currentDoc?.e2ee ? { e2ee: true as const } : {}) })
      if (notice) showNotice(notice)
      return inserted
    },
    [store, showNotice, currentDoc?.e2ee, readOnlyDocRef],
  )

  return {
    dropActive, importState, requestImport, handleImportInputChange, requestImportZip, handleImportZipInputChange, requestImportFolder,
    handleImportFolderInputChange, handleImportTargetChange, cancelImportPreview, cancelImportProgress, closeImportResult, confirmImport, handleImageFiles,
  }
}
