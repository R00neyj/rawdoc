// 뒤로·앞으로 가기·주소창 직접 수정(hashchange)과 해시 주소 쓰기 — App.tsx 에서 옮김 (F-2071, F-2059)
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { Folder } from '../types'
import type { ShareDoc } from '../lib/shareCodec'
import type { DocMeta } from './docMeta'
import type { NoticeWithAction } from './NoticeBar'
import type { UseDocCommentsResult } from './useDocComments'
import { formatHash, formatMapHash } from './hashRoute'
import { decideHashNav } from './hashNav'
import { leaveScreens } from './leaveScreens'
import { setPref } from './prefs'
import { ancestorsOfDoc } from '../lib/folderTree'

export function replaceHashUrl(docId: string | null) {
  const url = `${location.pathname}${location.search}${formatHash(docId)}`
  history.replaceState(null, '', url)
}

// location.hash 대입과 달리 hashchange 를 일으키지 않아 상태 갱신과 리렌더 사이 경쟁을 없앤다 (0단계 버그 수정, ia.md 3.10)
export function pushHashUrl(docId: string | null) {
  const url = `${location.pathname}${location.search}${formatHash(docId)}`
  history.pushState(null, '', url)
}

// `#/help` 로 들어갈 때 — 같은 이유로 pushState 를 써서 뒤로 가기가 자연스럽게 이전 화면으로 돌아간다 (F-244.md 3.3)
export function pushHelpHash() {
  const url = `${location.pathname}${location.search}#/help`
  history.pushState(null, '', url)
}

export type UseHashRoutingOptions = {
  bootPhase: 'booting' | 'ready'
  beforeLeaveDoc: () => Promise<void>
  showNotice: (input: NoticeWithAction) => number
  addOpenFolders: (ids: string[] | null | undefined) => void
  openSharedFragment: (fragment: string, docsForFallback: DocMeta[]) => Promise<void>
  setSharedDoc: Dispatch<SetStateAction<ShareDoc | null>>
  setSharesOpen: Dispatch<SetStateAction<boolean>>
  setHelpOpen: Dispatch<SetStateAction<boolean>>
  setMapRoute: Dispatch<SetStateAction<{ centerDocId: string | null; returnDocId: string | null } | null>>
  setCurrentDocId: Dispatch<SetStateAction<string | null>>
  docsRef: RefObject<DocMeta[]>
  foldersRef: RefObject<Folder[]>
  currentDocIdRef: RefObject<string | null>
  sharedDocRef: RefObject<ShareDoc | null>
  sharesOpenRef: RefObject<boolean>
  helpOpenRef: RefObject<boolean>
  mapRouteRef: RefObject<{ centerDocId: string | null; returnDocId: string | null } | null>
  focusEditorRef: RefObject<boolean>
  commentsRef: RefObject<UseDocCommentsResult>
}

