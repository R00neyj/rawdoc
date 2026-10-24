// 시작 문서 고르기 — 제목으로 거르는 combobox + listbox, 명령 팔레트 클래스를 쓴다 (small 2026-10-14)
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import Dialog from '../Dialog'
import { IconSearch } from '../icons'
import { filterPickerDocs, type PickerDoc } from './docPicker'
import { nextResultIndex } from '../searchResults'

const UNTITLED = '제목 없는 문서'

type DocPickerDialogProps = {
  open: boolean
  docs: readonly PickerDoc[]
  onPick: (id: string) => void
  onClose: () => void
}

export default function DocPickerDialog({ open, docs, onPick, onClose }: DocPickerDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const itemRefs = useRef<(HTMLLIElement | null)[]>([])
  const [query, setQuery] = useState('')
  const rows = useMemo(() => filterPickerDocs(docs, query), [docs, query])
  const [selected, setSelected] = useState(0)

  // 닫히면 검색어를, 결과가 바뀌면 선택 자리를 첫 행으로 — 렌더 중 조정
  const [trackedOpen, setTrackedOpen] = useState(open)
  if (open !== trackedOpen) {
    setTrackedOpen(open)
    if (!open) setQuery('')
  }
  const [trackedRows, setTrackedRows] = useState(rows)
  if (rows !== trackedRows) {
    setTrackedRows(rows)
    setSelected(rows.length > 0 ? 0 : -1)
  }

  useEffect(() => {
    if (selected >= 0) itemRefs.current[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((current) => nextResultIndex(current, rows.length, e.key))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (rows[selected]) onPick(rows[selected].id)
    }
  }

  const status = rows.length > 0 ? null : query.trim() !== '' ? '맞는 문서가 없습니다' : '고를 문서가 없습니다'

  return (
    <Dialog open={open} onClose={onClose} titleId="doc-picker-title" size="wide" initialFocusRef={inputRef}>
      <div className="doc-picker">
        <div className="command-palette-head">
          <h2 id="doc-picker-title">시작 문서 고르기</h2>
        </div>
        <div className="search-input-row">
          <IconSearch size={18} />
          <input
            ref={inputRef}
            className="doc-picker-input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={rows.length > 0}
            aria-controls="doc-picker-list"
            aria-activedescendant={selected >= 0 && rows.length > 0 ? `doc-picker-option-${selected}` : undefined}
            aria-label="문서 제목"
            placeholder="문서 제목으로 찾기"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        {status ? (
          <p className="command-palette-status" role="status">
            {status}
          </p>
        ) : (
          <ul id="doc-picker-list" role="listbox" aria-label="문서" className="command-palette-list">
            {rows.map((doc, i) => (
              <li
                key={doc.id}
                id={`doc-picker-option-${i}`}
                role="option"
                aria-selected={i === selected}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                className={`command-palette-item command-palette-item--doc${i === selected ? ' command-palette-item--on' : ''}`}
                onClick={() => onPick(doc.id)}
              >
                <span className="command-palette-item-label">{doc.title || UNTITLED}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
