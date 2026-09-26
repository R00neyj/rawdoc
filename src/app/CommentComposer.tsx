// 새 댓글 입력 카드 (specs/features/F-505.md 3장·7.1, F-500 5.1). F-507 이 멘션 후보를 더한다
import { useEffect, useRef, useState } from 'react'
import { COMMENT_BODY_COUNTER_FROM } from './commentRail'
import { COMMENT_BODY_MAX, normalizeCommentBody } from '../lib/docComments'
import { COMMENT_TEXT, type CommentWriteFailure } from './useDocComments'

function failureMessage(reason: CommentWriteFailure): string {
  switch (reason) {
    case 'too_long':
      return COMMENT_TEXT.tooLong
    case 'doc_full':
      return COMMENT_TEXT.docFull
    case 'thread_full':
      return COMMENT_TEXT.threadFull
    case 'gone':
      return COMMENT_TEXT.gone
    case 'invalid':
      return COMMENT_TEXT.invalid
    default:
      return COMMENT_TEXT.invalid
  }
}

type CommentComposerProps = {
  sending: boolean
  error: CommentWriteFailure | null
  mentionable: boolean
  onSend: (body: string) => void
  onCancel: () => void
}

export default function CommentComposer({ sending, error, mentionable, onSend, onCancel }: CommentComposerProps) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const normalized = normalizeCommentBody(value)
  const len = normalized.length
  const disabled = len === 0 || len > COMMENT_BODY_MAX || sending
  const placeholder = mentionable ? '댓글을 입력하세요. @로 사람을 멘션할 수 있습니다.' : '댓글을 입력하세요.'

  function send() {
    if (disabled) return
    onSend(value)
  }

  return (
    <div className="comment-composer">
      <textarea
        ref={ref}
        className="comment-composer-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            send()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
      />
      <div className="comment-composer-foot">
        {len >= COMMENT_BODY_COUNTER_FROM && (
          <span className="comment-composer-counter">
            {len}/{COMMENT_BODY_MAX}
          </span>
        )}
        <span className="comment-composer-buttons">
          <button type="button" className="comment-composer-cancel" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="comment-composer-send" disabled={disabled} onClick={send}>
            댓글 달기
          </button>
        </span>
      </div>
      {(len > COMMENT_BODY_MAX || error) && (
        <p className="comment-composer-error">{len > COMMENT_BODY_MAX ? COMMENT_TEXT.tooLong : failureMessage(error!)}</p>
      )}
    </div>
  )
}