export function useHashRouting(options: UseHashRoutingOptions): void {
  const {
    bootPhase, beforeLeaveDoc, showNotice, addOpenFolders, openSharedFragment, setSharedDoc, setSharesOpen, setHelpOpen, setMapRoute,
    setCurrentDocId, docsRef, foldersRef, currentDocIdRef, sharedDocRef, sharesOpenRef, helpOpenRef, mapRouteRef, focusEditorRef, commentsRef,
  } = options

  // docs·currentDocId 는 ref 로 읽는다 — bootPhase 변경시만 재구독해 클로저에 담으면 낡은 값을 본다 (0단계 버그 수정)
  useEffect(() => {
    if (bootPhase !== 'ready') return

    const leave = () => leaveScreens({ setSharedDoc, setSharesOpen, setHelpOpen, setMapRoute })

    function handleHashChange() {
      const hashAtEntry = location.hash
      const nav = decideHashNav({
        hash: location.hash, pathname: location.pathname, currentDocId: currentDocIdRef.current, sharedDoc: sharedDocRef.current,
        sharesOpen: sharesOpenRef.current, helpOpen: helpOpenRef.current, mapRoute: mapRouteRef.current,
      })
      if (nav.kind === 'ignore') return

      // 공유 링크는 currentDocId 와 비교하지 않고 매번 새로 연다 — 공유 화면 동안 건드리지 않아 같은 값일 수 있다 (F-130.md 4장)
      if (nav.kind === 'share') {
        ;(async () => {
          await beforeLeaveDoc()
          if (location.hash !== hashAtEntry) return // await 중 주소가 또 바뀌었으면 뒤 핸들러에 맡긴다
          setSharesOpen(false) // 공유 보기를 닫았을 때 밑에 공유 관리·도움말이 드러나지 않게 (F-2059 D12)
          setHelpOpen(false)
          setMapRoute(null)
          await openSharedFragment(nav.fragment, docsRef.current)
        })()
        return
      }

      // 공유 관리 페이지(F-243.md 3.4) — 뒤로·앞으로 가기·주소창 직접 수정으로 드나들 때
      if (nav.kind === 'shares') {
        ;(async () => {
          await beforeLeaveDoc()
          if (location.hash !== hashAtEntry) return // await 중 주소가 또 바뀌었으면 뒤 핸들러에 맡긴다
          leave() // 도움말을 켜 두면 뒤로 가기의 #/help 가 무시된다 (F-2059 D12)
          setCurrentDocId(null)
          setSharesOpen(true)
        })()
        return
      }

      // 도움말 페이지(F-244.md 3.3) — 뒤로·앞으로 가기·주소창 직접 수정으로 드나들 때
      if (nav.kind === 'help') {
        ;(async () => {
          await beforeLeaveDoc()
          if (location.hash !== hashAtEntry) return // await 중 주소가 또 바뀌었으면 뒤 핸들러에 맡긴다
          leave()
          setCurrentDocId(null)
          setHelpOpen(true)
        })()
        return
      }

      // 위키링크 지도(F-292.md 6.1) — 뒤로·앞으로 가기·주소창 직접 수정으로 드나들 때
      if (nav.kind === 'map') {
        const nextCenterId = nav.centerDocId
        ;(async () => {
          await beforeLeaveDoc()
          if (location.hash !== hashAtEntry) return // await 중 주소가 또 바뀌었으면 뒤 핸들러에 맡긴다
          leave()
          const anchorId = nextCenterId && docsRef.current.some((d) => d.id === nextCenterId) ? nextCenterId : null
          setCurrentDocId(anchorId)
          if (anchorId) setPref('md.lastDocId', anchorId)
          else if (nextCenterId) history.replaceState(null, '', `${location.pathname}${location.search}${formatMapHash(null)}`) // 없는 중심 id 를 주소에 남기지 않는다 (F-2059 D13)
          setMapRoute({ centerDocId: anchorId, returnDocId: anchorId })
        })()
        return
      }

      if (nav.kind === 'thread') {
        const { docId, threadId } = nav
        commentsRef.current?.setPendingTarget({ docId, threadId })
        replaceHashUrl(docId)
        return
      }

      const { docId, threadId } = nav

      ;(async () => {
        await beforeLeaveDoc()
        if (location.hash !== hashAtEntry) return // await 중 주소가 또 바뀌었으면 뒤 핸들러에 맡긴다
        leave() // 공유·공유 관리·도움말·지도를 보고 있었으면 떠난다 — 뒤로 가기로 나갈 때가 그렇다 (F-130.md 4장, F-292.md 6.1)
        // `#/`·빈 해시만 홈 — 인식 못 한 해시는 기존대로 첫 문서 + 알림으로 내려간다 (F-232 3.2, 리뷰 A4)
        if (nav.home) {
          setCurrentDocId(null)
          return
        }
        focusEditorRef.current = true
        const latestDocs = docsRef.current
        if (docId && latestDocs.some((d) => d.id === docId)) {
          setCurrentDocId(docId)
          setPref('md.lastDocId', docId)
          if (threadId) {
            commentsRef.current?.setPendingTarget({ docId, threadId })
            replaceHashUrl(docId)
          }
          const openedDoc = latestDocs.find((d) => d.id === docId)
          addOpenFolders(ancestorsOfDoc({ folders: foldersRef.current, doc: openedDoc }))
        } else {
          const fallbackId = latestDocs[0]?.id ?? null
          setCurrentDocId(fallbackId)
          if (fallbackId) setPref('md.lastDocId', fallbackId)
          replaceHashUrl(fallbackId)
          showNotice({ type: 'info', message: '문서를 찾을 수 없습니다.' })
        }
      })()
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [
    bootPhase, beforeLeaveDoc, showNotice, addOpenFolders, openSharedFragment, setSharedDoc, setSharesOpen, setHelpOpen, setMapRoute,
    setCurrentDocId, docsRef, foldersRef, currentDocIdRef, sharedDocRef, sharesOpenRef, helpOpenRef, mapRouteRef, focusEditorRef, commentsRef,
  ])
}
