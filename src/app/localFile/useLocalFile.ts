// 로컬 파일 하나 — 세션·열기·쓰기·떠나기 (specs/features/F-2155.md 3·4장, 계약 5장)
import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { decodeMarkdown, type DecodedMarkdown } from '../../lib/decodeMarkdown'
import { encodeMarkdown } from '../../lib/encodeMarkdown'
import { ensureWritePermission, MD_PICKER_OPTIONS } from '../../lib/fileSystemAccess'
import type { EditorHandle } from '../../editor/Editor'
import type { LineEnding } from '../../types'
import type { NoticeWithAction } from '../notices/NoticeBar'
import { leaveScreens, type ScreenSetters } from '../routing/leaveScreens'
import { pushFileHash } from '../routing/useHashRouting'
import { downloadBlob } from '../importExport/exportDoc'
import {
  hasUnwritten,
  initialLocalSave,
  LOCAL_MIXED_EOL_MESSAGE,
  LOCAL_SAVE_DEBOUNCE_MS,
  LOCAL_WRITE_FAILED_MESSAGE,
  localNotUtf8Message,
  localOpenFailedMessage,
  localUnwrittenMessage,
  nextLocalSave,
  type LocalSaveEvent,
  type LocalSaveState,
  type LocalSaveStatus,
} from './localFileState'

export type { LocalSaveStatus } from './localFileState'
export type LocalFileSession = { key: string; handle: FileSystemFileHandle; name: string; lineEnding: LineEnding; hadBom: boolean; lastModified: number; canWrite: boolean }
export type LocalOpenResult = 'opened' | 'same' | 'missing' | 'not-utf8' | 'error'
export type BeforeLocalWrite = (session: LocalFileSession) => Promise<boolean> // 거짓 = 이번 쓰기 건너뜀, dirty 유지
export type UseLocalFileResult = {
  session: LocalFileSession | null; status: LocalSaveStatus; hasUnwritten: boolean; editorKey: string | null; initialText: string
  openLocalFile(handle: FileSystemFileHandle, opts: { gesture: boolean }): Promise<LocalOpenResult>
  pickLocalFile(): Promise<void>; closeLocalFile(): void; flush(): Promise<boolean>
  saveNow(opts?: { skipGuard?: boolean }): Promise<boolean>; grantWrite(): Promise<void>; importToDoc(): Promise<void>
  readText(): string | null // 파일 줄바꿈으로
  remount(next: { text: string; lineEnding: LineEnding; hadBom: boolean; lastModified: number }): void // 새 editorKey, dirty·대기 버림
  setBeforeWrite(guard: BeforeLocalWrite | null): void; subscribeOpened(listener: (session: LocalFileSession) => void): () => void
}

export type UseLocalFileOptions = {
  selfRef: RefObject<UseLocalFileResult | null>
  editorRef: RefObject<EditorHandle | null>
  beforeLeaveDoc: () => Promise<void>
  screenSetters: Omit<ScreenSetters, 'closeLocalFile'>
  setCurrentDocId: Dispatch<SetStateAction<string | null>>
  showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
  importAsDoc: (file: File, handle: FileSystemFileHandle) => Promise<void>
}

// createWritable 은 close() 때 디스크에 반영된다 — 실패하면 abort 로 임시 파일을 버린다
async function writeToDisk(session: LocalFileSession, text: string): Promise<number> {
  const writable = await session.handle.createWritable()
  try {
    await writable.write(encodeMarkdown(text, { hadBom: session.hadBom }))
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => {})
    throw error
  }
  return (await session.handle.getFile()).lastModified
}

