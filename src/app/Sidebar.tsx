// 사이드바 — 폴더 2단계 트리·항목 메뉴·끌어놓기 이동·고정됨 묶음 (specs/ia.md 2장 B, F-111·F-114·F-121·F-115·F-126·F-132·F-143.md)
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import { buildTree, canMoveFolder, pinnedDocs, type DocLike, type DocNode, type FolderLike, type FolderNode, type TreeNode as TreeNodeType } from '../lib/folderTree'
import FolderMenu, { type FolderMenuItem } from './FolderMenu'
import SidebarHead, { SIDEBAR_ID, SEARCH_LABEL } from './SidebarHead'
import { clampSidebarWidth, maxSidebarWidth, MIN_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH, ARROW_KEY_STEP } from './sidebarWidth'
import {
  EMPTY_SELECTION,
  toggle as toggleSelection,
  extend as extendSelection,
  replace as replaceSelection,
  prune as pruneSelection,
  visibleOrder,
  commonParentId,
  dedupeDescendants,
  type Selection,
  type SelectionItem,
} from './sidebarSelection'
import {
  IconChevron,
  IconNoteAdd,
  IconFolderAdd,
  IconUpload,
  IconSearch,
  IconSettings,
  IconInstall,
  IconPin,
  IconUnpin,
  IconMove,
  IconDelete,
  IconEdit,
  IconTooltip,
  IconGroup,
  IconHelp,
  IconGuide,
  IconExternalLink,
  IconCollapseAll,
  IconDownload,
  IconOpenInNew,
  IconMap,
} from './icons'
import { formatHash } from './hashRoute'
import { GUIDES_PATH } from '../lib/siteChrome'
import type { Notice } from './notice'

export { SIDEBAR_ID }

type DropTarget = { type: 'folder'; id: string } | { type: 'doc'; id: string } | { type: 'root' }
// 선택 전체를 끌 때는 항목이 여럿(F-255.md 3.4), 선택 밖 항목은 하나뿐이다
type Dragged = { items: SelectionItem[] } | null
// 우클릭·여러 항목 메뉴 버튼이 forcedOpen 으로 여는 행 하나 — 자리는 행 자신의 위치, 좌표는 우클릭일 때만 (F-255.md 3.2)
type ContextMenuState = { id: string; point: { x: number; y: number } } | null

type DeleteDocTarget = { id: string; title: string }
type DeleteFolderTarget = { id: string; name: string }
type MoveDocTarget = { id: string; title: string; folderId: string | null }

// 공유받은 문서 한 항목 — 끌어 옮기기·⋯ 메뉴 없이 열기만 한다 (specs/features/F-212.md 2.4)
export type SharedDocLike = {
  id: string
  title: string
  role: 'edit' | 'view'
  ownerEmail: string
  viaFolder?: { id: string; name: string } | null
}

type SidebarCtx = {
  currentDocId: string | null
  openFolderIds: string[]
  editingId: string | null
  editingValue: string
  dropTargetKey: string | null
  onToggleFolder: (id: string) => void
  onSelectDoc: (id: string) => void
  onCreateDoc: (folderId?: string | null) => void
  onCreateFolder: (parentId: string | null) => void
  onStartRename: (id: string, name: string) => void
  onEditingValueChange: (value: string) => void
  onRenameKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  onCommitRename: () => void
  onRequestDeleteDoc: (target: DeleteDocTarget) => void
  onRequestDeleteFolder: (target: DeleteFolderTarget) => void
  onRequestMoveDoc: (target: MoveDocTarget) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onDragStart: (e: DragEvent<HTMLDivElement>, type: 'doc' | 'folder', id: string) => void
  onDragEnd: () => void
  onDragOver: (e: DragEvent<HTMLDivElement>, target: DropTarget) => void
  onDrop: (e: DragEvent<HTMLDivElement>, target: DropTarget) => void
  // 여러 항목 선택 — 클릭 뜻(일반/Ctrl/Shift), 우클릭 메뉴, 여러 항목 전용 메뉴 (F-255.md 3.1~3.4)
  selection: Selection
  contextMenu: ContextMenuState
  multiMenuItems: FolderMenuItem[]
  onItemClick: (e: ReactMouseEvent<HTMLElement>, item: SelectionItem, action: () => void) => void
  onRowContextMenu: (e: ReactMouseEvent<HTMLDivElement>, item: SelectionItem, isEditingRow: boolean) => void
  onCloseContextMenu: () => void
  // 폴더 읽기 전용 링크 메뉴 항목 노출 조건·알림 (F-211.md 2.4) — App.tsx 에 경로가 없어 최소 전달만 한다
  isServerStore: boolean
  onNotice: (notice: Notice) => void
  // 폴더 `⋯` 메뉴 `사람 초대…` (F-212.md 2.5)
  onRequestInviteFolder: (id: string, name: string) => void
  // 폴더 `⋯` 메뉴 `폴더 내보내기` (F-281.md 3.7)
  onExportFolder: (id: string) => void
}

function dropKeyOf(target: DropTarget): string {
  return target.type === 'root' ? 'root' : `${target.type}:${target.id}`
}

