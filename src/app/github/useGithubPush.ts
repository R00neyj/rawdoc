// GitHub 푸시 대화상자 상태·열기·푸시 (specs/features/F-2130.md 4장)
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { EditorHandle } from '../../editor/Editor'
import type { GithubPushPlan, GithubLink } from '../../lib/github/githubContract'
import type { LineEnding } from '../../lib/lineEnding'
import { postDocGithubBlob, postDocGithubPlan, postDocGithubPush, type GithubResult } from './githubApi'
import { mergedTooLarge } from './githubPull'
import { pushedNotice, pushFailureMessage, pushImageNames, pushMdBytes, PUSH_OFFLINE_MESSAGE, readConflict, runGithubPush, type PushOutcome, type PushStep } from './githubPush'
import { GITHUB_TOO_LARGE_MESSAGE } from './githubUi'
import type { NoticeWithAction } from '../notices/NoticeBar'
import type { LiveStatus } from '../topbar/StatusBar'

export type GithubPushView = {
  docId: string
  target: string
  message: string
  plan: GithubPushPlan | null
  checking: boolean
  progress: string | null
  error: string | null
  conflict: { gone: boolean } | null
  busy: boolean
}
export type GithubPushDialogProps = {
  state: GithubPushView | null
  onMessage(m: string): void
  onPush(): void
  onPull(): void
  onCancel(): void
}

type PushEditor = Pick<EditorHandle, 'getText'>
export type UseGithubPushOptions = {
  editorRef: RefObject<PushEditor | null>
  liveStatus: LiveStatus | null
  currentDocId: string | null
  lineEnding: LineEnding
  blocked: boolean
  showNotice: (input: NoticeWithAction) => number
  watch: <T>(r: GithubResult<T>) => GithubResult<T>
  linkOf: (docId: string) => GithubLink | null
  flush: () => Promise<void>
  readAttachment: (name: string) => Promise<Uint8Array | null>
  onPushed: (docId: string, sha: string) => void
  startPull: (docId: string) => Promise<void>
}

const DOC_CHANGED = '문서가 바뀌어 푸시를 멈췄습니다'

function stepText(s: PushStep): string {
  if (s.kind === 'md') return '파일 보내는 중…'
  if (s.kind === 'image') return `그림 보내는 중 (${s.index}/${s.total})`
  return 'GitHub에 기록하는 중…'
}