export function useLocalFile(options: UseLocalFileOptions): UseLocalFileResult {
  const { selfRef, editorRef } = options
  const optsRef = useRef(options)
  const [session, setSession] = useState<LocalFileSession | null>(null)
  const [save, setSave] = useState<LocalSaveState>(() => initialLocalSave(true))
  const [editorKey, setEditorKey] = useState<string | null>(null)
  const [initialText, setInitialText] = useState('')

  const sessionRef = useRef<LocalFileSession | null>(null)
  const saveRef = useRef(save)
  // 열기·remount·닫기마다 올린다 — 그 전에 시작한 쓰기의 결과는 버린다
  const genRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loopRef = useRef<Promise<void> | null>(null)
  // 쓰기 한 줄 — 되풀이 쓰기와 닫을 때의 마지막 쓰기가 이 순서대로 하나씩 돈다
  const tailRef = useRef<Promise<void>>(Promise.resolve())
  const guardRef = useRef<BeforeLocalWrite | null>(null)
  const openedRef = useRef(new Set<(session: LocalFileSession) => void>())
  const importingRef = useRef(false)
  const remountCountRef = useRef(0)

  useEffect(() => {
    optsRef.current = options
  })

  const commitSession = useCallback((next: LocalFileSession | null) => {
    sessionRef.current = next
    setSession(next)
  }, [])

  const dispatch = useCallback((event: LocalSaveEvent) => {
    const next = nextLocalSave(saveRef.current, event)
    saveRef.current = next.state
    setSave(next.state)
    if (next.notifyError) optsRef.current.showNotice({ type: 'error', message: LOCAL_WRITE_FAILED_MESSAGE })
  }, [])

  const clearTimer = useCallback(() => {
    clearTimeout(timerRef.current ?? undefined)
    timerRef.current = null
  }, [])

  const runWrite = useCallback((opts?: { skipGuard?: boolean }): Promise<void> => {
    if (loopRef.current) return loopRef.current
    let skipGuard = opts?.skipGuard === true
    const loop = tailRef.current.then(async () => {
      while (saveRef.current.dirty) {
        const gen = genRef.current
        const current = sessionRef.current
        const handle = editorRef.current
        if (!current || !saveRef.current.canWrite || !handle) return
        const guard = skipGuard ? null : guardRef.current
        skipGuard = false
        if (guard && !(await guard(current))) {
          if (genRef.current === gen) dispatch({ type: 'write-skip' })
          return
        }
        if (genRef.current !== gen) return
        const text = handle.getText(current.lineEnding)
        dispatch({ type: 'write-start' })
        try {
          const lastModified = await writeToDisk(current, text)
          if (genRef.current !== gen) return
          commitSession({ ...sessionRef.current!, lastModified })
          dispatch({ type: 'write-ok' })
        } catch (error) {
          if (genRef.current !== gen) return
          dispatch({ type: 'write-fail', error })
          if (!saveRef.current.canWrite) commitSession({ ...sessionRef.current!, canWrite: false })
          return
        }
      }
    })
    const tracked = loop.finally(() => {
      loopRef.current = null
    })
    loopRef.current = tracked
    tailRef.current = tracked.catch(() => {})
    return tracked
  }, [editorRef, dispatch, commitSession])

  const scheduleWrite = useCallback(() => {
    clearTimer()
    if (saveRef.current.canWrite) timerRef.current = setTimeout(() => void runWrite(), LOCAL_SAVE_DEBOUNCE_MS)
  }, [clearTimer, runWrite])

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimer()
    if (saveRef.current.dirty || loopRef.current) await runWrite()
    await tailRef.current
    return !hasUnwritten(saveRef.current)
  }, [clearTimer, runWrite])

  const saveNow = useCallback(async (opts?: { skipGuard?: boolean }): Promise<boolean> => {
    clearTimer()
    if (loopRef.current) await loopRef.current
    if (saveRef.current.dirty) await runWrite(opts)
    return !hasUnwritten(saveRef.current)
  }, [clearTimer, runWrite])

  const requestWrite = useCallback(async (): Promise<boolean> => {
    const current = sessionRef.current
    if (!current) return false
    const gen = genRef.current
    const granted = await ensureWritePermission(current.handle, { gesture: true })
    if (genRef.current !== gen) return false
    dispatch({ type: 'permission', granted })
    commitSession({ ...sessionRef.current!, canWrite: granted })
    return granted
  }, [dispatch, commitSession])

  const grantWrite = useCallback(async () => {
    if (await requestWrite()) await saveNow()
  }, [requestWrite, saveNow])

  const readText = useCallback((): string | null => {
    const current = sessionRef.current
    return current ? (editorRef.current?.getText(current.lineEnding) ?? null) : null
  }, [editorRef])

  // 떠날 때 — 못 쓴 변경은 지금 본문을 잡아 같은 줄에 마지막으로 쓰고, 못 쓰면 내보내기를 건넨다 (4장)
  const closeLocalFile = useCallback(() => {
    const current = sessionRef.current
    if (!current) return
    clearTimer()
    const canWrite = saveRef.current.canWrite
    const text = saveRef.current.dirty && !importingRef.current ? readText() : null
    const guard = guardRef.current
    genRef.current++
    commitSession(null)
    setEditorKey(null)
    saveRef.current = initialLocalSave(true)
    setSave(saveRef.current)
    if (text === null) return
    tailRef.current = tailRef.current.then(async () => {
      try {
        if (canWrite && (!guard || (await guard(current)))) {
          await writeToDisk(current, text)
          return
        }
      } catch {
        // 아래 알림으로 넘어간다
      }
      const exportBytes = () => downloadBlob(new Blob([encodeMarkdown(text, { hadBom: current.hadBom })], { type: 'text/markdown' }), current.name)
      optsRef.current.showNotice(
        { type: 'error', message: localUnwrittenMessage(current.name), action: { label: '.md 내보내기', onClick: exportBytes } },
        { sticky: true },
      )
    })
  }, [clearTimer, readText, commitSession])

  const openLocalFile = useCallback(async (handle: FileSystemFileHandle, { gesture }: { gesture: boolean }): Promise<LocalOpenResult> => {
    const { showNotice } = optsRef.current
    const current = sessionRef.current
    if (current && (await current.handle.isSameEntry(handle).catch(() => false))) {
      if (gesture && !saveRef.current.canWrite && (await requestWrite()) && saveRef.current.dirty) scheduleWrite()
      return 'same'
    }
    let decoded: DecodedMarkdown
    let lastModified: number
    try {
      const file = await handle.getFile()
      lastModified = file.lastModified
      decoded = decodeMarkdown(new Uint8Array(await file.arrayBuffer()))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return 'missing'
      if (error instanceof Error && error.message === 'not-utf8') {
        showNotice({ type: 'error', message: localNotUtf8Message(handle.name) })
        return 'not-utf8'
      }
      showNotice({ type: 'error', message: localOpenFailedMessage(handle.name) })
      return 'error'
    }
    const canWrite = await ensureWritePermission(handle, { gesture })
    const { beforeLeaveDoc, screenSetters, setCurrentDocId } = optsRef.current
    await beforeLeaveDoc()
    leaveScreens({ ...screenSetters, closeLocalFile })
    setCurrentDocId(null)
    const next: LocalFileSession = {
      key: `file:${crypto.randomUUID()}`, handle, name: handle.name, lineEnding: decoded.lineEnding, hadBom: decoded.hadBom, lastModified, canWrite,
    }
    genRef.current++
    commitSession(next)
    setInitialText(decoded.text)
    setEditorKey(next.key)
    dispatch({ type: 'reset', canWrite })
    pushFileHash()
    if (decoded.mixed) showNotice({ type: 'info', message: LOCAL_MIXED_EOL_MESSAGE })
    openedRef.current.forEach((listener) => listener(next))
    return 'opened'
  }, [requestWrite, scheduleWrite, closeLocalFile, commitSession, dispatch])

  const pickLocalFile = useCallback(async () => {
    if (!window.showOpenFilePicker) return
    let handles: FileSystemFileHandle[]
    try {
      handles = await window.showOpenFilePicker(MD_PICKER_OPTIONS)
    } catch {
      return // 취소(AbortError)·막힘 모두 조용히 — 화면은 그대로
    }
    if (handles[0]) await openLocalFile(handles[0], { gesture: true })
  }, [openLocalFile])

  const importToDoc = useCallback(async () => {
    const current = sessionRef.current
    const text = readText()
    if (!current || text === null) return
    const file = new File([encodeMarkdown(text, { hadBom: current.hadBom })], current.name, { type: 'text/markdown' })
    importingRef.current = true
    try {
      await optsRef.current.importAsDoc(file, current.handle)
    } finally {
      importingRef.current = false
    }
  }, [readText])

  const remount = useCallback((next: { text: string; lineEnding: LineEnding; hadBom: boolean; lastModified: number }) => {
    const current = sessionRef.current
    if (!current) return
    clearTimer()
    genRef.current++
    commitSession({ ...current, lineEnding: next.lineEnding, hadBom: next.hadBom, lastModified: next.lastModified })
    setInitialText(next.text)
    setEditorKey(`${current.key}:${++remountCountRef.current}`)
    dispatch({ type: 'reset', canWrite: saveRef.current.canWrite })
  }, [clearTimer, commitSession, dispatch])

  const setBeforeWrite = useCallback((guard: BeforeLocalWrite | null) => {
    guardRef.current = guard
  }, [])

  const subscribeOpened = useCallback((listener: (session: LocalFileSession) => void) => {
    openedRef.current.add(listener)
    return () => {
      openedRef.current.delete(listener)
    }
  }, [])

  // 내 입력만 dirty — 열기·remount 의 씨앗은 local 이 아니다
  useEffect(() => {
    const handle = editorKey ? editorRef.current : null
    if (!handle) return
    return handle.onChanges((u) => {
      if (!u.local) return
      dispatch({ type: 'input' })
      scheduleWrite()
    })
  }, [editorKey, editorRef, dispatch, scheduleWrite])

  const unwritten = hasUnwritten(save)
  useEffect(() => {
    if (!unwritten) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [unwritten])

  useEffect(() => () => clearTimer(), [clearTimer])

  const result: UseLocalFileResult = {
    session, status: save.status, hasUnwritten: unwritten, editorKey, initialText,
    openLocalFile, pickLocalFile, closeLocalFile, flush, saveNow, grantWrite, importToDoc, readText, remount, setBeforeWrite, subscribeOpened,
  }
  useEffect(() => {
    selfRef.current = result
  })
  return result
}
