// 사이드바 (specs/ia.md 2장 B, 3.11, 3.22, specs/features/F-111.md·F-114.md·F-121.md·F-115.md·F-126.md·F-132.md·F-143.md)
// 폴더 2단계 트리, 항목 `⋯` 메뉴, 마우스 끌어놓기로 문서·폴더 이동 (F-126.md 4·5장)
// 맨 위 `고정됨` 묶음 (F-132.md 3장). 접기·아이콘·행 모양은 F-143
import { useEffect, useRef, useState } from 'react'
import { buildTree, canMoveFolder, pinnedDocs } from '../lib/folderTree.js'
import FolderMenu from './FolderMenu.jsx'
import {
  IconChevron,
  IconNoteAdd,
  IconFolderAdd,
  IconUpload,
  IconSettings,
  IconInstall,
  IconPin,
  IconUnpin,
  IconMove,
  IconDelete,
  IconEdit,
  IconTooltip,
} from './icons.jsx'

// 상단바 토글의 aria-controls 가 참조한다 (F-151 2.2)
export const SIDEBAR_ID = 'sidebar-nav'

function dropKeyOf(target) {
  return target.type === 'root' ? 'root' : `${target.type}:${target.id}`
}

// 문서 `⋯` 메뉴 맨 위 `상단 고정`/`고정 해제` 항목 — 트리·묶음 모두 같은 규칙
// (F-132.md 4장)
function pinMenuItem(doc, onTogglePin) {
  const isPinned = doc.pinnedAt != null
  return {
    key: 'pin',
    label: isPinned ? '고정 해제' : '상단 고정',
    icon: isPinned ? IconUnpin : IconPin,
    onSelect: () => onTogglePin(doc.id, !isPinned),
  }
}

// 트리 한 항목(폴더 또는 문서) — 재귀 렌더링. 실제 콜백은 전부 ctx 를 거쳐 Sidebar 의 함수를
// 부른다. 여기서 직접 ref.current 를 읽지 않는다(별도 컴포넌트라 Sidebar 의 rename·drag
// ref 는 이 컴포넌트의 렌더 중에는 관여하지 않고, 이벤트가 실제로 일어날 때만 실행된다)
function TreeNode({ node, depth, ctx, editingInputRef }) {
  if (node.type === 'folder') {
    return <FolderRow node={node} depth={depth} ctx={ctx} editingInputRef={editingInputRef} />
  }
  return <DocRow node={node} depth={depth} ctx={ctx} />
}

