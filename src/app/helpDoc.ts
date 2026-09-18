// 도움말 원문 — 묶음·문법·원문·설명은 예전 helpSyntax.ts(F-235.md)를 그대로 옮겼다 (specs/features/F-244.md 3.1)

export const HELP_DOC_TITLE = '마크다운 문법'

type HelpItem = {
  name: string
  source: string
  caption?: string
  // 프론트매터·이미지처럼 결과 예시를 넣지 않는 문법만 false (3.1)
  showResult?: boolean
}

type HelpGroup = { group: string; items: HelpItem[] }

const GROUPS: HelpGroup[] = [
  {
    group: '제목',
    items: [{ name: '제목', source: '# 제목 1\n## 제목 2\n### 제목 3' }],
  },
  {
    group: '강조',
    items: [
      { name: '굵게', source: '**굵게**' },
      { name: '기울임', source: '*기울임*' },
      { name: '취소선', source: '~~취소선~~' },
      { name: '인라인코드', source: '`코드`' },
    ],
  },
  {
    group: '목록',
    items: [
      { name: '글머리 목록', source: '- 항목' },
      { name: '번호 목록', source: '1. 항목' },
      { name: '체크박스', source: '- [ ] 할 일\n- [x] 끝낸 일' },
    ],
  },
  {
    group: '인용',
    items: [{ name: '인용', source: '> 인용문' }],
  },
  {
    group: '링크',
    items: [{ name: '링크', source: '[링크](https://example.com)' }],
  },
  {
    group: '위키링크',
    items: [
      {
        name: '위키링크',
        source: '[[문서 제목]]',
        caption: '실제로 있는 문서 제목을 쓰면 클릭해서 그 문서가 열립니다.',
      },
    ],
  },
  {
    group: '표',
    items: [{ name: '표', source: '| 머리1 | 머리2 |\n| --- | --- |\n| 값1 | 값2 |' }],
  },
  {
    group: '코드블록',
    items: [{ name: '코드블록', source: '```js\ncode\n```' }],
  },
  {
    group: '이미지',
    items: [
      {
        name: '이미지',
        source: '<div align="center">\n  <img src="attachments/0000000000000000.png" width="320">\n</div>',
        caption:
          '붙여넣기·끌어넣기로 넣은 이미지만 이렇게 보입니다. 표준 문법 ![설명](주소)으로 직접 쓴 외부 이미지는 오프라인에서도 항상 보이도록 이미지 대신 "이미지: 설명" 링크로 바뀝니다.',
        showResult: false,
      },
    ],
  },
  {
    group: '콜아웃',
    items: [{ name: '콜아웃', source: '> [!note] 제목\n> 내용' }],
  },
  {
    group: '구분선',
    items: [{ name: '구분선', source: '---' }],
  },
  {
    group: '프론트매터',
    items: [
      {
        name: '프론트매터',
        source: '---\ntitle: 문서 제목\n---',
        caption: '문서 맨 위에 있을 때만 프론트매터로 인식됩니다. 문서 중간에 있으면 원문 그대로 보입니다.',
        showResult: false,
      },
    ],
  },
]

// 원문이 코드펜스(```)를 포함하면(코드블록 문법) 한 단계 긴 펜스로 감싼다
function fence(source: string): string {
  const ticks = source.includes('```') ? '````' : '```'
  return `${ticks}\n${source}\n${ticks}`
}

function renderItem(item: HelpItem, withSubheading: boolean): string {
  const parts: string[] = []
  if (withSubheading) parts.push(`### ${item.name}`)
  parts.push(fence(item.source))
  if (item.showResult !== false) parts.push(item.source)
  if (item.caption) parts.push(item.caption)
  return parts.join('\n\n')
}

function renderGroup(group: HelpGroup): string {
  const withSubheading = group.items.length > 1
  const body = group.items.map((item) => renderItem(item, withSubheading)).join('\n\n')
  return `## ${group.group}\n\n${body}`
}

export const HELP_DOC_CONTENT = `# ${HELP_DOC_TITLE}\n\n${GROUPS.map(renderGroup).join('\n\n')}\n`
