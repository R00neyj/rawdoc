// 연결 문서의 저장소 그림 대응표 — 처음 필요할 때 받고 메모리에만 둔다 (specs/features/F-2131.md 4장)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GithubImageMap } from '../lib/githubContract'
import type { ImageExt } from '../lib/imageBlock'
import type { ResolveImagePath } from '../lib/imageMarkdown'
import type { Store } from '../types'
import { getDocGithubImages } from './githubApi'
import { githubAttachmentOf, githubImageResolver } from './githubImages'
import { GITHUB_LINK_FRESH_MS } from './githubUi'
import { isSharedDoc, type DocMeta } from './docMeta'

export type GithubImagesHandle = {
  resolveImagePath: ResolveImagePath | null
  attachmentHint: (id: string) => { ext: ImageExt; docId?: string } | null
  setMap: (docId: string, map: GithubImageMap | null) => void
  addImage: (docId: string, path: string, attachment: string) => void
}

// 없음 = unknown. 받는 중은 상태에 넣지 않는다 — 리졸버가 바뀌어 편집기가 괜히 다시 그리지 않게
type Entry = { kind: 'none'; at: number } | { kind: 'ready'; map: GithubImageMap; at: number } | { kind: 'failed'; at: number }
type Entries = { store: Store; byDoc: Record<string, Entry> }

const bumpGen = (gens: Map<string, number>, docId: string) => gens.set(docId, (gens.get(docId) ?? 0) + 1)

const sameMap = (a: GithubImageMap, b: GithubImageMap) =>
  a.path === b.path && Object.keys(a.images).length === Object.keys(b.images).length && Object.entries(a.images).every(([k, v]) => b.images[k] === v)

export function useGithubImages(o: { store: Store; currentDoc: DocMeta | null }): GithubImagesHandle {
  const { store, currentDoc } = o
  const [state, setState] = useState<Entries>({ store, byDoc: {} })
  // 계정이 바뀌면 store 가 새로 만들어진다 — 다른 store 의 기록은 버린다
  const byDoc = state.store === store ? state.byDoc : {}
  const storeRef = useRef(store)
  useEffect(() => {
    storeRef.current = store
  }, [store])
  const loadingRef = useRef(new Set<string>())
  // setMap·addImage 가 끼어들면 그 전에 시작한 받기 결과는 버린다
  const genRef = useRef(new Map<string, number>())

  const write = useCallback((target: Store, docId: string, next: (prev: Entry | undefined) => Entry | undefined) => {
    setState((prev) => {
      const base = prev.store === target ? prev.byDoc : {}
      const entry = next(base[docId])
      if (entry === base[docId]) return prev.store === target ? prev : { store: target, byDoc: base }
      const copy = { ...base }
      if (entry) copy[docId] = entry
      else delete copy[docId]
      return { store: target, byDoc: copy }
    })
  }, [])

  // 리졸버는 CM 갱신·렌더 안에서 불린다 — 요청과 setState 는 그 밖에서 (4.2)
  const schedule = useCallback(
    (docId: string) => {
      if (loadingRef.current.has(docId)) return
      loadingRef.current.add(docId)
      const target = store
      const gen = genRef.current.get(docId) ?? 0
      queueMicrotask(() => {
        void getDocGithubImages(docId).then((r) => {
          loadingRef.current.delete(docId)
          if (storeRef.current !== target || (genRef.current.get(docId) ?? 0) !== gen) return
          const at = Date.now()
          write(target, docId, (prev) => {
            if (r.ok) return prev?.kind === 'ready' && sameMap(prev.map, r.value) ? { ...prev, at } : { kind: 'ready', map: r.value, at }
            return r.status === 404 || r.status === 200 ? { kind: 'none', at } : { kind: 'failed', at }
          })
        })
      })
    },
    [write, store],
  )

  const eligible = store.kind === 'server' && currentDoc !== null && currentDoc.e2ee === undefined
  const docId = eligible ? currentDoc.id : null
  const entry = docId ? byDoc[docId] : undefined
  const map = entry?.kind === 'ready' ? entry.map : null
  const readyAt = entry?.kind === 'ready' ? entry.at : 0
  const failedAt = entry?.kind === 'failed' ? entry.at : null
  const isNone = entry?.kind === 'none'

  const resolveImagePath = useMemo((): ResolveImagePath | null => {
    if (!docId || isNone) return null
    if (map) {
      const base = githubImageResolver(map, { kind: 'doc', docId })
      let checked = false
      // 다시 연 문서의 대응표가 60초 넘었으면 첫 호출에서 한 번 새로 받는다 (4.2)
      return (url) => {
        if (!checked) {
          checked = true
          if (Date.now() - readyAt >= GITHUB_LINK_FRESH_MS) schedule(docId)
        }
        return base(url)
      }
    }
    return () => {
      if (failedAt === null || Date.now() - failedAt >= GITHUB_LINK_FRESH_MS) schedule(docId)
      return null
    }
    // readyAt 은 리졸버를 새로 만들 이유가 아니다 — 같은 대응표면 같은 함수 (4.2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, isNone, map, failedAt, schedule])

  const attachmentHint = useCallback(
    (id: string) => {
      const found = map ? githubAttachmentOf(map, id) : null
      if (!found || !docId) return null
      return isSharedDoc(currentDoc) ? { ext: found.ext, docId } : { ext: found.ext }
    },
    [map, docId, currentDoc],
  )

  const setMap = useCallback(
    (id: string, next: GithubImageMap | null) => {
      bumpGen(genRef.current, id)
      const at = Date.now()
      write(storeRef.current, id, (prev) => {
        if (!next) return { kind: 'none', at }
        return prev?.kind === 'ready' && sameMap(prev.map, next) ? prev : { kind: 'ready', map: next, at }
      })
    },
    [write],
  )

  const addImage = useCallback(
    (id: string, path: string, attachment: string) => {
      bumpGen(genRef.current, id)
      write(storeRef.current, id, (prev) => (prev?.kind === 'ready' ? { ...prev, map: { path: prev.map.path, images: { ...prev.map.images, [path]: attachment } } } : prev))
    },
    [write],
  )

  return { resolveImagePath, attachmentHint, setMap, addImage }
}
