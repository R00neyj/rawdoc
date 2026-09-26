// 멘션 후보 목록을 단 textarea (specs/features/F-507.md 3.5·5장). MentionSourceContext 가 null 이면 평범한 textarea
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  type SyntheticEvent,
} from 'react'
import {
  applyMentionPick,
  filterMentionCandidates,
  mentionLimitReached,
  mentionTokenAt,
  type MentionPerson,
  type MentionToken,
  type PeopleCache,
} from './mentionCandidates'

export type MentionSource = { docId: string; selfEmail: string; people: PeopleCache }
// eslint-disable-next-line react-refresh/only-export-components -- 명세(F-507 3.5)가 이 컨텍스트를 이 파일에 두게 했다
export const MentionSourceContext = createContext<MentionSource | null>(null)

export type MentionFieldProps = {
  value: string
  onChange: (value: string) => void
  picked: readonly string[] // 이 입력에서 고른 이메일 (중복 허용)
  onPickedChange: (picked: string[]) => void
  onKeyDown?: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void // 목록이 먹지 않은 키만 온다
  textareaRef?: Ref<HTMLTextAreaElement>
  className?: string
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
}

let mentionFieldSeq = 0

function setForwardedRef(ref: Ref<HTMLTextAreaElement> | undefined, el: HTMLTextAreaElement | null) {
  if (!ref) return
  if (typeof ref === 'function') ref(el)
  else (ref as { current: HTMLTextAreaElement | null }).current = el
}

export default function MentionField({
  value,
  onChange,
  picked,
  onPickedChange,
  onKeyDown,
  textareaRef,
  className,
  placeholder,
  ariaLabel,
  disabled,
}: MentionFieldProps) {
  const source = useContext(MentionSourceContext)
  const innerRef = useRef<HTMLTextAreaElement | null>(null)
  const composingRef = useRef(false)
  const [listId] = useState(() => `mention-candidates-${++mentionFieldSeq}`)
  const [token, setToken] = useState<MentionToken | null>(null)
  const [closedTokenStart, setClosedTokenStart] = useState<number | null>(null)
  const [requestedTokenStart, setRequestedTokenStart] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [people, setPeople] = useState<readonly MentionPerson[] | null>(null)
  const [highlight, setHighlight] = useState(0)

  function recalcToken(el: HTMLTextAreaElement) {
    if (!source) return
    if (el.selectionStart !== el.selectionEnd) {
      setToken(null)
      return
    }
    setToken(mentionTokenAt(el.value, el.selectionStart))
  }

  const listOpen = source !== null && token !== null && token.start !== closedTokenStart

  // 렌더 중 조정 — 새 토큰이 열리면 그 순간 로딩으로 표시하고 요청 대상을 기록한다(요청 자체는 아래 effect)
  if (listOpen && token && token.start !== requestedTokenStart) {
    setRequestedTokenStart(token.start)
    setLoading(true)
    setPeople(null)
  }

  // 후보 불러오기 — 그 문서에서 처음 이 토큰이 열릴 때 한 번 (5.2)
  useEffect(() => {
    if (!source || requestedTokenStart === null) return
    const docId = source.docId
    const tokenStart = requestedTokenStart
    let cancelled = false
    source.people.get(docId).then((result) => {
      if (cancelled) return
      setLoading(false)
      if (result === null) {
        setClosedTokenStart(tokenStart) // 실패 — 이 토큰에서는 다시 열지 않는다 (5.2)
      } else {
        setPeople(result)
      }
    })
    return () => {
      cancelled = true
    }
  }, [source, requestedTokenStart])

  // 렌더 중 조정 — 토큰(시작·질의)이 바뀌면 강조를 처음으로
  const tokenIdentity = token ? `${token.start}:${token.query}` : null
  const [highlightFor, setHighlightFor] = useState(tokenIdentity)
  if (highlightFor !== tokenIdentity) {
    setHighlightFor(tokenIdentity)
    setHighlight(0)
  }

  function computeContent(): { message: string | null; options: MentionPerson[] } {
    if (!source || !token) return { message: null, options: [] }
    if (mentionLimitReached(value, picked)) return { message: '멘션은 한 댓글에 10명까지 할 수 있습니다.', options: [] }
    if (loading) return { message: '불러오는 중…', options: [] }
    if (people === null) return { message: null, options: [] }
    const others = people.filter((p) => p.email.toLowerCase() !== source.selfEmail.toLowerCase())
    if (others.length === 0) return { message: '이 문서에 접근할 수 있는 다른 사람이 없습니다.', options: [] }
    const filtered = filterMentionCandidates(people, token.query, source.selfEmail)
    if (filtered.length === 0) return { message: '맞는 사람이 없습니다.', options: [] }
    return { message: null, options: filtered }
  }

  const { message, options } = listOpen ? computeContent() : { message: null, options: [] }

  function pick(email: string) {
    if (!token) return
    const applied = applyMentionPick(value, token, email)
    onChange(applied.text)
    onPickedChange([...picked, email])
    setToken(null)
    setClosedTokenStart(null)
    const el = innerRef.current
    if (el) {
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(applied.caret, applied.caret)
      })
    }
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value)
    if (composingRef.current) return
    recalcToken(e.target)
  }

  function handleSelect(e: SyntheticEvent<HTMLTextAreaElement>) {
    if (composingRef.current) return
    recalcToken(e.currentTarget)
  }

  function handleCompositionEnd(e: CompositionEvent<HTMLTextAreaElement>) {
    composingRef.current = false
    recalcToken(e.currentTarget)
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) {
      onKeyDown?.(e)
      return
    }
    if (listOpen && token) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setClosedTokenStart(token.start)
        return
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        setClosedTokenStart(token.start)
        onKeyDown?.(e)
        return
      }
      if (options.length > 0) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const delta = e.key === 'ArrowDown' ? 1 : -1
          setHighlight((h) => (h + delta + options.length) % options.length)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          pick(options[highlight].email)
          return
        }
      }
      onKeyDown?.(e)
      return
    }
    onKeyDown?.(e)
  }

  const activeOptionId = listOpen && options.length > 0 ? `${listId}-opt-${highlight}` : undefined

  return (
    <>
      <textarea
        ref={(el) => {
          innerRef.current = el
          setForwardedRef(textareaRef, el)
        }}
        className={className}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        readOnly={disabled}
        onChange={handleChange}
        onSelect={handleSelect}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        aria-autocomplete={source ? 'list' : undefined}
        aria-expanded={source ? listOpen : undefined}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={activeOptionId}
      />
      {listOpen && (
        <ul className="mention-candidates" role="listbox" aria-label="멘션 후보" id={listId}>
          {message !== null ? (
            <li className="mention-candidates-status" role="presentation">
              {message}
            </li>
          ) : (
            options.map((p, i) => (
              <li
                key={p.email}
                id={`${listId}-opt-${i}`}
                className="mention-candidate"
                role="option"
                aria-selected={i === highlight}
                data-email={p.email}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p.email)}
              >
                {p.email}
              </li>
            ))
          )}
        </ul>
      )}
    </>
  )
}
