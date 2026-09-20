// 사이트 글에 쓸 수 없는 문법 검사 — 걸리면 빌드를 실패시킨다 (specs/features/F-272.md 9장). 가드는 원문(raw) 검사다 — 코드블록 안 문법도 걸린다
import { findFrontmatter, parseSimpleProperties } from '../src/lib/frontmatter'
import { contentUrl } from './pages'

const MERMAID_FENCE_RE = /^ {0,3}`{3,}\s*mermaid\b/im
const IMAGE_SYNTAX_RE = /!\[[^\]]*\]\([^)]*\)/
const IMAGE_BLOCK_RE = /<div class="md-image"/
const PLACEHOLDER_RE = /\{\{[\s\S]*?\}\}/

function fail(relPath: string, reason: string): never {
  throw new Error(`content/${relPath}: ${reason}`)
}

// content/**/*.md 파일 하나를 검사한다. 문제가 없으면 title 을 돌려준다
export function checkContentFile(relPath: string, raw: string): { title: string } {
  const frontmatter = findFrontmatter(raw)
  if (!frontmatter) fail(relPath, '프론트매터가 없습니다')

  const content = raw.slice(frontmatter.contentFrom, frontmatter.contentTo)
  const props = parseSimpleProperties(content)
  const titleProp = props?.find((p) => p.key === 'title')
  if (!titleProp || typeof titleProp.value !== 'string' || titleProp.value === '') {
    fail(relPath, 'title 이 없습니다')
  }

  if (contentUrl(relPath) === null) {
    fail(relPath, '어느 주소로 낼지 정해지지 않았습니다')
  }

  if (MERMAID_FENCE_RE.test(raw)) {
    fail(relPath, 'mermaid 코드펜스는 사이트 글에 쓸 수 없습니다')
  }

  if (IMAGE_SYNTAX_RE.test(raw) || IMAGE_BLOCK_RE.test(raw)) {
    fail(relPath, '이미지는 사이트 글에 쓸 수 없습니다')
  }

  if (PLACEHOLDER_RE.test(raw)) {
    fail(relPath, '{{…}} 자리표시가 남아 있습니다')
  }

  return { title: titleProp!.value as string }
}
