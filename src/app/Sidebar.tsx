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
} from './icons'
import type { Notice } from './notice'

export { SIDEBAR_ID }

type DropTarget = { type: 'folder'; id: string } | { type: 'doc'; id: string } | { type: 'root' }
type Dragged = { type: 'doc' | 'folder'; id: string } | null

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
  // 폴더 읽기 전용 링크 메뉴 항목 노출 조건·알림 (F-211.md 2.4) — App.tsx 에 경로가 없어 최소 전달만 한다
  isServerStore: boolean
  onNotice: (notice: Notice) => void
  // 폴더 `⋯` 메뉴 `사람 초대…` (F-212.md 2.5)
  onRequestInviteFolder: (id: string, name: string) => void
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

  const items: FolderMenuItem[] = [
    { key: 'new-doc', label: '새 문서', icon: IconNoteAdd, onSelect: () => ctx.onCreateDoc(node.id) },
  ]
  if (node.parentId === null) {
    items.push({
      key: 'new-subfolder',
      label: '하위 폴더',
      icon: IconFolderAdd,
      onSelect: () => ctx.onCreateFolder(node.id),
    })
  }
  items.push({ key: 'rename', label: '이름 변경', icon: IconEdit, onSelect: () => ctx.onStartRename(node.id, node.name) })
  items.push({
    key: 'delete',
    label: '삭제',
    icon: IconDelete,
    danger: true,
    onSelect: () => ctx.onRequestDeleteFolder({ id: node.id, name: node.name }),
  })

  return (
    <li role="treeitem" aria-expanded={isOpen} className="tree-item">
      <div
        className={`tree-row${isDropTarget ? ' tree-row--drop' : ''}`}
        style={{ '--depth': depth } as CSSProperties}
        draggable={!isEditing}
        onDragStart={(e) => ctx.onDragStart(e, 'folder', node.id)}
        onDragEnd={ctx.onDragEnd}
        onDragOver={(e) => ctx.onDragOver(e, target)}
        onDrop={(e) => ctx.onDrop(e, target)}
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
          <button type="button" className="tree-label" onClick={() => ctx.onToggleFolder(node.id)}>
            {node.name}
          </button>
        )}
        {!isEditing && (
          <FolderMenu
            label={node.name}
            items={items}
            shareFolderId={ctx.isServerStore ? node.id : undefined}
            onNotice={ctx.onNotice}
            onInvite={ctx.isServerStore ? () => ctx.onRequestInviteFolder(node.id, node.name) : undefined}
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

  const items: FolderMenuItem[] = [
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

  return (
    <li role="treeitem" className="tree-item">
      <div
        className={`tree-row${isDropTarget ? ' tree-row--drop' : ''}`}
        style={{ '--depth': depth } as CSSProperties}
        draggable
        onDragStart={(e) => ctx.onDragStart(e, 'doc', node.id)}
        onDragEnd={ctx.onDragEnd}
        onDragOver={(e) => ctx.onDragOver(e, target)}
        onDrop={(e) => ctx.onDrop(e, target)}
      >
        <span className="tree-toggle-spacer" aria-hidden="true" />
        <button
          type="button"
          className="tree-label doc-item-btn"
          aria-current={node.id === ctx.currentDocId ? 'page' : undefined}
          onClick={() => ctx.onSelectDoc(node.id)}
        >
          {node.title}
        </button>
        <FolderMenu label={node.title} items={items} />
      </div>
    </li>
  )
}

// 사이드바 맨 위 `고정됨` 묶음의 항목 — 트리와 별도로 role="list"/listitem, 들여쓰기 없음, 토글 자리엔 IconPin (F-143 3.2, F-132.md 3·4장)
function PinnedRow({ doc, ctx }: { doc: DocLike; ctx: SidebarCtx }) {
  const items: FolderMenuItem[] = [
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

  return (
    <li role="listitem" className="tree-item">
      <div className="tree-row">
        <span className="tree-toggle-spacer" aria-hidden="true">
          <IconPin size={16} className="pinned-row-icon" />
        </span>
        <button
          type="button"
          className="tree-label doc-item-btn"
          aria-current={doc.id === ctx.currentDocId ? 'page' : undefined}
          onClick={() => ctx.onSelectDoc(doc.id)}
        >
          {doc.title}
        </button>
        <FolderMenu label={doc.title} items={items} />
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
        <button
          type="button"
          className="tree-label doc-item-btn"
          aria-current={doc.id === ctx.currentDocId ? 'page' : undefined}
          onClick={() => ctx.onSelectDoc(doc.id)}
        >
          {doc.title}
        </button>
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
}

// 접힘 레일의 아이콘 전용 버튼(F-143 3.3, 툴팁은 오른쪽) — props.icon 을 구조 분해로 대문자 별칭하면 no-unused-vars 가 JSX 태그 참조를 못 잡는다
function RailButton(props: RailButtonProps) {
  const { label, onClick, ariaDisabled, buttonRef, ariaExpanded } = props
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
  hint?: string
  icon: ComponentType<{ size?: number; className?: string }>
  onClick?: () => void
  ariaDisabled?: boolean
}

// 펼친 사이드바의 아이콘+글자 동작 버튼 (F-143 3.2). hint 는 `검색` 의 `준비 중` 문구
function SidebarButton(props: SidebarButtonProps) {
  const { label, hint, onClick, ariaDisabled } = props
  return (
    <button type="button" className="sidebar-btn" aria-disabled={ariaDisabled || undefined} onClick={onClick}>
      <props.icon size={18} className="sidebar-btn-icon" />
      <span className="sidebar-btn-label">{label}</span>
      {hint && <span className="sidebar-btn-hint">{hint}</span>}
    </button>
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
    function handleUp(ev: MouseEvent) {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
      document.body.classList.remove('sidebar-resizing')
      setDragging(false)
      onWidthCommit(next(ev.clientX))
    }
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
  onSelectDoc: (id: string) => void
  onCreateDoc: (folderId?: string | null) => void
  onImportDoc: () => void
  onCreateFolder: (parentId: string | null) => Promise<{ id: string; name: string } | null>
  onRenameFolder: (id: string, name: string) => void
  onMoveFolder: (id: string, parentId: string | null) => void
  onMoveDoc: (id: string, folderId: string | null) => void
  onRequestDeleteDoc: (target: DeleteDocTarget) => void
  onRequestDeleteFolder: (target: DeleteFolderTarget) => void
  onRequestMoveDoc: (target: MoveDocTarget) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onOpenSettings: () => void
  canInstall: boolean
  onInstall: () => void
  width: number
  onWidthChange: (width: number) => void
  onWidthCommit: (width: number) => void
  isServerStore: boolean
  onNotice: (notice: Notice) => void
  onRequestInviteFolder: (id: string, name: string) => void
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
  onSelectDoc,
  onCreateDoc,
  onImportDoc,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onMoveDoc,
  onRequestDeleteDoc,
  onRequestDeleteFolder,
  onRequestMoveDoc,
  onTogglePin,
  onOpenSettings,
  canInstall,
  onInstall,
  width,
  onWidthChange,
  onWidthCommit,
  isServerStore,
  onNotice,
  onRequestInviteFolder,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null)
  // 끌고 있는 항목. 드래그 중에만 바뀌므로 렌더 비용은 무시할 만하다
  const [dragged, setDragged] = useState<Dragged>(null)

  const editingInputRef = useRef<HTMLInputElement | null>(null)
  const skipBlurCommitRef = useRef(false)

  useEffect(() => {
    if (editingId && editingInputRef.current) {
      editingInputRef.current.focus()
      editingInputRef.current.select()
    }
  }, [editingId])

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
    const folder = await onCreateFolder(parentId)
    if (folder) startRename(folder.id, folder.name)
  }

  // 레일에서 `새 폴더`: 이름 입력 칸은 트리 안에 있으므로 먼저 사이드바를 펼친 뒤 이름 입력을 시작한다 (F-143 3.3)
  function handleRailCreateFolder() {
    onToggleCollapse()
    handleCreateFolder(null)
  }

  // ----- 끌어놓기 (specs/features/F-126.md 5.3, 마우스 전용) -----
  function handleDragStart(e: DragEvent<HTMLDivElement>, type: 'doc' | 'folder', id: string) {
    setDragged({ type, id })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id) // Firefox 는 setData 를 호출해야 드래그가 시작된다
  }

  function handleDragEnd() {
    setDragged(null)
    setDropTargetKey(null)
  }

  function canDropOn(target: DropTarget): boolean {
    if (!dragged) return false
    if (dragged.type === 'doc') {
      // 문서는 폴더 행이나 최상위 빈 영역에만 놓을 수 있다 — 다른 문서 행에 놓으면 폴더 id 자리에 문서 id 가 저장되던 버그 수정 (F-136.md 3.2)
      return target.type === 'folder' || target.type === 'root'
    }
    // 폴더를 끄는 중: 대상이 최상위 폴더 행이거나 최상위 빈 영역일 때만 유효할 수 있다
    const targetParentId = target.type === 'root' ? null : target.id
    return canMoveFolder({ folders, id: dragged.id, parentId: targetParentId })
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
    if (wasDragged.type === 'doc') {
      onMoveDoc(wasDragged.id, targetParentId)
    } else {
      onMoveFolder(wasDragged.id, targetParentId)
    }
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
    isServerStore,
    onNotice,
    onRequestInviteFolder,
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
        <SidebarHead variant="sidebar" expanded={!collapsed} collapsed={isRail} onToggleSidebar={onToggleCollapse} />
      )}
      <div className="sidebar-inner">
        {isRail ? (
          <div className="sidebar-rail-scroll">
            <RailButton icon={IconSearch} label={SEARCH_LABEL} ariaDisabled />
            <RailButton icon={IconNoteAdd} label="새 문서" onClick={() => onCreateDoc()} />
            <RailButton icon={IconFolderAdd} label="새 폴더" onClick={handleRailCreateFolder} />
            <RailButton icon={IconUpload} label="가져오기" onClick={onImportDoc} />
          </div>
        ) : (
          <div className="sidebar-scroll">
            <SidebarButton icon={IconNoteAdd} label="새 문서" onClick={() => onCreateDoc()} />
            <SidebarButton icon={IconFolderAdd} label="새 폴더" onClick={() => handleCreateFolder(null)} />
            <SidebarButton icon={IconUpload} label="가져오기" onClick={onImportDoc} />
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
            />
          </div>
        )}

        <div className={isRail ? 'sidebar-rail-bottom' : 'sidebar-bottom'}>
          {canInstall &&
            (isRail ? (
              <RailButton icon={IconInstall} label="앱 설치" onClick={onInstall} />
            ) : (
              <SidebarButton icon={IconInstall} label="앱 설치" onClick={onInstall} />
            ))}
          {isRail ? (
            <RailButton icon={IconSettings} label="설정" onClick={onOpenSettings} />
          ) : (
            <SidebarButton icon={IconSettings} label="설정" onClick={onOpenSettings} />
          )}
        </div>
      </div>
      {/* 너비 손잡이 — 레일·좁은 창에는 없다 (F-159 2.5) */}
      {!narrow && !isRail && <WidthHandle width={width} onWidthChange={onWidthChange} onWidthCommit={onWidthCommit} />}
    </nav>
  )
}
