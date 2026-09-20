// content 상대경로 ↔ 사이트 주소 매핑 (specs/features/F-272.md 6.2) — 순수 문자열, 파일 입출력 없음

const SLUG_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

// content/ 상대경로 → 사이트 주소. 매핑이 없으면 null(빌드 실패 대상, site/guard.ts G2)
export function contentUrl(relPath: string): string | null {
  if (relPath === 'changelog.md') return '/changelog'
  if (relPath === 'legal/privacy.md') return '/privacy'
  if (relPath === 'legal/terms.md') return '/terms'
  // 도움말만 content/ 에 파일이 없다 — site/build.ts 가 src/app/helpDoc.ts 로 만들어 넣는다 (F-274.md 3장)
  if (relPath === 'help.md') return '/help'

  const guideMatch = /^guides\/([^/]+)\.md$/.exec(relPath)
  if (guideMatch && SLUG_RE.test(guideMatch[1])) return `/guides/${guideMatch[1]}`

  return null
}

// 사이트 주소 → dist 파일 경로(평평한 {경로}.html, F-272.md 2장 41행)
export function urlToFile(url: string): string {
  const trimmed = url.replace(/^\/+/, '')
  return `${trimmed}.html`
}
