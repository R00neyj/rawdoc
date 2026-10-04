// GitHub 당기기 상태·시작·적용 (specs/features/F-2129.md 4장)
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { EditorHandle } from '../editor/Editor'
import type { GithubLink } from '../lib/githubContract'
import type { LineEnding } from '../lib/lineEnding'
import { postDocGithubPull, postDocGithubSynced, type GithubResult } from './githubApi'
import { lineEndingNote, mergedTooLarge, pullFailureMessage, PULL_OFFLINE_MESSAGE, readPulled, sameNotice, type PulledText } from './githubPull'
import { githubErrorMessage } from './githubUi'
import type { NoticeWithAction } from './NoticeBar'
import type { LiveStatus } from './StatusBar'

export type GithubPullCompare = {
  docId: string
  phase: 'compare'
  key: number
  base: string
  remote: PulledText
  sha: string
  note: string | null
  status: string | null
  error: string | null
  busy: boolean
}
export type GithubPullState = null | { docId: string; phase: 'loading' } | GithubPullCompare
export type GithubPullApply = { result: string; changes: { from: number; to: number; insert: string }[] }
export type GithubPullDialogProps = { state: GithubPullState; onCancel: () => void; onApply: (a: GithubPullApply) => void }

type PullEditor = Pick<EditorHandle, 'view' | 'getText'>
export type UseGithubPullOptions = {
  editorRef: RefObject<PullEditor | null>
  liveStatus: LiveStatus | null
  currentDocId: string | null
  lineEnding: LineEnding
  blocked: boolean
  showNotice: (input: NoticeWithAction) => number
  watch: <T>(r: GithubResult<T>) => GithubResult<T>
  linkOf: (docId: string) => GithubLink | null
  onSynced: (docId: string, sha: string, bom: boolean) => void
  selectDoc: (id: string) => Promise<void>
}

export const PULL_REQUEST_WAIT_MS = 15_000
const DOC_CHANGED = '문서가 바뀌어 당기기를 멈췄습니다'
const NOT_APPLIED = '적용하지 못했습니다. 잠시 뒤에 다시 해 주세요'
const NOT_RECORDED = '합친 내용은 넣었지만 동기화 기록을 남기지 못했습니다. 다시 당겨 주세요'
const RECOMPARE = '그사이 본문이 바뀌어 다시 비교합니다'

type PendingPull = { docId: string; from: string | null; until: number; arrived: boolean }

