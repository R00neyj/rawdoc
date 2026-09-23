// 도움말 원문 — 앱 사용법 + 마크다운 문법 두 축(F-257.md 2·3장). 문법 묶음·원문·설명은 helpSyntax.ts(F-235.md)를 그대로 옮겼다(F-244.md 3.1)
// 이 문서는 공개 사이트 /help 로도 나간다 — 이미지·mermaid 문법을 쓰면 빌드가 실패한다 (F-274)

export const HELP_DOC_TITLE = '도움말'

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
          '붙여넣기·끌어넣기로 넣은 이미지만 이렇게 보입니다. 주소를 직접 적는 표준 이미지 문법은 오프라인에서도 항상 보이도록 이미지 대신 `이미지: 설명` 링크로 바뀝니다.',
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

// 앱 사용법 절 — guideDoc.ts 의 말투(존댓말, 짧은 문장, 화면 그대로의 이름은 인라인코드)를 따른다 (F-257.md 1장)
const APP_SECTIONS = `## 이 앱은

이 앱은 마크다운 원문을 그대로 보존합니다. \`#\`이나 \`**\` 같은 기호를 쳐도 화면에서 사라지지 않고, 커서가 없을 때만 서식으로 바꿔 보여 줍니다. \`.md 내보내기\`로 받은 파일은 입력한 글자와 바이트까지 같습니다.

## 화면

왼쪽 사이드바에서 문서와 폴더를 관리합니다. 자주 쓰는 문서는 위쪽 \`고정됨\` 묶음에 모아 둘 수 있고, \`검색\`으로 모든 문서의 제목과 본문에서 찾습니다. 위쪽 상단바에서 보기 모드를 바꾸고 \`.md 내보내기\`·공유·계정 메뉴를 엽니다. 아래쪽 상태바에는 글자 수·단어 수와 저장 상태가 보입니다. 넓은 창에서는 오른쪽에 지금 문서의 목차가 뜨고, 좁은 창에서는 버튼을 눌러 카드로 봅니다.

## 글쓰기

상단바에서 \`편집\`·\`원문\`·\`보기\` 세 모드를 오갈 수 있습니다.

- \`편집\`(라이브 프리뷰): 커서가 없는 줄은 서식이 적용된 모습으로 보이고, 커서가 닿은 줄만 마크다운 기호가 드러납니다
- \`원문\`: 모든 기호를 고정폭 글꼴로 그대로 보여 줍니다
- \`보기\`: 읽기 전용으로 서식만 봅니다

## 문서 관리

사이드바에서 \`새 문서\`·\`새 폴더\`를 만듭니다. 문서·폴더의 \`⋯\` 메뉴에서 \`이름 변경\`·\`삭제\`·\`폴더로 이동…\`을 고를 수 있고, 자주 쓰는 것은 \`상단 고정\`으로 맨 위에 모아 둡니다. 트리에서 끌어서 다른 폴더로 옮길 수도 있습니다. 행을 오른쪽 버튼으로 눌러도 같은 메뉴가 열립니다. \`Ctrl\`(\`Cmd\`)이나 \`Shift\`를 누른 채로 누르면 여러 항목을 골라 한 번에 삭제하거나 옮길 수 있습니다.

## 저장

입력을 멈추면 자동으로 저장됩니다. 로그인하면 서버와 동기화되고, 오프라인이어도 편집을 계속할 수 있습니다 — 다시 연결되면 밀린 내용이 서버로 올라갑니다.

## 이미지

편집 영역에 붙여넣거나 끌어넣어서 이미지를 넣습니다. 한 장에 20MB까지 넣을 수 있고, 계정마다 이미지 저장 공간은 300MB까지입니다.

## 위키링크

\`[[문서 제목]]\`으로 같은 저장소 안 다른 문서와 연결합니다. 없는 문서 제목을 넣으면 눌렀을 때 그 제목으로 새 문서를 만듭니다.

같은 제목의 문서가 여럿이면 링크를 건 문서와 같은 폴더, 그 위 폴더, 가까운 폴더 순으로 고릅니다. \`[[교안/1주차]]\`처럼 폴더 이름을 앞에 붙이면 그 폴더 안 문서로 이어집니다. \`[[문서 제목#결정]]\`은 그 문서 안 \`결정\` 제목으로, \`[[#결정]]\`은 지금 문서 안 \`결정\` 제목으로 이동합니다.

## 공유

문서는 읽기 전용 링크로 공유할 수 있고, 폴더 전체를 공개할 수도 있습니다. 로그인한 사람을 초대해 읽기·편집 권한을 나눠 줄 수도 있습니다.

## 내보내기·가져오기

\`.md 내보내기\`를 누르면 지금 화면의 원문을 그대로 파일로 받습니다. 이미지가 있는 문서는 zip으로 받습니다. \`가져오기\`로 \`.md\` 파일을 불러오면 그 내용 그대로 새 문서가 됩니다.

## 설치와 오프라인

\`앱 설치\`로 브라우저에서 앱처럼 설치해 두면 첫 방문 뒤에는 오프라인에서도 열립니다. 새 버전이 나오면 알림 띠에 \`새로고침\` 버튼이 뜹니다 — 누르기 전까지는 지금 버전 그대로입니다.

## 단축키

- \`Ctrl+Shift+F\` 여러 문서에서 찾기, \`Ctrl+F\` 이 문서에서 찾기
- \`Ctrl+B\` 굵게, \`Ctrl+I\` 기울임, \`Ctrl+K\` 링크
- \`Esc\` 다음 \`Tab\`: 편집 영역에서 빠져나가기

## 마크다운 문법

자주 쓰는 문법을 표로 먼저 봅니다. 아래 각 문법은 원문과 실제 렌더 결과를 나란히 보여 줍니다.

| 입력 | 결과 |
| --- | --- |
| \`**굵게**\` | **굵게** |
| \`*기울임*\` | *기울임* |
| \`~~취소선~~\` | ~~취소선~~ |
| \`[링크](https://example.com)\` | [링크](https://example.com) |`

export const HELP_DOC_CONTENT = `# ${HELP_DOC_TITLE}\n\n${APP_SECTIONS}\n\n${GROUPS.map(renderGroup).join('\n\n')}\n`
