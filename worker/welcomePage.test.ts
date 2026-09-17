// 마케팅 랜딩 페이지 /welcome 정적 HTML 렌더링 (F-239.md 4장)
import { describe, expect, it } from 'vitest'
import { renderWelcomePage } from './welcomePage'
import brand from '../brand.config'

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

describe('F-239 renderWelcomePage', () => {
  it('A1: 200, text/html; charset=utf-8', async () => {
    const res = renderWelcomePage()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
  })

  it('A2: 헤드라인 두 줄, 서브헤드, CTA, 예시 문서의 #·* 문자가 원문 그대로 포함', async () => {
    const html = await renderWelcomePage().text()
    expect(html).toContain('원문 그대로 쓰는')
    expect(html).toContain('한국어 마크다운 협업 도구')
    expect(html).toContain('href="/"')
    const text = stripTags(html)
    expect(text).toContain('## 회의록')
    expect(text).toContain('다음 회의는 **금요일 오후 2시**입니다')
  })

  it('A3: og/twitter 메타가 brand.config 값을 반영', async () => {
    const html = await renderWelcomePage().text()
    expect(html).toContain(`content="${brand.accent}"`)
    expect(html).toMatch(/property="og:title" content="[^"]*Rawdoc[^"]*"/)
    expect(html).toMatch(/<meta property="og:description" content="[^"]+" \/>/)
    expect(html).toContain(`property="og:image" content="https://rawdoc.app${brand.ogImage}"`)
    expect(html).toMatch(/property="og:url" content="[^"]*\/welcome"/)
    expect(html).toContain('name="theme-color" content="' + brand.accent + '"')
  })

  it('A4: X-Robots-Tag 헤더 없음', async () => {
    const res = renderWelcomePage()
    expect(res.headers.get('X-Robots-Tag')).toBeNull()
  })
})
