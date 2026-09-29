// 명령 팔레트 UI D-7 — 두 단계(1단계 구역 목록 → 2단계 템플릿), 키보드 (specs/features/F-2022.md 8장, F-2053.md 5·8장)
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import Dialog from './Dialog'
import { IconArrowBack, IconSearch, IconPin, IconUnpin } from './icons'
import {
  visibleCommands,
  filterPaletteItems,
  parsePaletteQuery,
  buildPaletteSections,
  type PaletteCommand,
  type PalettePickCommand,
  type PaletteContext,
  type PaletteItem,
  type PaletteRow,
  type PaletteDoc,
  type PaletteSection,
} from './paletteContract'
import { PALETTE_COMMANDS } from './paletteCommands'
import { prepareDocIndex } from './paletteDocs'
import { parseCommandIds, pushRecentCommand, togglePinnedCommand } from './paletteMemory'
import { getPref, setPref } from './prefs'
import { nextResultIndex } from './searchResults'

type Stage = { kind: 'commands' } | { kind: 'pick'; command: PalettePickCommand }
type Target = 'here' | 'newTab'

type CommandPaletteProps = {
  open: boolean
  context: PaletteContext
  onClose: () => void
  // 이미 열려 있을 때 Ctrl+P 를 다시 누르면 App 이 이 ref 로 입력칸 전체 선택을 시킨다 (6.1)
  selectQueryRef: RefObject<() => void>
}

type Row = { id: string; label: string; detail?: string }

function toRows(items: readonly (PaletteCommand | PaletteItem)[]): Row[] {
  return items.map((it) => ('kind' in it ? { id: it.id, label: it.label, detail: it.shortcut } : { id: it.id, label: it.label, detail: it.detail }))
}

const KNOWN_COMMAND_IDS = new Set(PALETTE_COMMANDS.map((c) => c.id))
const EMPTY_DOCS: readonly PaletteDoc[] = []
const EMPTY_SECTIONS: readonly PaletteSection[] = []

function identityOf(row: PaletteRow | PaletteItem): string {
  return 'key' in row ? row.key : row.id
}