// 문서 `⋯` 메뉴 맨 위 `상단 고정`/`고정 해제` 항목 — 트리·묶음 모두 같은 규칙 (F-132.md 4장)
function pinMenuItem(doc: DocLike, onTogglePin: SidebarCtx['onTogglePin']): FolderMenuItem {
  const isPinned = doc.pinnedAt != null
  return {
    key: 'pin',
    label: isPinned ? '고정 해제' : '상단 고정',
    icon: isPinned ? IconUnpin : IconPin,
    onSelect: () => onTogglePin(doc.id, !isPinned),
  }
}

// 트리 한 항목(폴더 또는 문서) — 재귀 렌더링. 콜백은 전부 ctx 를 거쳐 Sidebar 의 함수를 부르고, ref.current 는 직접 읽지 않는다
function TreeNode({
  node,
  depth,
  ctx,
  editingInputRef,
}: {
  node: TreeNodeType
  depth: number
  ctx: SidebarCtx
  editingInputRef: RefObject<HTMLInputElement | null>
}) {
  if (node.type === 'folder') {
    return <FolderRow node={node} depth={depth} ctx={ctx} editingInputRef={editingInputRef} />
  }
  return <DocRow node={node} depth={depth} ctx={ctx} />
}

// editingInputRef 는 ctx 밖에서 별도 prop 으로 받는다(한 객체에 담으면 정적 분석이 객체 전체를 ref 로 취급해 렌더 중 접근을 막는다)
function FolderRow({
  node,
  depth,
  ctx,
  editingInputRef,
}: {
  node: FolderNode
  depth: number
  ctx: SidebarCtx
  editingInputRef: RefObject<HTMLInputElement | null>
}) {
  const isOpen = ctx.openFolderIds.includes(node.id)
  const isEditing = ctx.editingId === node.id
  const target: DropTarget = { type: 'folder', id: node.id }
  const isDropTarget = ctx.dropTargetKey === dropKeyOf(target)
  const isSelected = ctx.selection.ids.includes(node.id)
  const isMulti = isSelected && ctx.selection.ids.length > 1
  const item: SelectionItem = { kind: 'folder', id: node.id }
  const menuOpenHere = ctx.contextMenu?.id === node.id

  const ownItems: FolderMenuItem[] = [
    { key: 'new-doc', label: '새 문서', icon: IconNoteAdd, onSelect: () => ctx.onCreateDoc(node.id) },
  ]
  if (node.parentId === null) {
    ownItems.push({
      key: 'new-subfolder',
      label: '하위 폴더',
      icon: IconFolderAdd,
      onSelect: () => ctx.onCreateFolder(node.id),
    })
  }
  ownItems.push({ key: 'rename', label: '이름 변경', icon: IconEdit, onSelect: () => ctx.onStartRename(node.id, node.name) })
  ownItems.push({
    key: 'export-folder',
    label: '폴더 내보내기',
    icon: IconDownload,
    onSelect: () => ctx.onExportFolder(node.id),
  })
  ownItems.push({
    key: 'delete',
    label: '삭제',
    icon: IconDelete,
    danger: true,
    onSelect: () => ctx.onRequestDeleteFolder({ id: node.id, name: node.name }),
  })
  const items = isMulti ? ctx.multiMenuItems : ownItems

  return (
    <li role="treeitem" aria-expanded={isOpen} className="tree-item" data-folder-id={node.id}>
      <div
        className={`tree-row${isDropTarget ? ' tree-row--drop' : ''}${isSelected ? ' tree-row--selected' : ''}`}
        style={{ '--depth': depth } as CSSProperties}
        draggable={!isEditing}
        onDragStart={(e) => ctx.onDragStart(e, 'folder', node.id)}
        onDragEnd={ctx.onDragEnd}
        onDragOver={(e) => ctx.onDragOver(e, target)}
        onDrop={(e) => ctx.onDrop(e, target)}
        onContextMenu={(e) => ctx.onRowContextMenu(e, item, isEditing)}
      >
        <button
          type="button"
          className="tree-toggle"
          aria-label={`${node.name} ${isOpen ? '접기' : '펼치기'}`}
          onClick={() => ctx.onToggleFolder(node.id)}
        >
          <IconChevron size={16} className={`tree-toggle-icon${isOpen ? ' tree-toggle-icon--open' : ''}`} />
        </button>
        {isEditing ? (
          <input
            ref={editingInputRef}
            className="tree-rename-input"
            value={ctx.editingValue}
            onChange={(e) => ctx.onEditingValueChange(e.target.value)}
            onKeyDown={ctx.onRenameKeyDown}
            onBlur={ctx.onCommitRename}
          />
        ) : (
          <button
            type="button"
            className="tree-label"
            onClick={(e) => ctx.onItemClick(e, item, () => ctx.onToggleFolder(node.id))}
          >
            {node.name}
          </button>
        )}
        {!isEditing && (
          <FolderMenu
            label={node.name}
            items={items}
            shareFolderId={!isMulti && ctx.isServerStore ? node.id : undefined}
            onNotice={ctx.onNotice}
            onInvite={!isMulti && ctx.isServerStore ? () => ctx.onRequestInviteFolder(node.id, node.name) : undefined}
            open={menuOpenHere ? true : undefined}
            onOpenChange={menuOpenHere ? (v) => { if (!v) ctx.onCloseContextMenu() } : undefined}
            anchorPoint={menuOpenHere ? ctx.contextMenu!.point : undefined}
          />
        )}
      </div>
      {isOpen && node.children.length > 0 && (
        <ul role="group" className="tree-group" style={{ '--depth': depth } as CSSProperties}>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} ctx={ctx} editingInputRef={editingInputRef} />
          ))}
        </ul>
      )}
    </li>
  )
}

