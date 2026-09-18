// specs/features/F-123.md 4장 A1·A2
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './renderMarkdown'

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

describe('renderMarkdown — 이미지 블록 (specs/features/F-158.md 6장 A1)', () => {
  it('로컬 첨부 이미지 블록을 div.md-image + img[data-attachment] 로 바꾼다(src 없음)', () => {
    const html = renderMarkdown(
      '본문\n\n<div align="center">\n  <img src="attachments/0f3a9c2e7b1d4a58.png" alt="다이어그램" width="480">\n</div>\n\n끝\n',
    )
    expect(html).toContain('<div class="md-image md-image--center" style="width:480px"><img data-attachment="0f3a9c2e7b1d4a58" alt="다이어그램" width="480"></div>')
    expect(html).not.toContain('src=')
    expect(html).not.toContain('<img src')
  })

  it('width 가 없으면 style·width 속성을 출력하지 않는다', () => {
    const html = renderMarkdown('<div align="left">\n  <img src="attachments/0f3a9c2e7b1d4a58.png" alt="a">\n</div>\n')
    expect(html).toContain('<div class="md-image md-image--left"><img data-attachment="0f3a9c2e7b1d4a58" alt="a"></div>')
  })

  it('alt 의 "·< 가 든 경우 다시 이스케이프한다', () => {
    const html = renderMarkdown(
      '<div align="center">\n  <img src="attachments/0f3a9c2e7b1d4a58.png" alt="&lt;b&gt;&quot;x&quot;">\n</div>\n',
    )
    expect(html).toContain('alt="&lt;b&gt;&quot;x&quot;"')
  })

  it('외부 src 는 이스케이프된 글자 그대로 (md-image 아님)', () => {
    const html = renderMarkdown('<div align="center">\n  <img src="https://a.com/x.png" alt="a">\n</div>\n')
    expect(html).not.toContain('md-image')
    expect(html).toContain('&lt;div align=&quot;center&quot;&gt;')
  })

  it('형식이 틀리면(허용 안 되는 속성) 이스케이프된 글자 그대로', () => {
    const html = renderMarkdown(
      '<div align="center">\n  <img src="attachments/0f3a9c2e7b1d4a58.png" alt="a" data-x="y">\n</div>\n',
    )
    expect(html).not.toContain('md-image')
    expect(html).toContain('&lt;img')
  })

  it('인용 안(목록·인용 밖 아님)은 이미지 블록으로 바꾸지 않는다', () => {
    const html = renderMarkdown(
      '> <div align="center">\n>   <img src="attachments/0f3a9c2e7b1d4a58.png" alt="a">\n> </div>\n',
    )
    expect(html).not.toContain('md-image')
    expect(html).toContain('<blockquote>')
  })

  it('![a](b) 문법은 기존대로 "이미지: alt" 링크', () => {
    const html = renderMarkdown('![그림](./photo.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('이미지: 그림')
  })
})

describe('renderMarkdown — 코드블록', () => {
  it('fence 정보의 첫 단어로 language-{lang} 클래스를 붙인다', () => {
    const html = renderMarkdown('```js\nconst a = 1\n```\n')
    expect(html).toContain('<pre><code class="language-js">')
  })
})

describe('renderMarkdown — mermaid (specs/features/F-258.md 2.4)', () => {
  it('mermaid fence 는 data-mermaid-source 를 든 placeholder div 로 바꾼다(기본 fence 아님)', () => {
    const html = renderMarkdown('```mermaid\ngraph TD; A-->B\n```\n')
    expect(html).toContain('<div class="md-mermaid" data-mermaid-source="graph TD; A--&gt;B\n"></div>')
    expect(html).not.toContain('<pre>')
  })

  it('본문은 이스케이프해서 넣는다', () => {
    const html = renderMarkdown('```mermaid\n<script>\n```\n')
    expect(html).toContain('data-mermaid-source="&lt;script&gt;\n"')
  })

  it('다른 언어 fence 는 그대로 기본 렌더러를 쓴다(회귀)', () => {
    const html = renderMarkdown('```js\nconst a = 1\n```\n')
    expect(html).toContain('<pre><code class="language-js">')
    expect(html).not.toContain('md-mermaid')
  })
})

describe('renderMarkdown — 제목 원문 줄 번호 (specs/features/F-144.md 4장 A1)', () => {
  it('h1~h3 에 data-source-line 을 붙인다', () => {
    const html = renderMarkdown('본문\n\n## 제목\n')
    expect(html).toContain('<h2 data-source-line="3">제목</h2>')
  })

  it('h4 이하에는 붙이지 않는다', () => {
    const html = renderMarkdown('#### 제목\n')
    expect(html).not.toContain('data-source-line')
  })

  it('프론트매터가 차지한 줄 수만큼 더한다', () => {
    const html = renderMarkdown('---\na: 1\n---\n\n# 제목\n')
    expect(html).toContain('<h1 data-source-line="5">제목</h1>')
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

describe('renderMarkdown — 콜아웃 (specs/features/F-128.md 5장 A3)', () => {
  it('콜아웃을 div.markdown-callout + 제목 p + 본문으로 바꾼다', () => {
    const html = renderMarkdown('> [!tip] 제목\n> 본문')
    expect(html).toContain('class="markdown-callout md-callout--tip"')
    expect(html).toContain('data-callout="tip"')
    expect(html).toMatch(/<p class="markdown-callout-title"><span class="markdown-callout-icon" aria-hidden="true"><svg[\s\S]*?<\/svg><\/span>제목<\/p>/)
    expect(html).toContain('<p>본문</p>')
    expect(html).not.toContain('<blockquote>')
    expect(html).not.toContain('[!tip]')
  })

  it('제목 없는 [!note] 는 기본 제목 Note', () => {
    const html = renderMarkdown('> [!note]\n> 본문')
    expect(html).toContain('markdown-callout-icon')
    expect(html).toContain('>Note</p>')
  })

  it('본문이 없어도 된다', () => {
    const html = renderMarkdown('> [!note] 제목만')
    expect(html).toContain('>제목만</p>')
    expect(html).toContain('</div>')
  })

  it('공백 없는 >[!tip] 도 콜아웃이 된다', () => {
    const html = renderMarkdown('>[!tip] 제목')
    expect(html).toContain('md-callout--tip')
  })

  it('제목의 인라인 마크다운을 렌더한다 (<b> 는 이스케이프)', () => {
    const html = renderMarkdown('> [!x] <b>강조</b>')
    // 지원하지 않는 종류는 note 묶음, html:false 라 <b> 는 이스케이프된다
    expect(html).toContain('md-callout--note')
    expect(html).toContain('&lt;b&gt;강조&lt;/b&gt;')
  })

  it('제목에 굵게 등 실제 마크다운 문법은 인라인 렌더된다', () => {
    const html = renderMarkdown('> [!tip] **굵게** 제목')
    expect(html).toContain('<strong>굵게</strong> 제목')
  })

  it('중첩 콜아웃도 안쪽까지 변환한다', () => {
    const html = renderMarkdown('> [!note] 바깥\n> > [!tip] 안쪽')
    expect(html).toContain('md-callout--note')
    expect(html).toContain('md-callout--tip')
    expect(html).toContain('>바깥</p>')
    expect(html).toContain('>안쪽</p>')
    expect(html).not.toContain('<blockquote>')
  })

  it('보통 인용은 blockquote 그대로', () => {
    const html = renderMarkdown('> 그냥 인용\n> 계속')
    expect(html).toContain('<blockquote>')
    expect(html).not.toContain('markdown-callout')
  })

  it('GitHub 별칭 [!IMPORTANT]는 tip, [!CAUTION]은 warning 묶음이 된다', () => {
    expect(renderMarkdown('> [!IMPORTANT] x')).toContain('md-callout--tip')
    expect(renderMarkdown('> [!CAUTION] x')).toContain('md-callout--warning')
  })
})

describe('renderMarkdown — 콜아웃 아이콘 (specs/features/F-148.md 4장 A1)', () => {
  function titleIconSvg(html: string) {
    const m = /<p class="markdown-callout-title"><span class="markdown-callout-icon" aria-hidden="true">([\s\S]*?)<\/span>/.exec(html)
    return m ? m[1] : null
  }

  it('제목 p 의 첫 자식은 아이콘 span', () => {
    const html = renderMarkdown('> [!tip] 제목')
    expect(titleIconSvg(html)).toContain('<svg')
  })

  it('종류마다 다른 아이콘 svg', () => {
    const noteIcon = titleIconSvg(renderMarkdown('> [!note] x'))
    const tipIcon = titleIconSvg(renderMarkdown('> [!tip] x'))
    expect(noteIcon).not.toBe(tipIcon)
  })

  it('모르는 종류는 note 와 같은 아이콘', () => {
    const noteIcon = titleIconSvg(renderMarkdown('> [!note] x'))
    const unknownIcon = titleIconSvg(renderMarkdown('> [!zzz] x'))
    expect(unknownIcon).toBe(noteIcon)
  })

  it('[!x] <b> 제목 이스케이프는 아이콘과 무관하게 유지된다', () => {
    const html = renderMarkdown('> [!x] <b>강조</b>')
    expect(html).toContain('markdown-callout-icon')
    expect(html).toContain('&lt;b&gt;강조&lt;/b&gt;')
  })
})

describe('renderMarkdown — 프론트매터 (specs/features/F-133.md 4장 A6)', () => {
  it('속성을 표로 만들고 본문 첫 요소는 hr 이 아니다', () => {
    const html = renderMarkdown('---\ntitle: 문서\ntags:\n  - a\n  - b\n---\n# 제목')
    expect(html).toContain('<table class="markdown-frontmatter">')
    expect(html).toContain('<th>title</th><td>문서</td>')
    expect(html).toContain('<th>tags</th><td>a, b</td>')
    expect(html.indexOf('<table')).toBeLessThan(html.indexOf('<h1'))
    expect(html).not.toContain('<hr>')
  })

  it('구조를 알아볼 수 없으면 원문 그대로 pre 로 보여준다', () => {
    const html = renderMarkdown('---\nparent:\n  child: 1\n---\n본문')
    expect(html).toContain('<pre class="markdown-frontmatter-raw"><code>')
    expect(html).toContain('parent:')
  })

  it('값의 < 를 이스케이프한다', () => {
    const html = renderMarkdown('---\ntitle: <b>x</b>\n---\n본문')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('<b>x</b>')
  })

  it('빈 프론트매터는 아무것도 출력하지 않는다', () => {
    const html = renderMarkdown('---\n---\n본문')
    expect(html).not.toContain('markdown-frontmatter')
    expect(html).toContain('본문')
  })

  it('프론트매터가 없는 문서는 제목 줄 번호만 더해진다 (F-144.md 3.4)', () => {
    expect(renderMarkdown('# 제목')).toBe('<h1 data-source-line="1">제목</h1>\n')
  })
})

describe('renderMarkdown — 위키링크 (specs/features/F-131.md 7장 A3, F-252.md 4.1 C1)', () => {
  it('resolveWikiLink 가 href 문자열을 돌려주면 그대로 href 로 쓴다 (새 탭 속성 없음)', () => {
    const html = renderMarkdown('[[회의록]]', { resolveWikiLink: (t) => (t === '회의록' ? '#/d/abc' : null) })
    expect(html).toContain('<a ')
    expect(html).toContain('class="wikilink"')
    expect(html).toContain('href="#/d/abc"')
    expect(html).toContain('data-wikilink="회의록"')
    expect(html).toContain('>회의록</a>')
    expect(html).not.toContain('target="_blank"')
  })

  it('href 형식을 정하지 않는다 — 어떤 문자열이든 그대로 href 가 된다 (F-252.md 4.1)', () => {
    const html = renderMarkdown('[[회의록]]', { resolveWikiLink: () => '#/p/tok1/doc1' })
    expect(html).toContain('href="#/p/tok1/doc1"')
  })

  it('resolveWikiLink 가 null 이면 wikilink--missing', () => {
    const html = renderMarkdown('[[없는 문서]]', { resolveWikiLink: () => null })
    expect(html).toContain('class="wikilink wikilink--missing"')
    expect(html).toContain('href="#"')
    expect(html).toContain('data-wikilink="없는 문서"')
    expect(html).toContain('>없는 문서</a>')
  })

  it('별칭은 보이는 글자만 바뀐다', () => {
    const html = renderMarkdown('[[회의록|9월 회의]]', { resolveWikiLink: () => '#/d/abc' })
    expect(html).toContain('data-wikilink="회의록"')
    expect(html).toContain('>9월 회의</a>')
  })

  it('옵션이 없으면 클릭 불가능한 span 이 된다 (F-130 공유 화면)', () => {
    const html = renderMarkdown('[[회의록]]')
    expect(html).toContain('<span class="wikilink wikilink--plain">회의록</span>')
    expect(html).not.toContain('<a')
  })

  it('대상·별칭의 < 를 이스케이프한다', () => {
    const html = renderMarkdown('[[<script>|<b>]]', { resolveWikiLink: () => null })
    expect(html).toContain('data-wikilink="&lt;script&gt;"')
    expect(html).toContain('>&lt;b&gt;</a>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>')
  })

  it('표 칸 안은 위키링크로 바꾸지 않는다', () => {
    const html = renderMarkdown('| a | [[b]] |\n| --- | --- |\n| x | y |\n', {
      resolveWikiLink: () => 'id',
    })
    expect(html).not.toContain('wikilink')
    expect(html).toContain('[[b]]')
  })

  it('인라인코드·펜스 코드블록 안은 위키링크로 바꾸지 않는다', () => {
    const html = renderMarkdown('`[[a]]`\n\n```\n[[b]]\n```\n', { resolveWikiLink: () => 'id' })
    expect(html).not.toContain('wikilink')
    expect(html).toContain('[[a]]')
    expect(html).toContain('[[b]]')
  })

  it('이미지식 ![[a]] 는 위키링크로 바꾸지 않는다', () => {
    const html = renderMarkdown('![[a]]', { resolveWikiLink: () => 'id' })
    expect(html).not.toContain('wikilink')
  })
})

describe('renderMarkdown — 표 칸 안 <br> (specs/features/F-162.md 4장 A1)', () => {
  it('표 칸의 <br>·<br/>·<br /> 를 <br> 요소로 바꾼다', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| x<br>y | p<br/>q<br />r |\n')
    expect(html).toContain('x<br>y')
    expect(html).toContain('p<br>q<br>r')
  })

  it('대소문자를 가리지 않는다', () => {
    const html = renderMarkdown('| a |\n| --- |\n| x<BR />y |\n')
    expect(html).toContain('x<br>y')
  })

  it('표 밖 문단의 <br> 은 이스케이프된다', () => {
    const html = renderMarkdown('x<br>y\n')
    expect(html).toContain('x&lt;br&gt;y')
    expect(html).not.toContain('<br>')
  })

  it('표 칸 안의 다른 태그(<b>)는 이스케이프된 채로 둔다', () => {
    const html = renderMarkdown('| a |\n| --- |\n| x<b>y</b>z |\n')
    expect(html).toContain('x&lt;b&gt;y&lt;/b&gt;z')
    expect(html).not.toContain('<b>')
  })

  it('표 칸 안 인라인코드 속 <br> 은 이스케이프된 채로 둔다', () => {
    const html = renderMarkdown('| a |\n| --- |\n| `x<br>y` |\n')
    expect(html).toContain('x&lt;br&gt;y')
    expect(html).not.toContain('<br>')
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
