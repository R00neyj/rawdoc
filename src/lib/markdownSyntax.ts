// 마크다운 문법 데이터 — 앱 도움말과 명령줄 도구가 같이 읽는다 (F-2118, F-257 2·3장)

import { HIGHLIGHT_LANG_LABELS } from './codeLang'

export type SyntaxItem = {
  name: string
  source: string
  caption?: string
  // 프론트매터·이미지처럼 결과 예시를 넣지 않는 문법만 false (도움말만 읽음)
  showResult?: boolean
}

export type SyntaxGroup = {
  group: string
  items: SyntaxItem[]
  // 이 문법을 다룬 사용법 글 — 도움말만 읽는다 (specs/ia.md 6.1 R3)
  guide?: { title: string; slug: string }
  // 사이트 가드에 걸리는 문법이라 도움말에서 뺀다
  cliOnly?: true
  // 명령줄 도구 출력에만 붙는 그룹 끝 문단
  cliNote?: string
}

const CALLOUTS_MATH_DIAGRAMS_GUIDE = { title: '콜아웃·수식·다이어그램 쓰기', slug: 'callouts-math-diagrams' }

export const SYNTAX_GROUPS: SyntaxGroup[] = [
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
      { name: '하이라이트', source: '==하이라이트==' },
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
    cliNote: '`[[폴더/문서 제목]]`·`[[문서 제목#제목]]`·`[[문서 제목|보일 글자]]`도 됩니다.',
  },
  {
    group: '표',
    items: [{ name: '표', source: '| 머리1 | 머리2 |\n| --- | --- |\n| 값1 | 값2 |' }],
  },
  {
    group: '코드블록',
    items: [
      {
        name: '코드블록',
        source: '```js\ncode\n```',
        caption: `언어 자리에 \`ts\`·\`py\`·\`sh\`처럼 적으면 편집·원문·보기 모드와 인쇄·HTML 파일에서 구문에 색이 입혀집니다. 원문은 바뀌지 않습니다. 색을 입히는 언어: ${HIGHLIGHT_LANG_LABELS.join('·')}.`,
      },
    ],
  },
  {
    group: '이미지',
    items: [
      {
        name: '이미지',
        source: '<div align="center">\n  <img src="attachments/0000000000000000.png" width="320">\n</div>',
        caption:
          '붙여넣기·끌어넣기로 넣은 이미지는 `attachments/` 파일을 가리키는 표준 이미지 문법 한 줄로 들어가고, 설명 뒤에 붙은 `|center`·`|320`이 정렬과 폭입니다. 위 HTML 세 줄 모양도 똑같이 그림으로 보입니다. 인터넷 주소처럼 `attachments/`가 아닌 주소를 적은 이미지 문법은 오프라인에서도 항상 같은 모양이 되도록 이미지 대신 `이미지: 설명` 링크로 바뀝니다.',
        showResult: false,
      },
    ],
    cliNote: '`upload` 명령이 출력한 한 줄을 그대로 붙입니다.',
  },
  {
    group: '콜아웃',
    items: [{ name: '콜아웃', source: '> [!note] 제목\n> 내용' }],
    cliNote: '`]` 뒤에 한 칸 띄우고 제목을 씁니다. 종류는 `note`·`tip`·`warning`·`danger` 등이고, 모르는 이름은 `note` 모양으로 보입니다.',
    guide: CALLOUTS_MATH_DIAGRAMS_GUIDE,
  },
  {
    group: '수식',
    items: [
      {
        name: '수식',
        source: '넓이는 $\\pi r^2$ 입니다.\n\n$$\n\\frac{a+b}{2}\n$$',
        caption:
          '문장 속 수식은 `$` 한 쌍으로, 따로 세우는 수식은 `$$` 줄 두 개 사이에 씁니다. 그린 모습은 `편집`·`보기` 모드에서 봅니다.',
        // 사이트 /help 페이지에는 KaTeX 스타일시트가 없어 결과를 그리면 글자가 겹친다 — 원문만 둔다
        showResult: false,
      },
    ],
    cliNote: '`$` 바로 안쪽에 공백을 두지 않습니다. `$$` 수식은 앞뒤를 빈 줄로 뗍니다.',
    guide: CALLOUTS_MATH_DIAGRAMS_GUIDE,
  },
  {
    group: '다이어그램',
    cliOnly: true,
    items: [
      {
        name: '다이어그램',
        source: '```mermaid\ngraph TD\n  A[초안] --> B[검토]\n```',
        caption: '코드블록 언어 자리에 `mermaid`를 적으면 다이어그램으로 그립니다. 문법은 Mermaid를 따릅니다.',
      },
    ],
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
export function fenceSource(source: string): string {
  const ticks = source.includes('```') ? '````' : '```'
  return `${ticks}
${source}
${ticks}`
}