function DocRow({ node, depth, ctx }: { node: DocNode; depth: number; ctx: SidebarCtx }) {
  const target: DropTarget = { type: 'doc', id: node.id }
  const isDropTarget = ctx.dropTargetKey === dropKeyOf(target)
  const isSelected = ctx.selection.ids.includes(node.id)
  const isMulti = isSelected && ctx.selection.ids.length > 1
  const item: SelectionItem = { kind: 'doc', id: node.id }
  const menuOpenHere = ctx.contextMenu?.id === node.id

  const ownItems: FolderMenuItem[] = [
    {
      key: 'open-new-tab',
      label: '새 탭에서 열기',
      icon: IconOpenInNew,
      // noopener 가 필수다 — 없으면 sessionStorage 가 복제돼 F-213 편집 잠금이 깨진다 (F-296.md 4.1·5.2)
      onSelect: () => { window.open(formatHash(node.id), '_blank', 'noopener') },
    },
    pinMenuItem(node, ctx.onTogglePin),
    {
      key: 'move',
      label: '폴더로 이동…',
      icon: IconMove,
      onSelect: () => ctx.onRequestMoveDoc({ id: node.id, title: node.title, folderId: node.folderId }),
    },
    {
      key: 'delete',
      label: '삭제',
      icon: IconDelete,
      danger: true,
      onSelect: () => ctx.onRequestDeleteDoc({ id: node.id, title: node.title }),
    },
  ]
  const items = isMulti ? ctx.multiMenuItems : ownItems

  return (
    <li role="treeitem" className="tree-item">
      <div
        className={`tree-row${isDropTarget ? ' tree-row--drop' : ''}${isSelected ? ' tree-row--selected' : ''}`}
        style={{ '--depth': depth } as CSSProperties}
        draggable
        onDragStart={(e) => ctx.onDragStart(e, 'doc', node.id)}
        onDragEnd={ctx.onDragEnd}
        onDragOver={(e) => ctx.onDragOver(e, target)}
        onDrop={(e) => ctx.onDrop(e, target)}
        onContextMenu={(e) => ctx.onRowContextMenu(e, item, false)}
      >
        <span className="tree-toggle-spacer" aria-hidden="true" />
        <a
          className="tree-label doc-item-btn"
          href={formatHash(node.id)}
          draggable={false}
          aria-current={node.id === ctx.currentDocId ? 'page' : undefined}
          onClick={(e) => { e.preventDefault(); ctx.onItemClick(e, item, () => ctx.onSelectDoc(node.id)) }}
        >
          {node.title}
        </a>
        <FolderMenu
          label={node.title}
          items={items}
          open={menuOpenHere ? true : undefined}
          onOpenChange={menuOpenHere ? (v) => { if (!v) ctx.onCloseContextMenu() } : undefined}
          anchorPoint={menuOpenHere ? ctx.contextMenu!.point : undefined}
        />
      </div>
    </li>
  )
}

// 사이드바 맨 위 `고정됨` 묶음의 항목 — 트리와 별도로 role="list"/listitem, 들여쓰기 없음, 토글 자리엔 IconPin (F-143 3.2, F-132.md 3·4장)
function PinnedRow({ doc, ctx }: { doc: DocLike; ctx: SidebarCtx }) {
  const isSelected = ctx.selection.ids.includes(doc.id)
  const isMulti = isSelected && ctx.selection.ids.length > 1
  const item: SelectionItem = { kind: 'doc', id: doc.id }
  const menuOpenHere = ctx.contextMenu?.id === doc.id

  const ownItems: FolderMenuItem[] = [
    {
      key: 'open-new-tab',
      label: '새 탭에서 열기',
      icon: IconOpenInNew,
      onSelect: () => { window.open(formatHash(doc.id), '_blank', 'noopener') },
    },
    pinMenuItem(doc, ctx.onTogglePin),
    {
      key: 'move',
      label: '폴더로 이동…',
      icon: IconMove,
      onSelect: () => ctx.onRequestMoveDoc({ id: doc.id, title: doc.title, folderId: doc.folderId }),
    },
    {
      key: 'delete',
      label: '삭제',
      icon: IconDelete,
      danger: true,
      onSelect: () => ctx.onRequestDeleteDoc({ id: doc.id, title: doc.title }),
    },
  ]
  const items = isMulti ? ctx.multiMenuItems : ownItems

  return (
    <li role="listitem" className="tree-item">
      <div className={`tree-row${isSelected ? ' tree-row--selected' : ''}`} onContextMenu={(e) => ctx.onRowContextMenu(e, item, false)}>
        <span className="tree-toggle-spacer" aria-hidden="true">
          <IconPin size={16} className="pinned-row-icon" />
        </span>
        <a
          className="tree-label doc-item-btn"
          href={formatHash(doc.id)}
          draggable={false}
          aria-current={doc.id === ctx.currentDocId ? 'page' : undefined}
          onClick={(e) => { e.preventDefault(); ctx.onItemClick(e, item, () => ctx.onSelectDoc(doc.id)) }}
        >
          {doc.title}
        </a>
        <FolderMenu
          label={doc.title}
          items={items}
          open={menuOpenHere ? true : undefined}
          onOpenChange={menuOpenHere ? (v) => { if (!v) ctx.onCloseContextMenu() } : undefined}
          anchorPoint={menuOpenHere ? ctx.contextMenu!.point : undefined}
        />
      </div>
    </li>
  )
}

