// 명령 팔레트 UI D-7 — 두 단계(명령 → 템플릿), 키보드 (specs/features/F-2022.md 8장)
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import Dialog from './Dialog'
import { IconSearch } from './icons'
import { visibleCommands, filterPaletteItems, type PaletteCommand, type PalettePickCommand, type PaletteContext, type PaletteItem } from './paletteContract'
import { PALETTE_COMMANDS } from './paletteCommands'
import { nextResultIndex } from './searchResults'

type Stage = { kind: 'commands' } | { kind: 'pick'; command: PalettePickCommand }

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

export default function CommandPalette({ open, context, onClose, selectQueryRef }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const itemRefs = useRef<(HTMLLIElement | null)[]>([])
  const pickControllerRef = useRef<AbortController | null>(null)

  const [stage, setStage] = useState<Stage>({ kind: 'commands' })
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(-1)
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null)
  const [pickLoading, setPickLoading] = useState(false)

  useEffect(() => {
    selectQueryRef.current = () => inputRef.current?.select()
  })

  // 닫으면 검색어·단계를 버린다. 다음에 열면 늘 1단계, 빈 검색어 (8.4)
  const [trackedOpen, setTrackedOpen] = useState(open)
  if (open !== trackedOpen) {
    setTrackedOpen(open)
    if (!open) {
      setStage({ kind: 'commands' })
      setQuery('')
      setSelected(-1)
      setPendingSelectId(null)
    }
  }

  // items 는 참조가 렌더마다 안정돼야 한다 — 아래 "렌더 중 조정" 이 참조 비교로 목록이 바뀌었는지 본다(무한 렌더 방지)
  const commands = useMemo(() => visibleCommands(PALETTE_COMMANDS, context), [context])
  const items: (PaletteCommand | PaletteItem)[] = useMemo(
    () => (stage.kind === 'commands' ? filterPaletteItems(commands, query) : filterPaletteItems(stage.command.items(context), query)),
    [stage, query, commands, context],
  )
  const rows = toRows(items)

  // 검색어·단계가 바뀌어 목록이 달라지면 첫 줄 선택(또는 Backspace 로 되돌아온 자리) — 렌더 중 조정(SearchDialog.tsx 와 같은 패턴)
  const [trackedItems, setTrackedItems] = useState(items)
  if (items !== trackedItems) {
    setTrackedItems(items)
    if (pendingSelectId) {
      const idx = items.findIndex((it) => it.id === pendingSelectId)
      setSelected(idx >= 0 ? idx : items.length > 0 ? 0 : -1)
      setPendingSelectId(null)
    } else {
      setSelected(items.length > 0 ? 0 : -1)
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

  function runRow(index: number) {
    const item = items[index]
    if (!item) return
    if (stage.kind === 'commands') {
      const cmd = item as PaletteCommand
      if (cmd.kind === 'action') runAction(cmd)
      else enterPick(cmd)
      return
    }
    void runPick(stage.command, item as PaletteItem)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((current) => nextResultIndex(current, rows.length, e.key))
      return
    }
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return // 한글 조합 중 keydown 은 무시 (8.4)
      e.preventDefault()
      if (selected >= 0) runRow(selected)
      return
    }
    if (e.key === 'Backspace' && query === '' && stage.kind === 'pick') {
      e.preventDefault()
      setPendingSelectId(stage.command.id)
      setStage({ kind: 'commands' })
      setQuery('')
    }
  }

  const stageTitle = stage.kind === 'commands' ? '명령 팔레트' : stage.command.stageTitle
  const placeholder = stage.kind === 'commands' ? '명령 이름' : stage.command.placeholder
  const inputLabel = stage.kind === 'commands' ? '명령 이름' : stage.command.placeholder
  const listLabel = stage.kind === 'commands' ? '명령' : '템플릿'

  let statusText: string | null = null
  if (stage.kind === 'commands' && commands.length === 0) statusText = '지금 쓸 수 있는 명령이 없습니다'
  else if (rows.length === 0) statusText = stage.kind === 'commands' ? '맞는 명령이 없습니다' : stage.command.emptyText

  const hint = stage.kind === 'pick' ? (stage.command.hint ? stage.command.hint(context) : null) : null

  return (
    <Dialog open={open} onClose={handleDialogClose} titleId="command-palette-title" size="wide" initialFocusRef={inputRef}>
      <div className="command-palette">
        <h2 id="command-palette-title">{stageTitle}</h2>
        <div className="search-input-row">
          <IconSearch size={18} />
          <input
            ref={inputRef}
            className="command-palette-input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={rows.length > 0}
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
            {rows.map((row, i) => (
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
