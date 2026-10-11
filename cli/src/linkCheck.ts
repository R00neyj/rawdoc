// put 할 본문의 [[위키링크]] 중 내 문서 목록에서 풀리지 않는 대상 — 앱과 같은 추출·해석기를 쓴다
import { extractWikiTargets } from '../../src/lib/wikiGraph'
import { createWikiResolver, type WikiDocRef, type WikiFolderRef } from '../../src/lib/wikiResolve'

// 펜스·인라인 코드·프론트매터·![[…]] 는 빼고, 별칭(|)·제목줄(#) 앞의 대상만. 같은 대상은 한 번
export function wikiTargetsOf(content: string): string[] {
  return [...new Set(extractWikiTargets(content).map((t) => t.trim()).filter((t) => t !== ''))]
}

export function missingWikiTargets(
  targets: string[],
  docs: readonly WikiDocRef[],
  folders: readonly WikiFolderRef[],
  sourceFolderId: string | null,
): string[] {
  const resolver = createWikiResolver(docs, folders)
  return targets.filter((t) => resolver.resolve(t, sourceFolderId) === null)
}