export function useGithubPush(o: UseGithubPushOptions) {
  const [state, setStateRaw] = useState<GithubPushView | null>(null)
  const stateRef = useRef<GithubPushView | null>(null)
  const draftsRef = useRef(new Map<string, string>())
  const seqRef = useRef(0)
  const optsRef = useRef(o)
  useEffect(() => {
    optsRef.current = o
  })

  const setState = useCallback((next: GithubPushView | null) => {
    stateRef.current = next
    setStateRaw(next)
  }, [])
  const patch = useCallback((p: Partial<GithubPushView>) => {
    if (stateRef.current) setState({ ...stateRef.current, ...p })
  }, [setState])

  const openPush = useCallback(
    async (docId: string) => {
      const { liveStatus, editorRef, showNotice, watch, linkOf, flush, blocked } = optsRef.current
      if (stateRef.current || blocked) return
      const link = linkOf(docId)
      const editor = editorRef.current
      if (!link || !editor || liveStatus !== 'live') {
        showNotice({ type: 'error', message: PUSH_OFFLINE_MESSAGE })
        return
      }
      const seq = ++seqRef.current
      setState({
        docId, target: `${link.repo} · ${link.branch} · ${link.path}`, message: draftsRef.current.get(docId) ?? '', plan: null, checking: true,
        progress: null, error: null, conflict: null, busy: false,
      })
      await flush()
      const names = pushImageNames(editor.getText('lf'))
      const r = watch(await postDocGithubPlan(docId, names))
      const cur = stateRef.current as GithubPushView | null
      if (seqRef.current !== seq || cur?.docId !== docId || !cur.checking) return
      if (r.ok) return patch({ plan: r.value, checking: false })
      const conflict = readConflict(r)
      patch(conflict ? { conflict, checking: false } : { error: pushFailureMessage(r), checking: false })
    },
    [patch, setState],
  )

  // 대화상자 없이도 쓰는 본체 — 연결하고 바로 첫 커밋 (small 2026-10-13)
  const send = useCallback(async (docId: string, text: string, message: string, progress: (s: PushStep) => void): Promise<PushOutcome> => {
    const { showNotice, watch, linkOf, flush, readAttachment, onPushed } = optsRef.current
    await flush()
    const bom = linkOf(docId)?.remoteBom ?? false
    const outcome = await runGithubPush(
      { md: pushMdBytes(text, bom), names: pushImageNames(text), message },
      {
        plan: async (names) => watch(await postDocGithubPlan(docId, names)),
        blob: async (body) => watch(await postDocGithubBlob(docId, body)),
        push: async (body) => watch(await postDocGithubPush(docId, body)),
        readAttachment,
        progress,
      },
    )
    if (outcome.kind !== 'pushed') return outcome
    onPushed(docId, outcome.sha)
    const url = outcome.commitUrl
    showNotice({
      type: 'info',
      message: pushedNotice(outcome),
      ...(url ? { action: { label: 'GitHub에서 보기', onClick: () => window.open(url, '_blank', 'noopener') } } : {}),
    })
    return outcome
  }, [])

  const onMessage = useCallback((message: string) => {
    const s = stateRef.current
    if (!s) return
    draftsRef.current.set(s.docId, message)
    setState({ ...s, message })
  }, [setState])

  const onPush = useCallback(async () => {
    const s = stateRef.current
    if (!s || s.busy || s.conflict || s.message.trim() === '') return
    const { currentDocId, liveStatus, editorRef, lineEnding, showNotice } = optsRef.current
    const editor = editorRef.current
    if (currentDocId !== s.docId || !editor) {
      setState(null)
      showNotice({ type: 'error', message: DOC_CHANGED })
      return
    }
    if (liveStatus !== 'live') return patch({ error: PUSH_OFFLINE_MESSAGE })
    const text = editor.getText(lineEnding)
    if (mergedTooLarge(editor.getText('lf'), lineEnding)) return patch({ error: GITHUB_TOO_LARGE_MESSAGE })
    patch({ busy: true, error: null, conflict: null, progress: null })
    const outcome = await send(s.docId, text, s.message, (step) => patch({ progress: stepText(step) }))
    if (outcome.kind === 'pushed') {
      setState(null)
      draftsRef.current.delete(s.docId)
    } else if (outcome.kind === 'conflict') patch({ busy: false, progress: null, conflict: { gone: outcome.gone } })
    else patch({ busy: false, progress: null, error: outcome.message })
  }, [patch, setState, send])

  // 지금 편집기 본문을 바로 푸시 — 실시간이 아니면 null (small 2026-10-13)
  const pushCurrent = useCallback(async (docId: string, message: string): Promise<PushOutcome | null> => {
    const { currentDocId, liveStatus, editorRef, lineEnding } = optsRef.current
    const editor = editorRef.current
    if (currentDocId !== docId || !editor || liveStatus !== 'live') return null
    if (mergedTooLarge(editor.getText('lf'), lineEnding)) return { kind: 'failed', message: GITHUB_TOO_LARGE_MESSAGE }
    return send(docId, editor.getText(lineEnding), message, () => {})
  }, [send])

  const onPull = useCallback(() => {
    const s = stateRef.current
    if (!s || s.busy || !s.conflict || s.conflict.gone) return
    setState(null)
    void optsRef.current.startPull(s.docId)
  }, [setState])

  const onCancel = useCallback(() => {
    if (stateRef.current && !stateRef.current.busy) setState(null)
  }, [setState])

  return {
    state,
    openPush,
    send,
    pushCurrent,
    dialog: { state, onMessage, onPush: () => void onPush(), onPull, onCancel } satisfies GithubPushDialogProps,
  }
}
