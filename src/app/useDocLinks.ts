// 오른쪽 패널 `링크` 보기 — 보일 때만 읽는다. 나가는 링크는 편집기 본문, 백링크·언급은 저장된 다른 문서 (small 2026-10-11)
import { useEffect, useMemo, useRef, useState } from 'react'
import { findIncomingLinks, findOutgoingLinks, MENTION_MIN_LENGTH, type IncomingLinks, type OutgoingLinkRow } from '../lib/docLinks'
import type { WikiResolver } from '../lib/wikiResolve'
import type { EditorHandle } from '../editor/Editor'
import type { DocMeta } from './docMeta'
import type { Doc, Folder } from '../types'

// 다른 문서의 저장·동기화가 몰려 와도 목록 읽기는 한 번만
const INCOMING_DEBOUNCE_MS = 300

export type DocLinksView = {
  hasDoc: boolean
  incoming: IncomingLinks | null
  mentionsOff: boolean
  outgoing: OutgoingLinkRow[]
  onOpenDoc: (id: string) => void
  onOpenTarget: (target: string) => void
}

export function useDocLinks(options: {
  active: boolean
  listSource: { list(): Promise<Doc[]> }
  docs: DocMeta[]
  folders: Folder[]
  currentDoc: DocMeta | null
  editor: Pick<EditorHandle, 'getText' | 'onHeadingsChange'> | null
  resolver: WikiResolver
  e2eeOpen: boolean
  selectDoc: (id: string) => Promise<void>
  openWikiLinkTarget: (target: string) => Promise<void>
  afterOpen: () => void
}): DocLinksView {
  const { active, listSource, docs, folders, currentDoc, editor, resolver, e2eeOpen, selectDoc, openWikiLinkTarget, afterOpen } = options
  const currentId = currentDoc && currentDoc.e2ee !== 'locked' ? currentDoc.id : null
  const currentTitle = currentDoc?.title ?? ''
  const currentFolderId = currentDoc?.folderId ?? null
  const current = useMemo(
    () => (currentId ? { id: currentId, title: currentTitle, folderId: currentFolderId } : null),
    [currentId, currentTitle, currentFolderId],
  )

  // 목차 알림은 본문이 바뀔 때마다(조합이 끝난 뒤) 디바운스로 온다 — 나가는 링크도 그 박자로 다시 읽는다
  const [textTick, setTextTick] = useState(0)
  useEffect(() => {
    if (!active || !editor) return
    return editor.onHeadingsChange(() => setTextTick((n) => n + 1))
  }, [active, editor])
  // textTick 은 편집기 본문이 바뀌었을 때만 올라 다시 계산하게 하는 의존이다
  const outgoing = useMemo(() => {
    if (!active || !editor || !current) return []
    return findOutgoingLinks({ text: editor.getText('lf'), current, resolver })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, editor, current, resolver, textTick])

  // 지금 문서의 저장은 백링크·언급을 바꾸지 않는다 — 다른 문서의 판·제목·폴더가 바뀔 때만 다시 읽는다
  const othersKey = useMemo(
    () => docs.map((d) => (d.id === currentId ? '' : `${d.id}\u0000${d.updatedAt}\u0000${d.title}\u0000${d.folderId ?? ''}`)).join('\u0001'),
    [docs, currentId],
  )
  const resolverRef = useRef(resolver)
  useEffect(() => {
    resolverRef.current = resolver
  })
  const lastIdRef = useRef<string | null>(null)
  const [incoming, setIncoming] = useState<{ docId: string; links: IncomingLinks } | null>(null)
  // 금고 상태가 바뀌면 같은 렌더에서 결과를 버린다 — 잠근 뒤 평문 발췌가 남지 않게 (F-409 3.6 과 같은 규칙)
  const [trackedE2eeOpen, setTrackedE2eeOpen] = useState(e2eeOpen)
  if (e2eeOpen !== trackedE2eeOpen) {
    setTrackedE2eeOpen(e2eeOpen)
    setIncoming(null)
  }

  useEffect(() => {
    if (!active || !current) return
    let cancelled = false
    const timer = setTimeout(
      async () => {
        try {
          const sources = await listSource.list()
          if (cancelled) return
          lastIdRef.current = current.id
          setIncoming({ docId: current.id, links: findIncomingLinks({ current, sources, resolver: resolverRef.current }) })
        } catch (err) {
          console.error('doc_links_failed', err)
        }
      },
      lastIdRef.current === current.id ? INCOMING_DEBOUNCE_MS : 0,
    )
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [active, current, othersKey, folders, listSource, e2eeOpen])

  return {
    hasDoc: current !== null,
    incoming: current && incoming?.docId === current.id ? incoming.links : null,
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
  }
}