// editingInputRef 는 ctx 밖에서 별도 prop 으로 받는다(ref 를 다른 값들과 한 객체에 담으면
// 정적 분석이 그 객체 전체를 "ref" 로 취급해 렌더 중 접근을 막는다)
function FolderRow({ node, depth, ctx, editingInputRef }) {
  const isOpen = ctx.openFolderIds.includes(node.id)
  const isEditing = ctx.editingId === node.id
  const target = { type: 'folder', id: node.id }
  const isDropTarget = ctx.dropTargetKey === dropKeyOf(target)

  const items = [{ key: 'new-doc', label: '새 문서', icon: IconNoteAdd, onSelect: () => ctx.onCreateDoc(node.id) }]
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
        style={{ '--depth': depth }}
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
        {!isEditing && <FolderMenu label={node.name} items={items} />}
      </div>
      {isOpen && node.children.length > 0 && (
        <ul role="group" className="tree-group" style={{ '--depth': depth }}>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              ctx={ctx}
              editingInputRef={editingInputRef}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function DocRow({ node, depth, ctx }) {
  const target = { type: 'doc', id: node.id }
  const isDropTarget = ctx.dropTargetKey === dropKeyOf(target)

  const items = [
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
        style={{ '--depth': depth }}
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

// 사이드바 맨 위 `고정됨` 묶음의 항목 — 트리와 별도로 `role="list"`/`listitem` 이고
// 들여쓰기가 없다. 토글 자리에는 IconPin 을 둔다(F-143 3.2). 문서 삭제 시 목록에서
// 빠지므로 별도 처리가 필요 없다 (F-132.md 3·4장)
function PinnedRow({ doc, ctx }) {
  const items = [
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

// 접힘 레일의 아이콘 전용 버튼 (F-143 3.3). 툴팁은 버튼 오른쪽. `props.icon` 으로 접근하는
// 것은 item.icon·mode.Icon 과 같은 관례다(구조 분해로 알파벳 대문자 별칭을 주면 no-unused-vars
// 가 JSX 태그 이름 참조를 잡지 못한다)
function RailButton(props) {
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

// 펼친 사이드바의 아이콘+글자 동작 버튼 (F-143 3.2). hint 는 `검색` 의 `준비 중` 문구
function SidebarButton(props) {
  const { label, hint, onClick, ariaDisabled } = props
  return (
    <button
      type="button"
      className="sidebar-btn"
      aria-disabled={ariaDisabled || undefined}
      onClick={onClick}
    >
      <props.icon size={18} className="sidebar-btn-icon" />
      <span className="sidebar-btn-label">{label}</span>
      {hint && <span className="sidebar-btn-hint">{hint}</span>}
    </button>
  )
}

export default function Sidebar({
  sidebarRef,
  narrow,
  open,
  collapsed,
  onToggleCollapse,
  docs,
  folders,
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
}) {
  const [editingId, setEditingId] = useState(null)
  const [editingValue, setEditingValue] = useState('')
  const [dropTargetKey, setDropTargetKey] = useState(null)
  // 끌고 있는 항목. 드래그 중에만 바뀌므로 렌더 비용은 무시할 만하다
  const [dragged, setDragged] = useState(null) // { type:'doc'|'folder', id } | null

  const editingInputRef = useRef(null)
  const skipBlurCommitRef = useRef(false)

  useEffect(() => {
    if (editingId && editingInputRef.current) {
      editingInputRef.current.focus()
      editingInputRef.current.select()
    }
  }, [editingId])

  const tree = buildTree({ folders, docs })
  const pinned = pinnedDocs(docs) // F-132.md 2장, 3장

  function startRename(id, name) {
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

  function handleRenameKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur() // onBlur 가 commitRename 을 부른다
    } else if (e.key === 'Escape') {
      e.preventDefault()
      skipBlurCommitRef.current = true
      setEditingId(null) // 입력 전 이름 유지(커밋하지 않음)
    }
  }

  async function handleCreateFolder(parentId) {
    const folder = await onCreateFolder(parentId)
    if (folder) startRename(folder.id, folder.name)
  }

  // 레일에서 `새 폴더`: 펼친 뒤 이름 입력을 시작한다 — 이름 입력 칸은 트리 안에 있으므로
  // 먼저 사이드바를 펼쳐야 보인다 (F-143 3.3)
  function handleRailCreateFolder() {
    onToggleCollapse()
    handleCreateFolder(null)
  }

  // ----- 끌어놓기 (specs/features/F-126.md 5.3, 마우스 전용) -----
  function handleDragStart(e, type, id) {
    setDragged({ type, id })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id) // Firefox 는 setData 를 호출해야 드래그가 시작된다
  }

  function handleDragEnd() {
    setDragged(null)
    setDropTargetKey(null)
  }

  function canDropOn(target) {
    if (!dragged) return false
    if (dragged.type === 'doc') {
      // 문서는 폴더 행이나 최상위 빈 영역에만 놓을 수 있다. 다른 문서 행에는 놓을 수 없다
      // — 놓으면 폴더 id 자리에 문서 id 가 저장되던 버그 수정 (F-136.md 3.2)
      return target.type === 'folder' || target.type === 'root'
    }
    // 폴더를 끄는 중: 대상이 최상위 폴더 행이거나 최상위 빈 영역일 때만 유효할 수 있다
    const targetParentId = target.type === 'root' ? null : target.id
    return canMoveFolder({ folders, id: dragged.id, parentId: targetParentId })
  }

  function handleDragOver(e, target) {
    if (!canDropOn(target)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTargetKey(dropKeyOf(target))
  }

  function handleDrop(e, target) {
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

  const ctx = {
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
  }

  const rootTarget = { type: 'root' }
  const isRootDropTarget = dropTargetKey === dropKeyOf(rootTarget)

  const isRail = collapsed && !narrow

  return (
    <nav
      ref={sidebarRef}
      id={SIDEBAR_ID}
      className={`sidebar${narrow ? ' sidebar--overlay' : ''}${isRail ? ' sidebar--collapsed' : ''}`}
      hidden={narrow && !open}
      aria-label="문서 목록"
    >
      {isRail ? (
        <div className="sidebar-rail-scroll">
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
    </nav>
  )
}
