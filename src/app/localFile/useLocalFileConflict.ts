// 로컬 파일 외부 변경 — 쓰기 직전 가드·focus 판정·띠 상태·버튼 동작 (specs/features/F-2157.md 2·3장)
import { useCallback, useEffect, useRef, useState } from 'react'
import { decodeMarkdown } from '../../lib/decodeMarkdown'
import { encodeMarkdown } from '../../lib/encodeMarkdown'
import { downloadBlob } from '../importExport/exportDoc'
import { decideExternalChange, LOCAL_CONFLICT_TEXT, readDiskStamp } from './localFileConflict'
import { localNotUtf8Message, localOpenFailedMessage } from './localFileState'
import type { NoticeWithAction } from '../NoticeBar'
import type { LocalFileSession, UseLocalFileResult } from './useLocalFile'

export type LocalBanner = 'conflict' | 'missing' | null
export type LocalFileConflict = {
  banner: LocalBanner
  bodyFor(key: string | null): string | null
  reload(): Promise<void>
  overwrite(): Promise<void>
  exportMd(): void
}

// React 가 방금 올린 상태를 그리도록 한 번 양보한다 — 타이머가 아니라 가짜 시계에 안 막힌다
const renderTick = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })

export function useLocalFileConflict(localFile: UseLocalFileResult, showNotice: (input: NoticeWithAction) => number): LocalFileConflict {
  const [banner, setBannerState] = useState<LocalBanner>(null)
  const bannerRef = useRef<LocalBanner>(null)
  const localRef = useRef(localFile)
  const noticeRef = useRef(showNotice)
  const mountedRef = useRef(true)
  const checkingRef = useRef(false)
  const attachedKeyRef = useRef<string | null>(null)
  const { setBeforeWrite } = localFile
  const sessionKey = localFile.session?.key ?? null

  useEffect(() => {
    localRef.current = localFile
    noticeRef.current = showNotice
    attachedKeyRef.current = localFile.editorKey
  })

  const setBanner = useCallback((next: LocalBanner) => {
    bannerRef.current = next
    if (mountedRef.current) setBannerState(next)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    setBanner(null)
  }, [sessionKey, setBanner])

  // 언마운트 때 걷지 않는다 — 마지막 쓰기가 가드 없이 새는 틈을 막는다 (다음 마운트가 덮어쓴다)
  useEffect(() => {
    setBeforeWrite(async (session: LocalFileSession) => {
      if (bannerRef.current) return false
      const current = await readDiskStamp(session.handle)
      if (current === 'unknown') return true
      const verdict = decideExternalChange({ known: session.lastModified, current, dirty: true })
      if (verdict === 'conflict' || verdict === 'missing') {
        setBanner(verdict)
        return false
      }
      return true
    })
  }, [setBeforeWrite, setBanner])

  const reloadFromDisk = useCallback(
    async (notify: boolean) => {
      const session = localRef.current.session
      if (!session) return
      try {
        const file = await session.handle.getFile()
        const decoded = decodeMarkdown(new Uint8Array(await file.arrayBuffer()))
        if (localRef.current.session?.key !== session.key) return
        localRef.current.remount({ text: decoded.text, lineEnding: decoded.lineEnding, hadBom: decoded.hadBom, lastModified: file.lastModified })
        setBanner(null)
        if (notify) noticeRef.current({ type: 'info', message: decoded.mixed ? LOCAL_CONFLICT_TEXT.reloadedMixed : LOCAL_CONFLICT_TEXT.reloaded })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') setBanner('missing')
        else if (error instanceof Error && error.message === 'not-utf8') {
          noticeRef.current({ type: 'error', message: localNotUtf8Message(session.name) })
          setBanner('conflict')
        } else noticeRef.current({ type: 'error', message: localOpenFailedMessage(session.name) })
      }
    },
    [setBanner],
  )

  const check = useCallback(async () => {
    if (checkingRef.current || !localRef.current.session) return
    checkingRef.current = true
    try {
      await localRef.current.flush()
      await renderTick()
      const { session, hasUnwritten } = localRef.current
      if (!session) return
      const current = await readDiskStamp(session.handle)
      if (current === 'unknown') return
      const verdict = decideExternalChange({ known: session.lastModified, current, dirty: hasUnwritten })
      if (verdict === 'none') setBanner(null)
      else if (verdict === 'reload') await reloadFromDisk(true)
      else setBanner(verdict)
    } finally {
      checkingRef.current = false
    }
  }, [setBanner, reloadFromDisk])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [check])

  const reload = useCallback(() => reloadFromDisk(false), [reloadFromDisk])

  const overwrite = useCallback(async () => {
    const lf = localRef.current
    if (!lf.session) return
    if (!lf.session.canWrite) {
      await lf.grantWrite()
      await renderTick()
    }
    if (!localRef.current.session?.canWrite) return
    if (await localRef.current.saveNow({ skipGuard: true })) setBanner(null)
  }, [setBanner])

  const exportMd = useCallback(() => {
    const { session, readText } = localRef.current
    const text = readText()
    if (!session || text === null) return
    downloadBlob(new Blob([encodeMarkdown(text, { hadBom: session.hadBom })], { type: 'text/markdown' }), session.name)
  }, [])

  // 새로 마운트한 편집기는 아직 안 붙었으면 null — 호출한 쪽이 씨앗 본문으로 대신한다
  const bodyFor = useCallback((key: string | null) => (attachedKeyRef.current === key ? localRef.current.readText() : null), [])

  return { banner, bodyFor, reload, overwrite, exportMd }
}