// 공유받음 묶음의 문서 한 줄 — 끌어 옮기기·⋯ 메뉴가 없다. 오른쪽에 소유자 이메일 앞부분 (F-212.md 2.4)
function SharedDocRow({ doc, ctx }: { doc: SharedDocLike; ctx: SidebarCtx }) {
  const emailPrefix = doc.ownerEmail.split('@')[0] || doc.ownerEmail
  return (
    <li role="listitem" className="tree-item">
      <div className="tree-row shared-doc-row">
        <span className="tree-toggle-spacer" aria-hidden="true" />
        <a
          className="tree-label doc-item-btn"
          href={formatHash(doc.id)}
          draggable={false}
          aria-current={doc.id === ctx.currentDocId ? 'page' : undefined}
          onClick={(e) => { e.preventDefault(); ctx.onSelectDoc(doc.id) }}
        >
          {doc.title}
        </a>
        <span className="shared-doc-owner">{emailPrefix}</span>
      </div>
    </li>
  )
}

// 사이드바 `공유받음` 묶음 — 폴더로 받은 것은 폴더 이름 아래, 문서로 받은 것은 바로 (F-212.md 2.4)
function SharedGroup({ sharedDocs, ctx }: { sharedDocs: SharedDocLike[]; ctx: SidebarCtx }) {
  const [open, setOpen] = useState(true)
  if (sharedDocs.length === 0) return null

  const direct: SharedDocLike[] = []
  const byFolder = new Map<string, { name: string; docs: SharedDocLike[] }>()
  for (const doc of sharedDocs) {
    if (doc.viaFolder) {
      const group = byFolder.get(doc.viaFolder.id) ?? { name: doc.viaFolder.name, docs: [] }
      group.docs.push(doc)
      byFolder.set(doc.viaFolder.id, group)
    } else {
      direct.push(doc)
    }
  }

  return (
    <>
      <h2>
        <button type="button" className="shared-group-toggle" onClick={() => setOpen((v) => !v)}>
          <IconChevron size={14} className={`tree-toggle-icon${open ? ' tree-toggle-icon--open' : ''}`} />
          <IconGroup size={14} />
          공유받음
        </button>
      </h2>
      {open && (
        <ul className="pinned-list shared-doc-list" role="list" aria-label="공유받은 문서">
          {[...byFolder.values()].map((group) => (
            <li key={group.name} role="presentation" className="shared-doc-folder">
              <span className="shared-doc-folder-name">{group.name}</span>
              <ul role="list">
                {group.docs.map((doc) => (
                  <SharedDocRow key={doc.id} doc={doc} ctx={ctx} />
                ))}
              </ul>
            </li>
          ))}
          {direct.map((doc) => (
            <SharedDocRow key={doc.id} doc={doc} ctx={ctx} />
          ))}
        </ul>
      )}
    </>
  )
}

type RailButtonProps = {
  label: string
  icon: ComponentType<{ size?: number }>
  onClick?: () => void
  ariaDisabled?: boolean
  buttonRef?: RefObject<HTMLButtonElement | null>
  ariaExpanded?: boolean
  href?: string
}

// 접힘 레일의 아이콘 전용 버튼(F-143 3.3, 툴팁은 오른쪽) — props.icon 을 구조 분해로 대문자 별칭하면 no-unused-vars 가 JSX 태그 참조를 못 잡는다
// href 를 주면 사이트로 나가는 새 탭 링크로 그린다 (F-276.md 4.3) — onClick·ariaDisabled·buttonRef·ariaExpanded 는 그 통로에서 쓰지 않는다
function RailButton(props: RailButtonProps) {
  const { label, onClick, ariaDisabled, buttonRef, ariaExpanded, href } = props
  if (href) {
    return (
      <span className="icon-btn-wrap rail-btn-wrap">
        <a className="icon-btn rail-btn" href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
          <props.icon size={18} />
        </a>
        <IconTooltip text={label} side />
      </span>
    )
  }
  return (
    <span className="icon-btn-wrap rail-btn-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn rail-btn"
        aria-label={label}
        aria-disabled={ariaDisabled || undefined}
        aria-expanded={ariaExpanded}
        onClick={onClick}
      >
        <props.icon size={18} />
      </button>
      <IconTooltip text={label} side />
    </span>
  )
}

type SidebarButtonProps = {
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  onClick?: () => void
  ariaDisabled?: boolean
  href?: string
}

