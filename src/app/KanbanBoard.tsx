// 칸반 보드 화면 — 숨긴 편집기의 EditorState 를 읽어 그린다, 이 명세에서는 쓰지 않는다 (F-2140 3장)
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { EditorHandle } from '../editor/Editor'
import { useKanbanLanes } from './useKanbanView'

export type KanbanBoardFocus = 'title' | 'board' | null

type KanbanBoardProps = {
  handle: EditorHandle
  title: string
  titleReadOnly: boolean
  onTitleChange: (value: string) => void
  onTitleCommit: () => void
  onOpenStray: (line: number) => void
  // 문서를 열 때 받은 첫 포커스 요청 — 마운트 때 한 번 쓰고 비운다
  focusRef: RefObject<KanbanBoardFocus>
}

export default function KanbanBoard({ handle, title, titleReadOnly, onTitleChange, onTitleCommit, onOpenStray, focusRef }: KanbanBoardProps) {
  const lanes = useKanbanLanes(handle)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)
  // 포커스 중에는 바깥 제목으로 덮지 않고 blur 뒤 맞춘다 (docTitle.ts latestTitle 과 같은 규칙)
  const [draft, setDraft] = useState<string | null>(null)

  // 숨겨진 편집기가 포커스를 들고 있으면(칸반 판정이 열린 뒤에 난 경우) 보드로 옮겨 숨은 편집기에 글자가 들어가지 않게 한다
  useLayoutEffect(() => {
    const request = focusRef.current
    focusRef.current = null
    const active = document.activeElement
    const inEditor = active instanceof HTMLElement && handle.view.dom.contains(active)
    if (request === 'title' || (inEditor && active.matches('textarea.doc-title'))) {
      titleRef.current?.focus()
      titleRef.current?.select()
    } else if (request === 'board' || inEditor) {
      boardRef.current?.focus()
    }
  }, [handle, focusRef])

  return (
    <div ref={boardRef} className="kanban-board" role="region" aria-label="칸반 보드" tabIndex={-1}>
      <input
        ref={titleRef}
        className="kanban-title"
        aria-label="문서 제목"
        value={draft ?? title}
        readOnly={titleReadOnly}
        placeholder={titleReadOnly ? '' : '제목 없는 문서'}
        onFocus={() => setDraft(title)}
        onChange={(e) => {
          setDraft(e.target.value)
          onTitleChange(e.target.value)
        }}
        onBlur={() => {
          setDraft(null)
          onTitleCommit()
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
          e.preventDefault()
          boardRef.current?.focus()
        }}
      />
      {lanes.length === 0 ? (
        <p className="kanban-empty">칸이 없습니다. ## 로 시작하는 줄 하나가 칸 하나가 됩니다.</p>
      ) : (
        <div className="kanban-lanes">
          {lanes.map((lane, laneIndex) => {
            const name = lane.title || '이름 없는 칸'
            return (
              <section key={laneIndex} className="kanban-lane" aria-label={name}>
                <header className="kanban-lane-head">
                  <h2 className="kanban-lane-title">{name}</h2>
                  <span className="kanban-lane-count">{lane.cards.length}</span>
                </header>
                <ul className="kanban-cards">
                  {lane.cards.map((card, cardIndex) => (
                    <li key={cardIndex} className="kanban-card" tabIndex={0}>
                      {card.done !== null && <input type="checkbox" className="kanban-card-check" aria-label="완료" checked={card.done} readOnly disabled />}
                      <span className="kanban-card-text">{card.text}</span>
                      {card.detail.length > 0 && <div className="kanban-card-detail">{card.detail.join('\n')}</div>}
                    </li>
                  ))}
                </ul>
                {lane.strayLines.length > 0 && (
                  <button type="button" className="kanban-stray" onClick={() => onOpenStray(lane.strayLines[0])}>
                    {`카드가 아닌 줄 ${lane.strayLines.length}개`}
                  </button>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
