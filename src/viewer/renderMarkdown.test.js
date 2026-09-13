// specs/features/F-123.md 4장 A1·A2
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './renderMarkdown.js'

describe('renderMarkdown — 표·취소선', () => {
  it('GFM 표를 <table> 로 바꾼다', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    expect(html).toContain('<table>')
  })

  it('~~a~~ 를 <s> 로 바꾼다', () => {
    const html = renderMarkdown('~~a~~')
    expect(html).toContain('<s>a</s>')
  })
})

describe('renderMarkdown — 작업 목록', () => {
  it('미체크 항목에 disabled 체크박스와 클래스를 붙인다', () => {
    const html = renderMarkdown('- [ ] 할 일\n')
    expect(html).toContain('<input type="checkbox" disabled>')
    expect(html).not.toContain('checked')
    expect(html).toContain('class="task-list-item"')
    expect(html).toContain('class="contains-task-list"')
    expect(html).toContain('할 일')
  })

  it('체크된 항목(x·X)에 checked 를 붙인다', () => {
    const lower = renderMarkdown('- [x] 완료\n')
    const upper = renderMarkdown('- [X] 완료\n')
    expect(lower).toContain('<input type="checkbox" disabled checked>')
    expect(upper).toContain('<input type="checkbox" disabled checked>')
  })

  it('일반 목록 항목은 그대로 둔다', () => {
    const html = renderMarkdown('- 그냥 항목\n')
    expect(html).not.toContain('task-list-item')
    expect(html).not.toContain('<input')
    expect(html).toContain('그냥 항목')
  })
})

describe('renderMarkdown — 링크', () => {
  it('링크에 target·rel 을 붙인다', () => {
    const html = renderMarkdown('[글](https://example.com)')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('javascript: 링크는 링크가 되지 않는다', () => {
    const html = renderMarkdown('[x](javascript:alert(1))')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href="javascript:')
  })
})

describe('renderMarkdown — 원문 HTML', () => {
  it('<script> 가 이스케이프된다', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('renderMarkdown — 이미지', () => {
  it('이미지 문법을 "이미지: alt" 링크로 바꾸고 <img 를 만들지 않는다', () => {
    const html = renderMarkdown('![그림](./photo.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('이미지: 그림')
    expect(html).toContain('href="./photo.png"')
    expect(html).toContain('target="_blank"')
  })

  it('alt 가 비면 "이미지" 로만 표시한다', () => {
    const html = renderMarkdown('![](./photo.png)')
    expect(html).toContain('>이미지</a>')
  })
})

describe('renderMarkdown — 코드블록', () => {
  it('fence 정보의 첫 단어로 language-{lang} 클래스를 붙인다', () => {
    const html = renderMarkdown('```js\nconst a = 1\n```\n')
    expect(html).toContain('<pre><code class="language-js">')
  })
})

describe('renderMarkdown — 줄바꿈', () => {
  it('문단 안 줄바꿈 1개는 <br> 이 되지 않는다', () => {
    const html = renderMarkdown('한 줄\n다음 줄')
    expect(html).not.toContain('<br>')
  })

  it('CRLF 입력도 LF 입력과 같은 결과를 낸다', () => {
    const lf = renderMarkdown('# 제목\r\n\r\n본문 한 줄\r\n다음 줄\r\n')
    const crlf = renderMarkdown('# 제목\n\n본문 한 줄\n다음 줄\n')
    expect(lf).toBe(crlf)
  })
})

describe('renderMarkdown — 성능 기록 (A2, 통과 기준 없음)', () => {
  it('약 5,000줄(표 50·코드블록 50 섞음) 변환 1회 시간을 기록한다', () => {
    const lines = []
    for (let i = 0; i < 50; i++) {
      lines.push(`## 섹션 ${i}`, '', '본문 문단입니다. '.repeat(5), '')
      lines.push('| a | b | c |', '| --- | --- | --- |', '| 1 | 2 | 3 |', '')
      lines.push('```js', `function f${i}() { return ${i} }`, '```', '')
    }
    // 위에서 표 50·코드블록 50 세트를 만들었으므로 나머지는 일반 문단으로 채워 약 5,000줄을 맞춘다
    while (lines.length < 5000) {
      lines.push(`일반 문단 줄 ${lines.length}`)
    }
    const text = lines.join('\n')

    const start = performance.now()
    const html = renderMarkdown(text)
    const elapsed = performance.now() - start

    console.log(`[F-123 A2] renderMarkdown ${lines.length}줄 변환: ${elapsed.toFixed(2)}ms`)

    expect(html.length).toBeGreaterThan(0)
  })
})