// 펼친 사이드바의 아이콘+글자 동작 버튼 (F-143 3.2)
// href 를 주면 사이트로 나가는 새 탭 링크로 그린다 (F-276.md 4.3)
function SidebarButton(props: SidebarButtonProps) {
  const { label, onClick, ariaDisabled, href } = props
  if (href) {
    return (
      <a className="sidebar-btn" href={href} target="_blank" rel="noopener noreferrer">
        <props.icon size={18} className="sidebar-btn-icon" />
        <span className="sidebar-btn-label">{label}</span>
        <IconExternalLink size={14} className="sidebar-btn-ext" />
      </a>
    )
  }
  return (
    <button type="button" className="sidebar-btn" aria-disabled={ariaDisabled || undefined} onClick={onClick}>
      <props.icon size={18} className="sidebar-btn-icon" />
      <span className="sidebar-btn-label">{label}</span>
    </button>
  )
}

// 펼친 사이드바 위쪽 고정 영역의 새 문서·새 폴더·가져오기·검색 — 가로로 나란히, 아이콘만(아래쪽 툴팁)
// (2026-09-20 사용자 요청 "새문서, 새폴더, 가져오기는 아이콘 버튼으로 가로로 표시")
function SidebarIconButton({
  label,
  icon: Icon,
  onClick,
  btnClassName,
}: {
  label: string
  icon: ComponentType<{ size?: number }>
  onClick?: () => void
  btnClassName?: string
}) {
  return (
    <span className="icon-btn-wrap">
      <button type="button" className={btnClassName ? `icon-btn ${btnClassName}` : 'icon-btn'} aria-label={label} onClick={onClick}>
        <Icon size={18} />
      </button>
      <IconTooltip text={label} />
    </span>
  )
}

type WidthHandleProps = {
  width: number
  onWidthChange: (width: number) => void
  onWidthCommit: (width: number) => void
}