export default function CommandPalette({ open, context, onClose, selectQueryRef }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const itemRefs = useRef<(HTMLLIElement | null)[]>([])
  const pickControllerRef = useRef<AbortController | null>(null)

  const [stage, setStage] = useState<Stage>({ kind: 'commands' })
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(-1)
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null)
  const [pickLoading, setPickLoading] = useState(false)
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  const [recentIds, setRecentIds] = useState<string[]>([])

  useEffect(() => {
    selectQueryRef.current = () => inputRef.current?.select()
  })

  // 닫으면 검색어·단계를 버린다. 열면 최근·고정을 다시 읽는다(다른 탭 변경 반영, 7.4) (8.4)
  const [trackedOpen, setTrackedOpen] = useState(open)
  if (open !== trackedOpen) {
    setTrackedOpen(open)
    if (open) {
      setPinnedIds(parseCommandIds(getPref('md.palettePinned', '[]'), KNOWN_COMMAND_IDS))
      setRecentIds(parseCommandIds(getPref('md.paletteRecent', '[]'), KNOWN_COMMAND_IDS))
    } else {
      setStage({ kind: 'commands' })
      setQuery('')
      setSelected(-1)
      setPendingSelectId(null)
    }
  }

  // items 는 참조가 렌더마다 안정돼야 한다 — 아래 "렌더 중 조정" 이 목록이 바뀌었는지 본다(무한 렌더 방지)
  const commands = useMemo(() => visibleCommands(PALETTE_COMMANDS, context), [context])
  const parsedQuery = useMemo(() => parsePaletteQuery(query), [query])

  const docsAll = context.docs?.all
  const recentDocs = context.docs?.recent ?? EMPTY_DOCS
  const docIndex = useMemo(() => (docsAll ? prepareDocIndex(docsAll) : null), [docsAll])

  // 1단계(commands)에서만 계산한다 — 2단계(템플릿 등 pick)에서는 안 쓰는데 App 이 매 렌더 새 context 를 넘겨 여기서도 다시 돌 수 있어서 (main 결정 2026-09-28)
  const createPlan = useMemo(() => {
    if (stage.kind !== 'commands' || !context.docs || parsedQuery.mode !== 'all' || parsedQuery.text.trim() === '') return null
    return context.docs.planCreate(parsedQuery.text)
  }, [stage.kind, context.docs, parsedQuery])

  const sections = useMemo(() => {
    if (stage.kind !== 'commands') return EMPTY_SECTIONS
    return buildPaletteSections({
      query: parsedQuery,
      commands,
      pinnedIds,
      recentIds,
      docs: docIndex,
      recentDocs,
      createPlan,
    })
  }, [stage.kind, parsedQuery, commands, pinnedIds, recentIds, docIndex, recentDocs, createPlan])
  const flatRows = useMemo(() => sections.flatMap((s) => s.rows), [sections])

  const items: (PaletteCommand | PaletteItem)[] = useMemo(
    () => (stage.kind === 'pick' ? filterPaletteItems(stage.command.items(context), query) : []),
    [stage, query, context],
  )
  const pickRows = toRows(items)

  const activeList: readonly (PaletteRow | PaletteItem)[] = stage.kind === 'commands' ? flatRows : items
  const totalCount = activeList.length
  // App 이 매 렌더 새 context 객체를 넘겨 activeList 참조가 내용이 같아도 바뀔 수 있다 — 내용(줄 id 순서)으로 비교한다 (main 결정 2026-09-28)
  const activeKey = activeList.map(identityOf).join('\u0000')

  // 검색어·단계가 바뀌어 목록이 달라지면 첫 줄 선택(또는 Backspace·Alt+P 로 되돌아온 자리) — 렌더 중 조정(SearchDialog.tsx 와 같은 패턴)
  const [trackedKey, setTrackedKey] = useState(activeKey)
  if (activeKey !== trackedKey) {
    setTrackedKey(activeKey)
    if (pendingSelectId) {
      const idx = activeList.findIndex((it) => identityOf(it) === pendingSelectId)
      setSelected(idx >= 0 ? idx : activeList.length > 0 ? 0 : -1)
      setPendingSelectId(null)
    } else {
      setSelected(activeList.length > 0 ? 0 : -1)
    }
  }

  useEffect(() => {
    if (selected < 0) return
    itemRefs.current[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  function abortPendingPick() {
    pickControllerRef.current?.abort()
    pickControllerRef.current = null
    setPickLoading(false)
  }

  function handleDialogClose() {
    abortPendingPick()
    onClose()
  }

  function recordRecentCommand(id: string) {
    setRecentIds((prev) => {
      const next = pushRecentCommand(prev, id)
      setPref('md.paletteRecent', JSON.stringify(next))
      return next
    })
  }

  function togglePinned(id: string) {
    setPendingSelectId(id) // 토글 뒤 선택은 같은 명령을 따라간다 (8.3)
    setPinnedIds((prev) => {
      const next = togglePinnedCommand(prev, id)
      setPref('md.palettePinned', JSON.stringify(next))
      return next
    })
  }

  function runAction(cmd: PaletteCommand & { kind: 'action' }) {
    onClose()
    cmd.run(context)
  }

  function enterPick(cmd: PalettePickCommand) {
    setStage({ kind: 'pick', command: cmd })
    setQuery('')
  }

  async function runPick(command: PalettePickCommand, item: PaletteItem) {
    const controller = new AbortController()
    pickControllerRef.current = controller
    const loadingTimer = setTimeout(() => setPickLoading(true), 250)
    try {
      await command.pick(item, context, controller.signal)
    } finally {
      clearTimeout(loadingTimer)
      setPickLoading(false)
      if (pickControllerRef.current === controller) pickControllerRef.current = null
      if (!controller.signal.aborted) onClose() // pick 이 끝났는데 팔레트가 아직 열려 있으면 스스로 닫는다 (3.2)
    }
  }

  // 명령 줄은 고르는 순간 최근 목록에 올린다(3.3). 문서·만들기 줄은 App 의 open·create 가 팔레트를 닫는다(8.5·6.3)
  function runRow(index: number, target: Target = 'here') {
    if (stage.kind === 'pick') {
      const item = items[index]
      if (!item) return
      void runPick(stage.command, item)
      return
    }
    const row = flatRows[index]
    if (!row) return
    if (row.kind === 'command') {
      recordRecentCommand(row.command.id)
      if (row.command.kind === 'action') runAction(row.command)
      else enterPick(row.command)
      return
    }
    if (row.kind === 'doc') {
      context.docs?.open(row.doc.id, target)
      return
    }
    context.docs?.create(row.plan)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((current) => nextResultIndex(current, totalCount, e.key))
      return
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyP') {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      if (stage.kind === 'commands' && selected >= 0) {
        const row = flatRows[selected]
        if (row?.kind === 'command') togglePinned(row.command.id)
      }
      return
    }
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return // 한글 조합 중 keydown 은 무시 (8.4)
      e.preventDefault()
      if (selected < 0) return
      runRow(selected, e.ctrlKey || e.metaKey ? 'newTab' : 'here')
      return
    }
    if (e.key === 'Backspace' && query === '' && stage.kind === 'pick') {
      e.preventDefault()
      backToCommands()
    }
  }

  function backToCommands() {
    if (stage.kind !== 'pick') return
    setPendingSelectId(stage.command.id)
    setStage({ kind: 'commands' })
    setQuery('')
  }

  function handlePinMouseDown(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault() // 입력칸 포커스를 지킨다 (8.3)
  }

  function handlePinClick(e: MouseEvent<HTMLButtonElement>, id: string) {
    e.stopPropagation() // 줄 실행으로 번지지 않게 (8.3)
    togglePinned(id)
  }

  const stageTitle = stage.kind === 'commands' ? '명령 팔레트' : stage.command.stageTitle
  const placeholder = stage.kind === 'commands' ? '문서나 명령 찾기 — /로 시작하면 명령만' : stage.command.placeholder
  const inputLabel = stage.kind === 'commands' ? '문서나 명령 찾기' : stage.command.placeholder
  const listLabel = stage.kind === 'commands' ? '문서와 명령' : '템플릿'

  // 문서·최근 문서·만들기 줄까지 합쳐서 0개일 때만 문구를 낸다 — 명령만 0개면 문서 구역이 그대로 보여야 한다 (5.4, main 결정 2026-09-28)
  let statusText: string | null = null
  if (stage.kind === 'commands') {
    if (parsedQuery.mode === 'commands') {
      if (commands.length === 0) statusText = '지금 쓸 수 있는 명령이 없습니다'
      else if (flatRows.length === 0) statusText = '맞는 명령이 없습니다'
    } else if (flatRows.length === 0) {
      statusText = parsedQuery.text.trim() === '' ? '지금 쓸 수 있는 명령이 없습니다' : '맞는 문서나 명령이 없습니다'
    }
  } else if (items.length === 0) {
    statusText = stage.command.emptyText
  }

  const hint = stage.kind === 'pick' ? (stage.command.hint ? stage.command.hint(context) : null) : null

  let rowIndex = -1

  function renderCommandRow(row: PaletteRow & { kind: 'command' }, i: number) {
    return (
      <li
        key={row.key}
        id={`command-palette-option-${i}`}
        role="option"
        aria-selected={i === selected}
        ref={(el) => {
          itemRefs.current[i] = el
        }}
        className={`command-palette-item${i === selected ? ' command-palette-item--on' : ''}${row.pinned ? ' command-palette-item--pinned' : ''}`}
        onClick={() => runRow(i)}
      >
        <span className="command-palette-item-label">{row.command.label}</span>
        {row.command.shortcut && <span className="command-palette-item-detail">{row.command.shortcut}</span>}
        <button
          type="button"
          className="command-palette-pin"
          tabIndex={-1}
          aria-hidden="true"
          title={row.pinned ? '고정 해제 (Alt+P)' : '명령 고정 (Alt+P)'}
          onMouseDown={handlePinMouseDown}
          onClick={(e) => handlePinClick(e, row.command.id)}
        >
          {row.pinned ? <IconUnpin size={14} /> : <IconPin size={14} />}
        </button>
      </li>
    )
  }

  function renderDocRow(row: PaletteRow & { kind: 'doc' }, i: number) {
    const detail = row.doc.shared ? '공유받음' : row.doc.folderPath || undefined
    return (
      <li
        key={row.key}
        id={`command-palette-option-${i}`}
        role="option"
        aria-selected={i === selected}
        ref={(el) => {
          itemRefs.current[i] = el
        }}
        className={`command-palette-item command-palette-item--doc${i === selected ? ' command-palette-item--on' : ''}`}
        onClick={(e) => runRow(i, e.ctrlKey || e.metaKey ? 'newTab' : 'here')}
      >
        <span className="command-palette-item-label">{row.doc.title}</span>
        {detail && <span className="command-palette-item-detail">{detail}</span>}
      </li>
    )
  }

  function renderCreateRow(row: PaletteRow & { kind: 'create' }, i: number) {
    return (
      <li
        key={row.key}
        id={`command-palette-option-${i}`}
        role="option"
        aria-selected={i === selected}
        ref={(el) => {
          itemRefs.current[i] = el
        }}
        className={`command-palette-item command-palette-item--create${i === selected ? ' command-palette-item--on' : ''}`}
        onClick={() => runRow(i)}
      >
        <span className="command-palette-item-label">'{row.plan.title}' 새 문서 만들기</span>
        <span className="command-palette-item-detail">{row.plan.folderPath || '최상위'}</span>
      </li>
    )
  }

  function renderRow(row: PaletteRow, i: number) {
    if (row.kind === 'command') return renderCommandRow(row, i)
    if (row.kind === 'doc') return renderDocRow(row, i)
    return renderCreateRow(row, i)
  }

  return (
    <Dialog open={open} onClose={handleDialogClose} titleId="command-palette-title" size="wide" initialFocusRef={inputRef}>
      <div className="command-palette">
        <div className="command-palette-head">
          {/* 휴대폰 자판은 빈 입력칸의 Backspace 를 안 보내기도 한다 — 2단계에서 되돌아갈 버튼 */}
          {stage.kind === 'pick' && (
            <button type="button" className="icon-btn command-palette-back" aria-label="뒤로" onMouseDown={handlePinMouseDown} onClick={backToCommands}>
              <IconArrowBack size={18} />
            </button>
          )}
          <h2 id="command-palette-title">{stageTitle}</h2>
        </div>
        <div className="search-input-row">
          <IconSearch size={18} />
          <input
            ref={inputRef}
            className="command-palette-input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={totalCount > 0}
            aria-controls="command-palette-list"
            aria-activedescendant={selected >= 0 ? `command-palette-option-${selected}` : undefined}
            aria-label={inputLabel}
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        {statusText ? (
          <p className="command-palette-status" role="status">
            {statusText}
          </p>
        ) : (
          <ul id="command-palette-list" role="listbox" aria-label={listLabel} className="command-palette-list">
            {stage.kind === 'commands'
              ? sections.map((section) => (
                  <li key={section.key} role="none">
                    {section.heading !== null && (
                      <div id={`command-palette-section-${section.key}`} className="command-palette-section" role="presentation">
                        {section.heading}
                      </div>
                    )}
                    <ul
                      role="group"
                      className="command-palette-group"
                      aria-label={section.heading === null ? '새 문서' : undefined}
                      aria-labelledby={section.heading !== null ? `command-palette-section-${section.key}` : undefined}
                    >
                      {section.rows.map((row) => {
                        rowIndex += 1
                        return renderRow(row, rowIndex)
                      })}
                    </ul>
                  </li>
                ))
              : pickRows.map((row, i) => (
                  <li
                    key={row.id}
                    id={`command-palette-option-${i}`}
                    role="option"
                    aria-selected={i === selected}
                    ref={(el) => {
                      itemRefs.current[i] = el
                    }}
                    className={`command-palette-item${i === selected ? ' command-palette-item--on' : ''}`}
                    onClick={() => runRow(i)}
                  >
                    <span className="command-palette-item-label">{row.label}</span>
                    {row.detail && <span className="command-palette-item-detail">{row.detail}</span>}
                  </li>
                ))}
          </ul>
        )}
        {pickLoading && (
          <p className="command-palette-status" role="status">
            불러오는 중…
          </p>
        )}
        {hint && <p className="command-palette-hint">{hint}</p>}
      </div>
    </Dialog>
  )
}
