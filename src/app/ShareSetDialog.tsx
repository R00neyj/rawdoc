// D-6 함께 공유할 문서 대화상자 (specs/features/F-252.md 3장)
import { useEffect, useRef, useState } from 'react'
import Dialog from './Dialog'
import { fetchShareSet, type ShareSetNode } from './shareSetApi'
import { getShareLink, createShareLink } from './linkApi'
import type { Notice } from './notice'

const INDENT_PX = 16

type ShareSetDialogProps = {
  open: boolean
  docId: string | null
  onClose: () => void
  onNotice: (notice: Notice) => void
  onLinked?: () => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; nodes: ShareSetNode[]; truncated: boolean }

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((id, i) => id === sortedB[i])
}

function collectDescendants(id: string, children: Map<string, string[]>): string[] {
  const kids = children.get(id) ?? []
  return kids.flatMap((k) => [k, ...collectDescendants(k, children)])
}

export default function ShareSetDialog({ open, docId, onClose, onNotice, onLinked }: ShareSetDialogProps) {
  const titleId = 'share-set-title'
  const copyBtnRef = useRef<HTMLButtonElement | null>(null)
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [existingDocIds, setExistingDocIds] = useState<string[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [requestId, setRequestId] = useState(0)

  // 열릴 때마다 처음부터 다시 찾는다 — 렌더 중 open 전이 감지로 갱신한다(React "Adjusting state when a prop changes" 패턴, MoveDocDialog.tsx 와 동일)
  const [trackedOpen, setTrackedOpen] = useState(open)
  if (open !== trackedOpen) {
    setTrackedOpen(open)
    if (open) {
      setState({ status: 'loading' })
      setChecked(new Set())
      setExistingDocIds(null)
      setRequestId((n) => n + 1)
    }
  }

  useEffect(() => {
    if (!open || !docId) return
    let cancelled = false
    Promise.all([fetchShareSet(docId), getShareLink(docId).catch(() => null)])
      .then(([preview, link]) => {
        if (cancelled) return
        setState({ status: 'ready', nodes: preview.nodes, truncated: preview.truncated })
        const validIds = new Set(preview.nodes.map((n) => n.id))
        const initial = link ? link.docIds.filter((id) => validIds.has(id)) : []
        setChecked(new Set(initial))
        setExistingDocIds(link ? link.docIds : null)
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [open, docId, requestId])

  const nodes = state.status === 'ready' ? state.nodes : []
  const nodesById = new Map(nodes.map((n) => [n.id, n]))
  const childrenMap = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.parentId !== null) {
      const arr = childrenMap.get(n.parentId) ?? []
      arr.push(n.id)
      childrenMap.set(n.parentId, arr)
    }
  }

  function isActive(id: string): boolean {
    const node = nodesById.get(id)
    if (!node) return false
    if (node.parentId === null || node.parentId === docId) return true
    if (!checked.has(node.parentId)) return false
    return isActive(node.parentId)
  }

  function handleToggle(id: string, next: boolean) {
    setChecked((prev) => {
      const nextSet = new Set(prev)
      if (next) {
        nextSet.add(id)
      } else {
        nextSet.delete(id)
        for (const descId of collectDescendants(id, childrenMap)) nextSet.delete(descId)
      }
      return nextSet
    })
  }

  const effectiveIds = nodes.filter((n) => isActive(n.id) && checked.has(n.id)).map((n) => n.id)
  const showWarning = existingDocIds !== null && !sameIdSet(existingDocIds, effectiveIds)

  async function handleCopy() {
    if (!docId) return
    setSubmitting(true)
    let token: string
    try {
      token = await createShareLink(docId, effectiveIds)
    } catch {
      onNotice({ type: 'error', message: '링크를 만들지 못했습니다. 연결을 확인하세요.' })
      setSubmitting(false)
      return
    }
    const link = `${location.origin}/p/${token}`
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      onNotice({ type: 'error', message: '복사하지 못했습니다. 브라우저 권한을 확인하세요.' })
      setSubmitting(false)
      return
    }
    setSubmitting(false)
    onLinked?.()
    onClose()
    onNotice({
      type: 'info',
      message:
        effectiveIds.length > 0
          ? `읽기 전용 링크를 복사했습니다. 문서 ${effectiveIds.length + 1}개가 함께 열립니다.`
          : '읽기 전용 링크를 복사했습니다. 링크를 아는 사람은 로그인 없이 볼 수 있습니다.',
    })
  }

  return (
    <Dialog open={open} onClose={onClose} titleId={titleId} initialFocusRef={copyBtnRef} size="wide">
      <h2 id={titleId}>함께 공유할 문서</h2>
      <p>이 문서의 위키링크가 가리키는 문서입니다. 선택한 문서만 링크로 함께 열립니다.</p>
      {state.status === 'loading' && <p className="share-set-notice">찾는 중…</p>}
      {state.status === 'error' && (
        <div className="share-set-notice share-set-error">
          <p>문서를 불러오지 못했습니다. 연결을 확인하세요.</p>
          <button
            type="button"
            onClick={() => {
              setState({ status: 'loading' })
              setRequestId((n) => n + 1)
            }}
          >
            다시 시도
          </button>
        </div>
      )}
      {state.status === 'ready' && (
        <>
          <ul className="share-set-list">
            {nodes.map((node) => {
              const active = isActive(node.id)
              const isChecked = active && checked.has(node.id)
              const title = node.title.trim() === '' ? '제목 없는 문서' : node.title
              return (
                <li key={node.id} className="share-set-row" style={{ paddingLeft: node.depth * INDENT_PX }}>
                  <label>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={!active}
                      onChange={(e) => handleToggle(node.id, e.target.checked)}
                    />
                    {title}
                  </label>
                </li>
              )
            })}
          </ul>
          {state.truncated && <p className="share-set-truncated">링크가 많아 일부만 보여줍니다.</p>}
          {showWarning && (
            <p className="share-set-warning">이미 이 주소를 아는 사람도 방금 선택한 문서를 보게 됩니다.</p>
          )}
        </>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          취소
        </button>
        <button type="button" ref={copyBtnRef} disabled={state.status !== 'ready' || submitting} onClick={handleCopy}>
          링크 복사
        </button>
      </div>
    </Dialog>
  )
}
