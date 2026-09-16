// 도움말 대화상자에 실을 마크다운 문법 목록 — 그룹·순서는 F-235.md 0장 표 그대로
// wide: 여러 줄·표·이미지 등 좁은 칸에 답답한 결과 — 카드 목록에서 한 줄 전체를 차지한다
export type HelpItem = { name: string; source: string; caption?: string; wide?: boolean }
export type HelpGroup = { group: string; items: HelpItem[] }

export const HELP_GROUPS: HelpGroup[] = [
  {
    group: '제목',
    items: [{ name: '제목', source: '# 제목 1\n## 제목 2\n### 제목 3', wide: true }],
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
    items: [{ name: '표', source: '| 머리1 | 머리2 |\n| --- | --- |\n| 값1 | 값2 |', wide: true }],
  },
  {
    group: '코드블록',
    items: [{ name: '코드블록', source: '```js\ncode\n```', wide: true }],
  },
  {
    group: '이미지',
    items: [
      {
        name: '이미지 (예시)',
        source: '<div align="center">\n  <img src="attachments/0000000000000000.png" width="320">\n</div>',
        wide: true,
        caption: '붙여넣기·끌어넣기로 넣은 이미지만 이렇게 보입니다. 표준 문법 ![설명](주소)으로 직접 쓴 외부 이미지는 오프라인에서도 항상 보이도록 이미지 대신 "이미지: 설명" 링크로 바뀝니다.',
      },
    ],
  },
  {
    group: '콜아웃',
    items: [{ name: '콜아웃', source: '> [!note] 제목\n> 내용', wide: true }],
  },
  {
    group: '구분선',
    items: [{ name: '구분선', source: '---' }],
  },
  {
    group: '프론트매터',
    items: [{ name: '프론트매터', source: '---\ntitle: 문서 제목\n---', wide: true }],
  },
]
