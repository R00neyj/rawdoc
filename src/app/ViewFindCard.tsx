// 보기 모드 찾기 카드 — 안쪽 클래스·name 은 편집 카드(searchMoreToggle 이 묶은 뒤 모양)와 같다 (F-2087 3.4)
import type { KeyboardEvent, MouseEvent, ReactNode, RefObject } from 'react'
import type { ViewFindQuery } from '../viewer/viewFindMatch'
import '../editor/searchPanel.css'
import './viewFind.css'

export type ViewFindCardProps = {
  query: ViewFindQuery
  count: string
  expanded: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onQueryChange: (patch: Partial<ViewFindQuery>) => void
  onToggleExpanded: () => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

// 누를 때 입력칸 포커스를 가져가지 않는다 — 휴대폰 자판이 닫혔다 열리지 않게
const keepFocus = (e: MouseEvent) => e.preventDefault()

export default function ViewFindCard({ query, count, expanded, inputRef, onQueryChange, onToggleExpanded, onNext, onPrev, onClose }: ViewFindCardProps): ReactNode {
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    if (e.shiftKey) onPrev()
    else onNext()
  }

  return (
    <div className={`view-find${expanded ? ' cm-search--expanded' : ''}`} role="search" aria-label="이 문서에서 찾기">
      <div className="cm-search-row">
        <span className="view-find-field">
          <input
            ref={inputRef}
            className="cm-textfield"
            name="search"
            type="text"
            placeholder="찾기"
            aria-label="찾기"
            enterKeyHint="search"
            value={query.search}
            onChange={(e) => onQueryChange({ search: e.target.value })}
            onKeyDown={handleKeyDown}
          />
          <span className="view-find-count" role="status" aria-live="polite">{count}</span>
        </span>
        <button type="button" className="cm-button" name="next" aria-label="다음 찾기" onMouseDown={keepFocus} onClick={onNext}>다음</button>
        <button type="button" className="cm-button" name="prev" aria-label="이전 찾기" onMouseDown={keepFocus} onClick={onPrev}>이전</button>
        <button
          type="button"
          className="cm-button cm-search-more"
          aria-label={expanded ? '옵션 접기' : '옵션 더 보기'}
          aria-expanded={expanded}
          onMouseDown={keepFocus}
          onClick={onToggleExpanded}
        >
          옵션
        </button>
        <button type="button" name="close" aria-label="닫기" onMouseDown={keepFocus} onClick={onClose}>닫기</button>
      </div>
      <div className="cm-search-more-panel">
        <label onMouseDown={keepFocus}>
          <input type="checkbox" name="case" checked={query.caseSensitive} onChange={(e) => onQueryChange({ caseSensitive: e.target.checked })} />
          대소문자 구분
        </label>
        <label onMouseDown={keepFocus}>
          <input type="checkbox" name="re" checked={query.regexp} onChange={(e) => onQueryChange({ regexp: e.target.checked })} />
          정규식
        </label>
        <label onMouseDown={keepFocus}>
          <input type="checkbox" name="word" checked={query.wholeWord} onChange={(e) => onQueryChange({ wholeWord: e.target.checked })} />
          단어 단위
        </label>
      </div>
    </div>
  )
}