export function useGithubPull(o: UseGithubPullOptions) {
  const [state, setStateRaw] = useState<GithubPullState>(null)
  const [, setPendingNonce] = useState(0)
  const pendingRef = useRef<PendingPull | null>(null)
  const stateRef = useRef<GithubPullState>(null)
  const optsRef = useRef(o)
  useEffect(() => {
    optsRef.current = o
  })

  const setState = useCallback((next: GithubPullState) => {
    stateRef.current = next
    setStateRaw(next)
  }, [])

  const markSynced = useCallback(async (docId: string, sha: string, bom: boolean): Promise<boolean> => {
    const { watch, onSynced, showNotice } = optsRef.current
    const r = watch(await postDocGithubSynced(docId, { sha, bom }))
    if (!r.ok) {
      showNotice({ type: 'error', message: githubErrorMessage(r) })
      return false
    }
    onSynced(docId, sha, bom)
    return true
  }, [])

  const finishSame = useCallback(
    async (docId: string, sha: string, remote: PulledText, note: string | null) => {
      setState(null)
      if (await markSynced(docId, sha, remote.hadBom)) optsRef.current.showNotice({ type: 'info', message: sameNotice(note) })
    },
    [markSynced, setState],
  )

  const startPull = useCallback(
    async (docId: string) => {
      if (stateRef.current) return
      const { liveStatus, editorRef, showNotice, watch, linkOf } = optsRef.current
      if (liveStatus !== 'live' || !editorRef.current) {
        showNotice({ type: 'error', message: PULL_OFFLINE_MESSAGE })
        return
      }
      const loading = { docId, phase: 'loading' } as const
      setState(loading)
      const r = watch(await postDocGithubPull(docId))
      if (stateRef.current !== loading) return
      const fail = (message: string) => {
        setState(null)
        optsRef.current.showNotice({ type: 'error', message })
      }
      if (!r.ok) return fail(pullFailureMessage(r, { remoteSha: linkOf(docId)?.remoteSha ?? null }))
      const remote = readPulled(r.value.content)
      if ('error' in remote) return fail(remote.error === 'not-utf8' ? 'GitHub 파일이 UTF-8 텍스트가 아니라 당길 수 없습니다' : githubErrorMessage({ status: 0, error: null, body: null }))
      const editor = optsRef.current.editorRef.current
      if (optsRef.current.currentDocId !== docId || !editor) return setState(null)
      const base = editor.getText('lf')
      const note = lineEndingNote(remote, optsRef.current.lineEnding)
      if (base === remote.text) return finishSame(docId, r.value.sha, remote, note)
      setState({ docId, phase: 'compare', key: 1, base, remote, sha: r.value.sha, note, status: null, error: null, busy: false })
    },
    [finishSame, setState],
  )

  const onApply = useCallback(
    async ({ result, changes }: GithubPullApply) => {
      const s = stateRef.current
      if (!s || s.phase !== 'compare' || s.busy) return
      const { currentDocId, liveStatus, editorRef, lineEnding, showNotice } = optsRef.current
      const editor = editorRef.current
      if (currentDocId !== s.docId || !editor) {
        setState(null)
        showNotice({ type: 'error', message: DOC_CHANGED })
        return
      }
      if (liveStatus !== 'live') return setState({ ...s, status: null, error: PULL_OFFLINE_MESSAGE })
      if (editor.view.composing) return
      if (mergedTooLarge(result, lineEnding)) return setState({ ...s, status: null, error: '합친 결과가 너무 큽니다 (최대 1MB)' })
      const current = editor.getText('lf')
      if (current !== s.base) {
        if (current === s.remote.text) return finishSame(s.docId, s.sha, s.remote, s.note)
        return setState({ ...s, base: current, key: s.key + 1, status: RECOMPARE, error: null })
      }
      setState({ ...s, status: null, error: null, busy: true })
      if (changes.length > 0) editor.view.dispatch({ changes, userEvent: 'input.github' })
      if (editor.getText('lf') !== result) {
        setState(null)
        showNotice({ type: 'error', message: NOT_APPLIED })
        return
      }
      const r = optsRef.current.watch(await postDocGithubSynced(s.docId, { sha: s.sha, bom: s.remote.hadBom }))
      setState(null)
      if (!r.ok) {
        optsRef.current.showNotice({ type: 'error', message: NOT_RECORDED })
        return
      }
      optsRef.current.onSynced(s.docId, s.sha, s.remote.hadBom)
      optsRef.current.showNotice({ type: 'info', message: changes.length > 0 ? 'GitHub에서 당겨 합쳤습니다' : '지금 내용을 그대로 두었습니다' })
    },
    [finishSame, setState],
  )

  const onCancel = useCallback(() => {
    const s = stateRef.current
    if (s?.phase === 'compare' && s.busy) return
    if (s) setState(null)
  }, [setState])

  const requestPull = useCallback((docId: string) => {
    const from = optsRef.current.currentDocId
    pendingRef.current = { docId, from, until: Date.now() + PULL_REQUEST_WAIT_MS, arrived: from === docId }
    setPendingNonce((n) => n + 1)
    if (from !== docId) void optsRef.current.selectDoc(docId)
  }, [])

  // 연결 뒤 당기기는 "지금 문서·live·편집기 있음·다른 대화상자 없음" 이 되는 첫 렌더에서 한 번 (4.5)
  const { currentDocId, liveStatus, blocked, editorRef } = o
  useEffect(() => {
    const p = pendingRef.current
    if (!p) return
    const here = currentDocId === p.docId
    if (Date.now() > p.until || (!here && (p.arrived || currentDocId !== p.from))) {
      pendingRef.current = null
      return
    }
    if (here) p.arrived = true
    if (!here || blocked || liveStatus !== 'live' || !editorRef.current) return
    pendingRef.current = null
    void startPull(p.docId)
  })

  return { state, startPull, requestPull, dialog: { state, onCancel, onApply } satisfies GithubPullDialogProps }
}
