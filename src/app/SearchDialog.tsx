// 검색 대화상자 D-6 (specs/features/F-287.md 4장) — 인덱스 만들기·검색 실행·결과 그리기·키보드
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import Dialog from './Dialog'
import { IconSearch } from './icons'
import { parseSearchQuery, searchDocs, type SnippetPart, type SearchOutcome } from '../lib/docSearch'
import { buildSearchIndex, type SearchIndex, type SearchSource } from './searchIndex'
import { buildResultRows, nextResultIndex } from './searchResults'

const DEBOUNCE_MS = 150

type SearchDialogProps = {
  open: boolean
  store: SearchSource
  scope: string
  beforeIndex: () => Promise<void>
  onOpenDoc: (id: string) => void
  onClose: () => void
  // 이미 열려 있을 때 Ctrl+Shift+F 를 다시 누르면 App 이 이 ref 를 통해 검색어 전체 선택을 시킨다 (3.4)
  selectQueryRef: RefObject<() => void>
}

function renderParts(parts: SnippetPart[]) {
  return parts.map((part, i) =>
    part.hit ? (
      <mark key={i} className="search-hit">
        {part.text}
      </mark>
    ) : (
      <span key={i}>{part.text}</span>
    ),
  )
}

export default function SearchDialog({ open, store, scope, beforeIndex, onOpenDoc, onClose, selectQueryRef }: SearchDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const resultRefs = useRef<(HTMLLIElement | null)[]>([])

  const [query, setQuery] = useState('') // 입력 그대로
  const [term, setTerm] = useState('') // 150ms 뒤 값
  const [index, setIndex] = useState<SearchIndex | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState(-1)

  useEffect(() => {
    selectQueryRef.current = () => inputRef.current?.select()
  })

  // open 전환에 맞춰 렌더 중 상태를 조정한다(useDocSaver.ts 와 같은 패턴) — 열리면 인덱스를 비우고, 닫히면 검색어·선택 자리를 비운다 (4.2·4.7)
  const [trackedOpen, setTrackedOpen] = useState(open)
  if (open !== trackedOpen) {
    setTrackedOpen(open)
    if (open) {
      setIndex(null)
      setFailed(false)
    } else {
      setQuery('')
      setTerm('')
      setSelected(-1)
    }
  }

  // 여는 순서가 이 명세에서 가장 중요한 결정이다: setState(이미 열림, 위) → flush → 인덱스 (4.2)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        await beforeIndex()
      } catch {
        // 삼킨다 — 실패해도 인덱스 만들기는 계속한다 (4.2)
      }
      if (cancelled) return
      try {
        const built = await buildSearchIndex({ store, scope })
        if (!cancelled) setIndex(built)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, store, scope, beforeIndex])

  // 디바운스는 검색 실행에만 건다 — 인덱스 만들기는 열 때 한 번이라 걸 곳이 없다 (4.3)
  useEffect(() => {
    const id = setTimeout(() => setTerm(query), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  const parsed = useMemo(() => parseSearchQuery(term), [term])
  const outcome = useMemo(() => (index ? searchDocs(index.entries, parsed) : null), [index, parsed])
  const rows = useMemo(() => (index && outcome ? buildResultRows(index.entries, outcome, parsed) : []), [index, outcome, parsed])

  // 결과가 바뀔 때마다 선택 자리를 0번(첫 결과)으로 — 같은 렌더 중 조정 패턴
  const [trackedOutcome, setTrackedOutcome] = useState<SearchOutcome | null>(null)
  if (outcome !== trackedOutcome) {
    setTrackedOutcome(outcome)
    setSelected(rows.length > 0 ? 0 : -1)
  }

  useEffect(() => {
    if (selected < 0) return
    resultRefs.current[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((current) => nextResultIndex(current, rows.length, e.key))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (selected >= 0 && rows[selected]) onOpenDoc(rows[selected].id)
    }
  }

  // 상태 문구 3개 — 인덱스가 아직 없는 동안 입력하면(loading) 아무 문구도 보이지 않는다(빈 영역, 4.3)
  let status: string | null = null
  if (parsed.isEmpty) status = '검색어를 입력하세요'
  else if (index && rows.length === 0) status = '찾는 문서가 없습니다'
  if (failed) status = '문서를 읽지 못했습니다'

  return (
    <Dialog open={open} onClose={onClose} titleId="search-dialog-title" size="wide" initialFocusRef={inputRef}>
      <div className="search-dialog">
        <h2 id="search-dialog-title">검색</h2>
        <div className="search-input-row">
          <IconSearch size={18} />
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={rows.length > 0}
            aria-controls="search-result-list"
            aria-activedescendant={selected >= 0 ? `search-result-${selected}` : undefined}
            aria-label="검색어"
            placeholder="검색어 또는 tag:값"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        {status && <p className="search-status">{status}</p>}
        {!status && (
          <ul id="search-result-list" role="listbox" aria-label="검색 결과" className="search-results">
            {rows.map((row, i) => (
              <li
                key={row.id}
                id={`search-result-${i}`}
                role="option"
                aria-selected={i === selected}
                ref={(el) => {
                  resultRefs.current[i] = el
                }}
                className={`search-result${i === selected ? ' search-result--on' : ''}`}
                onClick={() => onOpenDoc(row.id)}
              >
                <span className="search-result-head">
                  <span className="search-result-title">{renderParts(row.titleParts)}</span>
                  <span className="search-result-meta">
                    {row.shared && <span className="search-result-shared">공유받음</span>}
                    {row.folderPath && <span className="search-result-path">{row.folderPath}</span>}
                    <span className="search-result-date">{row.date}</span>
                  </span>
                </span>
                {row.snippet.length > 0 && <span className="search-result-snippet">{renderParts(row.snippet)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
