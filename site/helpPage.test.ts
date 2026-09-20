// 도움말 가상 글 항목 (specs/features/F-274.md 3.2, A1~A3)
import { describe, expect, it } from 'vitest'
import { helpContent } from './helpPage'
import { checkContentFile } from './guard'
import { renderSitePage } from './render'
import { renderMarkdown } from '../src/viewer/renderMarkdown'
import { HELP_DOC_CONTENT } from '../src/app/helpDoc'

describe('F-274 A1 helpContent', () => {
  it('프론트매터로 시작하고 그 뒤가 HELP_DOC_CONTENT 와 정확히 같다', () => {
    const content = helpContent()
    expect(content.startsWith('---\ntitle: 도움말\nsummary: ')).toBe(true)
    const closeIdx = content.indexOf('\n---\n')
    expect(closeIdx).toBeGreaterThan(-1)
    const body = content.slice(closeIdx + '\n---\n'.length)
    expect(body).toBe(HELP_DOC_CONTENT)
  })

  it('닫는 --- 다음 줄이 곧바로 # 도움말 이다 (빈 줄 없음)', () => {
    const content = helpContent()
    expect(content).not.toContain('---\n\n# 도움말')
    expect(content).toContain('---\n# 도움말')
  })
})

describe('F-274 A2 앱과 한 원본', () => {
  it('사이트 페이지 HTML 이 renderMarkdown(HELP_DOC_CONTENT) 를 그대로 포함한다', () => {
    const page = renderSitePage({ url: '/help', raw: helpContent(), appCssHref: '/a.css' })
    expect(page.html).toContain(renderMarkdown(HELP_DOC_CONTENT))
  })

  it('프론트매터 표가 본문에 없다', () => {
    const page = renderSitePage({ url: '/help', raw: helpContent(), appCssHref: '/a.css' })
    expect(page.html).not.toContain('markdown-frontmatter')
  })
})

describe('F-274 A3 빌드 가드 통과', () => {
  it('checkContentFile 이 던지지 않고 title 을 돌려준다', () => {
    expect(checkContentFile('help.md', helpContent())).toEqual({ title: '도움말' })
  })
})