// 사이드바 오른쪽 테두리 너비 손잡이 — 끄는 동안 onWidthChange, 값 확정 시 onWidthCommit (F-159 2.5)
function WidthHandle({ width, onWidthChange, onWidthCommit }: WidthHandleProps) {
  const [dragging, setDragging] = useState(false)
  // 드래그 중 사이드바가 rail 로 접히거나 좁아져 이 컴포넌트가 언마운트되면 mouseup 이 못 와 리스너가 안 지워진다 — 언마운트 시 직접 정리한다
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => cleanupRef.current?.()
  }, [])

  function handleMouseDown(e: ReactMouseEvent<HTMLDivElement>) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    setDragging(true)
    document.body.classList.add('sidebar-resizing')

    function next(clientX: number) {
      return clampSidebarWidth(startWidth + (clientX - startX), window.innerWidth)
    }
    function handleMove(ev: MouseEvent) {
      onWidthChange(next(ev.clientX))
    }
    function cleanup() {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      document.body.classList.remove('sidebar-resizing')
      cleanupRef.current = null
    }
    function handleUp(ev: MouseEvent) {
      cleanup()
      setDragging(false)
      onWidthCommit(next(ev.clientX))
    }
    cleanupRef.current = cleanup
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }

  function handleDoubleClick() {
    onWidthCommit(DEFAULT_SIDEBAR_WIDTH)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onWidthCommit(clampSidebarWidth(width - ARROW_KEY_STEP, window.innerWidth))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onWidthCommit(clampSidebarWidth(width + ARROW_KEY_STEP, window.innerWidth))
    }
  }

  return (
    <div
      className={`sidebar-resize-handle${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="사이드바 너비"
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={maxSidebarWidth(window.innerWidth)}
      aria-valuenow={width}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    />
  )
}

type SidebarProps = {
  sidebarRef: RefObject<HTMLElement | null>
  narrow: boolean
  open: boolean
  collapsed: boolean
  onToggleCollapse: () => void
  docs: DocLike[]
  folders: FolderLike[]
  sharedDocs: SharedDocLike[]
  currentDocId: string | null
  openFolderIds: string[]
  onToggleFolder: (id: string) => void
  onCollapseAllFolders: () => void
  onSelectDoc: (id: string) => void
  onCreateDoc: (folderId?: string | null) => void
  onImportDoc: () => void
  onCreateFolder: (parentId: string | null) => Promise<{ id: string; name: string } | null>
  onRenameFolder: (id: string, name: string) => void
  // 여러 항목 이동 — 폴더로 드래그·최상위로 옮기기 모두 이걸 쓴다(단일 항목도 배열 하나로) (F-255.md 3.3)
  onBulkMove: (items: SelectionItem[], targetFolderId: string | null) => void
  onRequestDeleteDoc: (target: DeleteDocTarget) => void
  onRequestDeleteFolder: (target: DeleteFolderTarget) => void
  onRequestBulkDelete: (items: SelectionItem[]) => void
  onRequestMoveDoc: (target: MoveDocTarget) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onOpenSettings: () => void
  onOpenHelp: () => void
  onOpenMap: () => void
  onOpenSearch: () => void
  canInstall: boolean
  onInstall: () => void
  width: number
  onWidthChange: (width: number) => void
  onWidthCommit: (width: number) => void
  isServerStore: boolean
  onNotice: (notice: Notice) => void
  onRequestInviteFolder: (id: string, name: string) => void
  onExportFolder: (id: string) => void
}

export default function Sidebar({
  sidebarRef,
  narrow,
  open,
  collapsed,
  onToggleCollapse,
  docs,
  folders,
  sharedDocs,
  currentDocId,
  openFolderIds,
  onToggleFolder,
  onCollapseAllFolders,
  onSelectDoc,
  onCreateDoc,
  onImportDoc,
  onCreateFolder,
  onRenameFolder,
  onBulkMove,
  onRequestDeleteDoc,
  onRequestDeleteFolder,
  onRequestBulkDelete,
  onRequestMoveDoc,
  onTogglePin,
  onOpenSettings,
  onOpenHelp,
  onOpenMap,
  onOpenSearch,
  canInstall,
  onInstall,
  width,
  onWidthChange,
  onWidthCommit,
  isServerStore,
  onNotice,
  onRequestInviteFolder,
  onExportFolder,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null)
  // 끌고 있는 항목. 드래그 중에만 바뀌므로 렌더 비용은 무시할 만하다
  const [dragged, setDragged] = useState<Dragged>(null)
  // 여러 항목 선택 — 마우스 전용(F-255.md 1장 "하지 않는다"), Ctrl/Shift+클릭·우클릭으로 바뀐다
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)

  const editingInputRef = useRef<HTMLInputElement | null>(null)
  const skipBlurCommitRef = useRef(false)
  // `새 폴더` 저장소 왕복이 끝나기 전(포커스가 아직 버튼에 있는 사이) Enter·재클릭이 들어와 폴더가 두 번 생기는 문제 방지 (F-246 3.1)
  const creatingFolderRef = useRef(false)

  useEffect(() => {
    if (editingId && editingInputRef.current) {
      editingInputRef.current.focus()
      editingInputRef.current.select()
    }
  }, [editingId])

  // 목록에서 사라진 id 는 선택에서 뺀다 — 렌더 중 상태를 맞추는 공식 패턴, useEffect 에서 바로 setState 하지 않는다 (F-255.md 3.1, D18)
  const visibleIdsKey = [...docs.map((d) => d.id), ...folders.map((f) => f.id)].join(' ')
  const [prunedForKey, setPrunedForKey] = useState(visibleIdsKey)
  if (visibleIdsKey !== prunedForKey) {
    setPrunedForKey(visibleIdsKey)
    const visibleIds = visibleIdsKey === '' ? [] : visibleIdsKey.split(' ')
    const next = pruneSelection(selection, visibleIds)
    if (next.ids.length !== selection.ids.length || next.anchorId !== selection.anchorId) {
      setSelection(next)
    }
  }

  // 빈 곳 클릭·Esc·사이드바 밖 클릭으로 선택 해제 (F-255.md 2장, D7)
  useEffect(() => {
    if (selection.ids.length === 0) return
    function handlePointerDown(e: MouseEvent) {
      const nav = sidebarRef.current
      if (nav && nav.contains(e.target as Node)) return
      setSelection(EMPTY_SELECTION)
    }
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setSelection(EMPTY_SELECTION)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [selection.ids.length, sidebarRef])

  const tree = buildTree({ folders, docs })
  const pinned = pinnedDocs(docs) // F-132.md 2장, 3장

  function startRename(id: string, name: string) {
    skipBlurCommitRef.current = false
    setEditingId(id)
    setEditingValue(name)
  }

  function commitRename() {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false
      return
    }
    if (!editingId) return
    const id = editingId
    const value = editingValue
    setEditingId(null)
    onRenameFolder(id, value)
  }

  function handleRenameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur() // onBlur 가 commitRename 을 부른다
    } else if (e.key === 'Escape') {
      e.preventDefault()
      skipBlurCommitRef.current = true
      setEditingId(null) // 입력 전 이름 유지(커밋하지 않음)
    }
  }

  async function handleCreateFolder(parentId: string | null) {
    if (creatingFolderRef.current) return // 이미 만드는 중 — 조용히 무시 (F-246 3.2)
    creatingFolderRef.current = true
    try {
      const folder = await onCreateFolder(parentId)
      if (folder) startRename(folder.id, folder.name)
    } finally {
      creatingFolderRef.current = false
    }
  }

  // 레일에서 `새 폴더`: 이름 입력 칸이 트리 안에 있어 먼저 펼친다 — 가드가 없으면 재진입마다 접힘·펼침이 뒤집힌다 (F-143 3.3)
  function handleRailCreateFolder() {
    if (creatingFolderRef.current) return
    onToggleCollapse()
    handleCreateFolder(null)
  }

  function kindOf(id: string): 'doc' | 'folder' | null {
    if (docs.some((d) => d.id === id)) return 'doc'
    if (folders.some((f) => f.id === id)) return 'folder'
    return null
  }

  const visibleItems = visibleOrder({ pinnedIds: pinned.map((d) => d.id), tree, openFolderIds })

  // 일반 클릭은 그대로 열고 단독 선택도 겸한다. Ctrl/Cmd 는 더하고 빼기, Shift 는 화면 순서 범위 (F-255.md 2·3.1)
  function handleItemClick(e: ReactMouseEvent<HTMLElement>, item: SelectionItem, action: () => void) {
    if (e.ctrlKey || e.metaKey) {
      setSelection((sel) => toggleSelection(sel, item))
      return
    }
    if (e.shiftKey) {
      setSelection((sel) => extendSelection(sel, item, visibleItems))
      return
    }
    setSelection(replaceSelection(EMPTY_SELECTION, item))
    action()
  }

  // 선택 안 우클릭 → 그 행만 선택하고 단일 메뉴, 선택(2개 이상) 안 우클릭 → 여러 항목 메뉴 (F-255.md 2·3.2)
  function handleRowContextMenu(e: ReactMouseEvent<HTMLDivElement>, item: SelectionItem, isEditingRow: boolean) {
    if (isEditingRow) return // 텍스트 편집 기본 메뉴가 필요하다 (D17)
    e.preventDefault()
    const point = { x: e.clientX, y: e.clientY }
    const inMultiSelection = selection.ids.length > 1 && selection.ids.includes(item.id)
    if (!inMultiSelection) {
      setSelection(replaceSelection(EMPTY_SELECTION, item))
    }
    setContextMenu({ id: item.id, point })
  }

  const selectedItems: SelectionItem[] = selection.ids
    .map((id) => {
      const kind = kindOf(id)
      return kind ? { kind, id } : null
    })
    .filter((v): v is SelectionItem => v !== null)

  // 선택한 것들의 공통 부모 아래 폴더를 만들고 옮긴 뒤 이름 편집을 연다 (F-255.md 2·3.3, D13)
  async function handleGroupIntoFolder() {
    if (creatingFolderRef.current || selectedItems.length === 0) return
    creatingFolderRef.current = true
    try {
      const parentId = commonParentId(selectedItems, docs, folders)
      const folder = await onCreateFolder(parentId)
      if (!folder) return
      onBulkMove(dedupeDescendants(selectedItems, docs, folders), folder.id)
      startRename(folder.id, folder.name)
    } finally {
      creatingFolderRef.current = false
    }
  }

  const multiMenuItems: FolderMenuItem[] = [
    {
      key: 'new-folder',
      label: '새 폴더로 넣기',
      icon: IconFolderAdd,
      onSelect: () => {
        void handleGroupIntoFolder()
      },
    },
    {
      key: 'move-root',
      label: '최상위로 옮기기',
      icon: IconMove,
      onSelect: () => onBulkMove(dedupeDescendants(selectedItems, docs, folders), null),
    },
    {
      key: 'delete',
      label: '삭제',
      icon: IconDelete,
      danger: true,
      onSelect: () => onRequestBulkDelete(selectedItems),
    },
  ]

  // ----- 끌어놓기 (specs/features/F-126.md 5.3, F-255.md 3.4, 마우스 전용) -----
  function handleDragStart(e: DragEvent<HTMLDivElement>, type: 'doc' | 'folder', id: string) {
    const isPartOfSelection = selection.ids.length > 1 && selection.ids.includes(id)
    const items: SelectionItem[] = isPartOfSelection
      ? selection.ids.map((sid) => ({ kind: kindOf(sid) ?? type, id: sid }))
      : [{ kind: type, id }]
    setDragged({ items })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id) // Firefox 는 setData 를 호출해야 드래그가 시작된다
    if (items.length > 1) {
      // 기본 드래그 이미지 대신 개수 배지 (F-255.md 3.4)
      const badge = document.createElement('div')
      badge.className = 'drag-count-badge'
      badge.textContent = `${items.length}개 항목`
      document.body.appendChild(badge)
      e.dataTransfer.setDragImage(badge, 12, 12)
      requestAnimationFrame(() => badge.remove())
    }
  }

  function handleDragEnd() {
    setDragged(null)
    setDropTargetKey(null)
  }

  function canDropOn(target: DropTarget): boolean {
    if (!dragged || dragged.items.length === 0) return false
    if (target.type === 'doc') return false
    // 문서는 폴더 행이나 최상위 빈 영역에만 놓을 수 있다 — 다른 문서 행에 놓으면 폴더 id 자리에 문서 id 가 저장되던 버그 수정 (F-136.md 3.2)
    const targetParentId = target.type === 'root' ? null : target.id
    const hasDoc = dragged.items.some((it) => it.kind === 'doc')
    if (hasDoc) return true
    // 폴더만 끄는 중: 그중 하나라도 이 대상으로 옮길 수 있어야 한다(나머지는 놓을 때 건너뛴다)
    return dragged.items.some((it) => canMoveFolder({ folders, id: it.id, parentId: targetParentId }))
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, target: DropTarget) {
    if (!canDropOn(target)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTargetKey(dropKeyOf(target))
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, target: DropTarget) {
    e.preventDefault()
    const wasDragged = dragged
    setDropTargetKey(null)
    setDragged(null)
    if (!wasDragged || !canDropOn(target)) return
    const targetParentId = target.type === 'root' ? null : target.id
    onBulkMove(dedupeDescendants(wasDragged.items, docs, folders), targetParentId)
  }

  const ctx: SidebarCtx = {
    currentDocId,
    openFolderIds,
    editingId,
    editingValue,
    dropTargetKey,
    onToggleFolder,
    onSelectDoc,
    onCreateDoc,
    onCreateFolder: handleCreateFolder,
    onStartRename: startRename,
    onEditingValueChange: setEditingValue,
    onRenameKeyDown: handleRenameKeyDown,
    onCommitRename: commitRename,
    onRequestDeleteDoc,
    onRequestDeleteFolder,
    onRequestMoveDoc,
    onTogglePin,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    selection,
    contextMenu,
    multiMenuItems,
    onItemClick: handleItemClick,
    onRowContextMenu: handleRowContextMenu,
    onCloseContextMenu: () => setContextMenu(null),
    isServerStore,
    onNotice,
    onRequestInviteFolder,
    onExportFolder,
  }

  const rootTarget: DropTarget = { type: 'root' }
  const isRootDropTarget = dropTargetKey === dropKeyOf(rootTarget)

  const isRail = collapsed && !narrow

  // 좁은 창 겹침 사이드바만 data-state + inert 전환 대상 (F-172.md 2.2), 데스크톱 폭은 대상이 아니다
  const overlayState = narrow ? (open ? 'open' : 'closed') : undefined

  return (
    <nav
      ref={sidebarRef}
      id={SIDEBAR_ID}
      className={`sidebar${narrow ? ' sidebar--overlay' : ''}${isRail ? ' sidebar--collapsed' : ''}`}
      data-state={overlayState}
      inert={overlayState === 'closed'}
      aria-label="문서 목록"
    >
      {/* 사이드바 전체 높이 머리 줄 — 좁은 창 겹침 사이드바에는 없다 (F-159 2.1·2.4) */}
      {!narrow && (
        <SidebarHead
          variant="sidebar"
          expanded={!collapsed}
          collapsed={isRail}
          onToggleSidebar={onToggleCollapse}
          onOpenSearch={onOpenSearch}
        />
      )}
      <div className="sidebar-inner">
        {isRail ? (
          <div className="sidebar-rail-scroll">
            <RailButton icon={IconSearch} label={SEARCH_LABEL} onClick={onOpenSearch} />
            <RailButton icon={IconNoteAdd} label="새 문서" onClick={() => onCreateDoc()} />
            <RailButton icon={IconFolderAdd} label="새 폴더" onClick={handleRailCreateFolder} />
            <RailButton icon={IconUpload} label="가져오기" onClick={onImportDoc} />
            <RailButton icon={IconMap} label="지도" onClick={onOpenMap} />
          </div>
        ) : (
          <>
            {/* 문서 많아져도 같이 스크롤되지 않는 고정 영역 — 동작 버튼·고정됨 묶음
                (2026-09-20 사용자 "고정됨과 함께 스크롤 안되고 상단에 고정으로 표시") */}
            <div className="sidebar-fixed">
              <div className="sidebar-actions">
                <SidebarIconButton icon={IconSearch} label="검색" btnClassName="sidebar-search-btn" onClick={onOpenSearch} />
                <SidebarIconButton icon={IconNoteAdd} label="새 문서" onClick={() => onCreateDoc()} />
                <SidebarIconButton icon={IconFolderAdd} label="새 폴더" onClick={() => handleCreateFolder(null)} />
                <SidebarIconButton icon={IconUpload} label="가져오기" onClick={onImportDoc} />
                <SidebarIconButton icon={IconCollapseAll} label="모두 접기" onClick={onCollapseAllFolders} />
                <SidebarIconButton icon={IconMap} label="지도" onClick={onOpenMap} />
              </div>
              {pinned.length > 0 && (
                <>
                  <h2>
                    <IconPin size={14} />
                    고정됨
                  </h2>
                  <ul className="pinned-list" role="list" aria-label="고정된 문서">
                    {pinned.map((doc) => (
                      <PinnedRow key={doc.id} doc={doc} ctx={ctx} />
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div
              className="sidebar-scroll"
              onClick={(e) => {
                if (e.target === e.currentTarget) setSelection(EMPTY_SELECTION)
              }}
            >
              <SharedGroup sharedDocs={sharedDocs} ctx={ctx} />
              <h2>문서</h2>
              <ul className="doc-list" role="tree" aria-label="문서와 폴더">
                {tree.map((node) => (
                  <TreeNode key={node.id} node={node} depth={0} ctx={ctx} editingInputRef={editingInputRef} />
                ))}
              </ul>
              <div
                className={`tree-root-drop${isRootDropTarget ? ' tree-row--drop' : ''}`}
                onDragOver={(e) => handleDragOver(e, rootTarget)}
                onDrop={(e) => handleDrop(e, rootTarget)}
                onClick={() => setSelection(EMPTY_SELECTION)}
              />
            </div>
          </>
        )}

        <div className={isRail ? 'sidebar-rail-bottom' : 'sidebar-bottom'}>
          {canInstall &&
            (isRail ? (
              <RailButton icon={IconInstall} label="앱 설치" onClick={onInstall} />
            ) : (
              <SidebarButton icon={IconInstall} label="앱 설치" onClick={onInstall} />
            ))}
          {isRail ? (
            <>
              <RailButton icon={IconHelp} label="도움말" onClick={onOpenHelp} />
              <RailButton icon={IconGuide} label="사용법" href={GUIDES_PATH} />
              <RailButton icon={IconSettings} label="설정" onClick={onOpenSettings} />
            </>
          ) : (
            <>
              <SidebarButton icon={IconHelp} label="도움말" onClick={onOpenHelp} />
              <SidebarButton icon={IconGuide} label="사용법" href={GUIDES_PATH} />
              <SidebarButton icon={IconSettings} label="설정" onClick={onOpenSettings} />
            </>
          )}
        </div>
      </div>
      {/* 너비 손잡이 — 레일·좁은 창에는 없다 (F-159 2.5) */}
      {!narrow && !isRail && <WidthHandle width={width} onWidthChange={onWidthChange} onWidthCommit={onWidthCommit} />}
    </nav>
  )
}
