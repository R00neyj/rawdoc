// 오른쪽 패널 `링크`·`할 일` 보기 — 보일 때만 목록을 한 번 읽어 둘이 나눠 쓴다. 지금 문서는 편집기 본문 기준 (small 2026-10-11)
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { findIncomingLinks, findOutgoingLinks, MENTION_MIN_LENGTH, type IncomingLinks, type OutgoingLinkRow } from '../lib/docLinks'
import { findOpenTodos, groupTodos, scanTodoSources, type TodoGroup } from '../lib/docTodos'
import type { WikiResolver } from '../lib/wikiResolve'
import type { EditorHandle } from '../editor/Editor'
import type { DocMeta } from './docMeta'
import type { PendingJump } from './useEditorSync'
import type { Doc, Folder } from '../types'

// 다른 문서의 저장·동기화가 몰려 와도 목록 읽기는 한 번만
const LIST_DEBOUNCE_MS = 300

export type DocLinksView = {
  hasDoc: boolean
  incoming: IncomingLinks | null
  mentionsOff: boolean
  outgoing: OutgoingLinkRow[]
  onOpenDoc: (id: string) => void
  onOpenTarget: (target: string) => void
}

export type DocTodosView = {
  todos: { groups: TodoGroup[]; truncated: boolean; lockedCount: number } | null
  onOpenItem: (docId: string, line: number) => void
}

export function usePanelDocs(options: {
  linksActive: boolean
  todosActive: boolean
  listSource: { list(): Promise<Doc[]> }
  docs: DocMeta[]
  folders: Folder[]
  currentDoc: DocMeta | null
  editor: Pick<EditorHandle, 'getText' | 'onHeadingsChange'> | null
  resolver: WikiResolver
  e2eeOpen: boolean
  selectDoc: (id: string) => Promise<void>
  openWikiLinkTarget: (target: string) => Promise<void>
  pendingJumpRef: RefObject<PendingJump | null>
  jumpToLine: (line: number) => void
  afterOpen: () => void
}): { links: DocLinksView; todos: DocTodosView } {
  const { linksActive, todosActive, listSource, docs, folders, currentDoc, editor, resolver, e2eeOpen } = options
  const { selectDoc, openWikiLinkTarget, pendingJumpRef, jumpToLine, afterOpen } = options
  const active = linksActive || todosActive
  const currentId = currentDoc && currentDoc.e2ee !== 'locked' ? currentDoc.id : null
  const currentTitle = currentDoc?.title ?? ''
  const currentFolderId = currentDoc?.folderId ?? null
  const current = useMemo(
    () => (currentId ? { id: currentId, title: currentTitle, folderId: currentFolderId } : null),
    [currentId, currentTitle, currentFolderId],
  )

  // 목차 알림은 본문이 바뀔 때마다(조합이 끝난 뒤) 디바운스로 온다 — 지금 문서의 링크·할 일도 그 박자로 다시 읽는다
  const [textTick, setTextTick] = useState(0)
  useEffect(() => {
    if (!active || !editor) return
    return editor.onHeadingsChange(() => setTextTick((n) => n + 1))
  }, [active, editor])
  // textTick 은 편집기 본문이 바뀌었을 때만 올라 다시 읽게 하는 의존이다
  const currentText = useMemo(
    () => (active && editor && current ? editor.getText('lf') : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, editor, current, textTick],
  )

  // 지금 문서의 저장은 다른 문서 쪽 결과를 바꾸지 않는다 — 다른 문서의 판·제목·폴더가 바뀔 때만 다시 읽는다
  const othersKey = useMemo(
    () => docs.map((d) => (d.id === currentId ? '' : `${d.id}\u0000${d.updatedAt}\u0000${d.title}\u0000${d.folderId ?? ''}`)).join('\u0001'),
    [docs, currentId],
  )
  const resolverRef = useRef(resolver)
  useEffect(() => {
    resolverRef.current = resolver
  })
  const lastIdRef = useRef<string | null>(null)
  const [listed, setListed] = useState<{ forId: string | null; sources: Doc[]; incoming: IncomingLinks | null } | null>(null)
  // 금고 상태가 바뀌면 같은 렌더에서 읽어 둔 목록을 버린다 — 잠근 뒤 평문이 남지 않게 (F-409 3.6 과 같은 규칙)
  const [trackedE2eeOpen, setTrackedE2eeOpen] = useState(e2eeOpen)
  if (e2eeOpen !== trackedE2eeOpen) {
    setTrackedE2eeOpen(e2eeOpen)
    setListed(null)
  }

  const needList = todosActive || (linksActive && current !== null)
  useEffect(() => {
    if (!needList) return
    let cancelled = false
    const forId = current?.id ?? null
    const timer = setTimeout(
      async () => {
        try {
          const sources = await listSource.list()
          if (cancelled) return
          lastIdRef.current = forId
          const incoming = linksActive && current ? findIncomingLinks({ current, sources, resolver: resolverRef.current }) : null
          setListed({ forId, sources, incoming })
        } catch (err) {
          console.error('panel_docs_failed', err)
        }
      },
      lastIdRef.current === forId ? LIST_DEBOUNCE_MS : 0,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [needList, linksActive, current, othersKey, folders, listSource, e2eeOpen])

  const outgoing = useMemo(
    () => (linksActive && current && currentText !== null ? findOutgoingLinks({ text: currentText, current, resolver }) : []),
    [linksActive, current, currentText, resolver],
  )
  const otherTodos = useMemo(() => (todosActive && listed ? scanTodoSources(listed.sources, currentId) : null), [todosActive, listed, currentId])
  const todos = useMemo(() => {
    if (!otherTodos) return null
    const own = current && currentText !== null ? { id: current.id, title: current.title, items: findOpenTodos(currentText) } : null
    return { ...groupTodos(own, otherTodos.docs), lockedCount: otherTodos.lockedCount }
  }, [otherTodos, current, currentText])

  return {
    links: {
      hasDoc: current !== null,
      incoming: current && listed?.forId === current.id ? listed.incoming : null,
      mentionsOff: Array.from(currentTitle.trim()).length < MENTION_MIN_LENGTH,
      outgoing,
      onOpenDoc: (id) => {
        afterOpen()
        void selectDoc(id)
      },
      onOpenTarget: (target) => {
        afterOpen()
        void openWikiLinkTarget(target)
      },
    },
    todos: {
      todos,
      onOpenItem: (docId, line) => {
        afterOpen()
        if (docId === currentId) {
          void selectDoc(docId).then(() => jumpToLine(line))
          return
        }
        // 다른 문서는 열려 그려진 뒤 useEditorSync 가 한 번 이동한다
        pendingJumpRef.current = { docId, line }
        void selectDoc(docId)
      },
    },
  }
}
