// 댓글 카드 하나 — 첫 댓글·답글·해결 버튼·`⋯` 메뉴·답글 입력칸 (specs/features/F-505.md 3장·7.2~7.4)
import { useContext, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import FolderMenu from './FolderMenu'
import Dialog from './Dialog'
import {
  commentAllowed,
  COMMENT_BODY_MAX,
  normalizeCommentBody,
  type CommentActor,
  type CommentCapacityError,
  type CommentThread as CommentThreadData,
} from '../lib/docComments'
import { formatCommentTime } from './commentRail'
import { COMMENT_TEXT, CommentCommandContext, type CommentWriteFailure } from './useDocComments'

function authorLabel(author: { id: string | null; email: string | null }): string {
  return author.id === null ? '나' : (author.email ?? '나')
}

function capacityMessage(err: CommentCapacityError): string {
  return err === 'doc_full' ? COMMENT_TEXT.docFull : COMMENT_TEXT.threadFull
}

type ReplyPending = { sending: boolean; error: CommentWriteFailure | null } | null

type CommentThreadProps = {
  thread: CommentThreadData
  active: boolean
  isOrphan: boolean
  now: number
  actor: CommentActor | null
  canWrite: boolean
  replyPending: ReplyPending
  replyCapacity: CommentCapacityError | null
  onActivate: () => void
  onToggleResolve: () => void
  onStartReply: () => void
  onSendReply: (body: string) => void
  onDelete: (id: string) => void
  onEscapeToEditor: () => void
}

export default function CommentThread({
  thread,
  active,
  isOrphan,
  now,
  actor,
  canWrite,
  replyPending,
  replyCapacity,
  onActivate,
  onToggleResolve,
  onStartReply,
  onSendReply,
  onDelete,
  onEscapeToEditor,
}: CommentThreadProps) {
  const headId = `comment-thread-head-${thread.id}`
  const resolved = thread.root.resolved !== null
  const canDeleteRoot = actor !== null && commentAllowed(actor, 'delete', thread.root)
  const [replyValue, setReplyValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; replyCount: number } | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const { disconnected, busy } = useContext(CommentCommandContext)
  // 명령 삭제는 응답을 기다린다 — 대화상자는 끝날 때 닫힌다 (F-506 7.2)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  if (deletingId !== null && !busy.has(deletingId)) {
    setDeletingId(null)
    setConfirmDelete(null)
  }

  // 렌더 중 상태 조정(react-hooks/set-state-in-effect 회피) — active 가 꺼지거나 답글 전송이 성공하면 입력칸을 비운다
  const [priorActive, setPriorActive] = useState(active)
  const [wasSending, setWasSending] = useState(false)
  const sending = Boolean(replyPending?.sending)
  if (priorActive !== active) {
    setPriorActive(active)
    if (!active) setReplyValue('')
  }
  if (wasSending !== sending) {
    setWasSending(sending)
    if (wasSending && !sending && replyPending === null) setReplyValue('')
  }

  const normalizedReply = normalizeCommentBody(replyValue)
  const replySendDisabled =
    normalizedReply.length === 0 ||
    normalizedReply.length > COMMENT_BODY_MAX ||
    Boolean(replyPending?.sending) ||
    replyCapacity !== null ||
    disconnected
  // 입력칸 아래 줄은 하나만 — 보내는 중 > C4 > F-505 의 것 (F-506 7.2)
  const replyNote = replyPending?.sending
    ? COMMENT_TEXT.sending
    : disconnected
      ? COMMENT_TEXT.offline
      : normalizedReply.length > COMMENT_BODY_MAX
        ? COMMENT_TEXT.tooLong
        : replyCapacity
          ? capacityMessage(replyCapacity)
          : replyPending?.error && replyPending.error !== 'offline'
            ? COMMENT_TEXT.invalid
            : null
  const replyNoteIsStatus = Boolean(replyPending?.sending) || disconnected

  function submitReply() {
    if (replySendDisabled) return
    onStartReply()
    onSendReply(replyValue)
  }

  function handleCardClick(e: ReactMouseEvent) {
    if ((e.target as HTMLElement).closest('button, textarea, .item-menu, .dialog')) return
    onActivate()
  }

  function handleCardKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'Enter' && e.target === e.currentTarget) onActivate()
    if (e.key === 'Escape' && e.target === e.currentTarget) {
      e.preventDefault()
      onEscapeToEditor()
    }
  }

  return (
    <article
      className="comment-thread"
      tabIndex={0}
      data-thread-id={thread.id}
      data-active={active ? 'true' : undefined}
      data-resolved={resolved ? 'true' : undefined}
      aria-current={active ? 'true' : undefined}
      aria-labelledby={headId}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
    >
      <header id={headId} className="comment-thread-head">
        <span className="comment-thread-author">{authorLabel(thread.root.author)}</span>
        <span className="comment-thread-time">{formatCommentTime(thread.root.createdAt, now)}</span>
        {canWrite && (
          <button type="button" className="comment-thread-resolve" disabled={disconnected || busy.has(thread.id)} onClick={onToggleResolve}>
            {resolved ? '다시 열기' : '해결'}
          </button>
        )}
        {canDeleteRoot && (
          <FolderMenu
            label="댓글"
            items={[
              {
                key: 'delete',
                label: '삭제',
                danger: true,
                disabled: disconnected,
                onSelect: () => {
                  if (!disconnected) setConfirmDelete({ id: thread.id, replyCount: thread.replies.length })
                },
              },
            ]}
          />
        )}
      </header>
      {resolved && (
        <p className="comment-thread-resolved-by">
          {thread.root.resolved!.by.id === null ? '해결함' : `${thread.root.resolved!.by.email}님이 해결함`}
        </p>
      )}
      <div className="comment-thread-body">
        {isOrphan && (
          <>
            <p className="comment-thread-quote">
              <del>{thread.root.quote}</del>
            </p>
            <p className="comment-thread-orphan-note">댓글을 단 부분이 지워졌습니다.</p>
          </>
        )}
        <p className={active ? 'comment-thread-text' : 'comment-thread-text comment-thread-text--clamp'}>{thread.root.body}</p>
      </div>
      {!active && thread.replies.length > 0 && <p className="comment-thread-reply-count">답글 {thread.replies.length}개</p>}
      {active &&
        thread.replies.map((r) => {
          const canDeleteReply = actor !== null && commentAllowed(actor, 'delete', r.entry)
          return (
            <div className="comment-reply" data-comment-id={r.id} key={r.id}>
              <span className="comment-reply-author">{authorLabel(r.entry.author)}</span>
              <span className="comment-reply-time">{formatCommentTime(r.entry.createdAt, now)}</span>
              <p className="comment-reply-text">{r.entry.body}</p>
              {canDeleteReply && (
                <FolderMenu
                  label="답글"
                  items={[
                    {
                      key: 'delete',
                      label: '삭제',
                      danger: true,
                      disabled: disconnected,
                      onSelect: () => {
                        if (!disconnected) setConfirmDelete({ id: r.id, replyCount: 0 })
                      },
                    },
                  ]}
                />
              )}
            </div>
          )
        })}
      {active && canWrite && (
        <div className="comment-reply-composer">
          <textarea
            className="comment-reply-input"
            placeholder="답글을 입력하세요."
            value={replyValue}
            readOnly={sending}
            onChange={(e) => setReplyValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                submitReply()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setReplyValue('')
                ;(e.currentTarget.closest('.comment-thread') as HTMLElement | null)?.focus()
              }
            }}
          />
          <button type="button" className="comment-reply-send" disabled={replySendDisabled} onClick={submitReply}>
            답글
          </button>
          {replyNote !== null && <p className={replyNoteIsStatus ? 'comment-reply-error comment-reply-note' : 'comment-reply-error'}>{replyNote}</p>}
        </div>
      )}
      <Dialog
        open={confirmDelete !== null}
        onClose={() => {
          if (deletingId === null) setConfirmDelete(null)
        }}
        titleId={`comment-delete-title-${thread.id}`}
        initialFocusRef={cancelRef}
      >
        <h2 id={`comment-delete-title-${thread.id}`}>댓글 삭제</h2>
        <p>
          {confirmDelete && confirmDelete.id === thread.id && confirmDelete.replyCount >= 1
            ? `이 댓글과 답글 ${confirmDelete.replyCount}개를 지웁니다. 되돌릴 수 없습니다.`
            : '이 댓글을 지웁니다. 되돌릴 수 없습니다.'}
        </p>
        <div className="dialog-actions">
          <button type="button" ref={cancelRef} onClick={() => setConfirmDelete(null)}>
            취소
          </button>
          <button
            type="button"
            className="danger"
            disabled={deletingId !== null}
            onClick={() => {
              if (!confirmDelete) return
              setDeletingId(confirmDelete.id)
              onDelete(confirmDelete.id)
            }}
          >
            삭제
          </button>
        </div>
      </Dialog>
    </article>
  )
}
