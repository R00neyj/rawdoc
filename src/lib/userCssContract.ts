// 사용자 CSS 공식 계약 — 공개 변수·뼈대 훅·본문 훅·상태 속성과 템플릿 생성 (specs/features/F-2093.md)
import { GUIDES_PATH } from './siteChrome'

export type PublicVarGroup = '기본 색' | '파생 색' | '본문' | '콜아웃' | '지도 그룹' | '댓글 앵커' | '서체' | '모양'
export type PublicVar = { name: `--${string}`; group: PublicVarGroup; label: string }
export type ChromeHook = { value: string; label: string; files: readonly string[] }
export type ContentHook = { id: string; label: string; edit: readonly string[]; view: readonly string[] }
export type StateAttr = { name: `data-${string}`; on: 'html' | 'content'; values: readonly string[]; label: string }

// 비공개 신호라 STATE_ATTRS 에 넣지 않는다 (F-2098)
export const USER_CSS_REV_ATTR = 'data-user-css-rev'

export const USER_CSS_GUIDE_PATH = `${GUIDES_PATH}/custom-css`

const v = (name: `--${string}`, group: PublicVarGroup, label: string): PublicVar => ({ name, group, label })

export const PUBLIC_VARS: readonly PublicVar[] = [
  v('--paper', '기본 색', '앱 바탕'),
  v('--panel', '기본 색', '대화상자·메뉴·카드 바탕'),
  v('--ink', '기본 색', '글자'),
  v('--ink-2', '기본 색', '보조 글자'),
  v('--muted', '기본 색', '흐린 글자·아이콘'),
  v('--rule', '기본 색', '구분선·테두리'),
  v('--rule-2', '기본 색', '옅은 구분선·옅은 바탕'),
  v('--link', '기본 색', '링크'),
  v('--danger', '기본 색', '오류·삭제'),
  v('--accent', '기본 색', '강조 — 선택·포커스·주요 버튼'),
  v('--accent-soft', '파생 색', '강조 옅은 바탕 — 고른 줄·끌어 놓을 자리'),
  v('--accent-ring', '파생 색', '강조 테두리'),
  v('--selection-bg', '파생 색', '글자 선택 바탕'),
  v('--md-font-size', '본문', '본문 글자 크기 — 덮으면 설정 글자 크기가 안 먹습니다'),
  v('--md-line-height', '본문', '본문 줄 간격'),
  v('--md-fg-muted', '본문', '인용·제목 6 글자'),
  v('--md-border', '본문', '인용 막대·표 테두리'),
  v('--md-border-muted', '본문', '제목 1·2 밑줄·표 가로줄'),
  v('--md-bg-muted', '본문', '코드블록 바탕'),
  v('--md-code-bg', '본문', '인라인 코드 바탕'),
  v('--md-link', '본문', '본문 링크'),
  v('--highlight-base', '본문', '하이라이트 기준색 — 바탕은 이 색을 60% 섞어 만듭니다'),
  v('--md-highlight-bg', '본문', '하이라이트 바탕'),
  v('--callout-note', '콜아웃', '콜아웃 note (info·todo)'),
  v('--callout-tip', '콜아웃', '콜아웃 tip (abstract·summary·tldr·hint·important)'),
  v('--callout-success', '콜아웃', '콜아웃 success (check·done)'),
  v('--callout-question', '콜아웃', '콜아웃 question (help·faq)'),
  v('--callout-warning', '콜아웃', '콜아웃 warning (caution·attention)'),
  v('--callout-danger', '콜아웃', '콜아웃 danger (failure·fail·missing·error·bug)'),
  v('--callout-example', '콜아웃', '콜아웃 example'),
  v('--callout-quote', '콜아웃', '콜아웃 quote (cite)'),
  v('--map-group-1', '지도 그룹', '지도 그룹 1'),
  v('--map-group-2', '지도 그룹', '지도 그룹 2'),
  v('--map-group-3', '지도 그룹', '지도 그룹 3'),
  v('--map-group-4', '지도 그룹', '지도 그룹 4'),
  v('--map-group-5', '지도 그룹', '지도 그룹 5'),
  v('--map-group-6', '지도 그룹', '지도 그룹 6'),
  v('--map-group-7', '지도 그룹', '지도 그룹 7'),
  v('--map-group-8', '지도 그룹', '지도 그룹 8'),
  v('--comment-anchor', '댓글 앵커', '댓글 단 글자 바탕'),
  v('--comment-anchor-active', '댓글 앵커', '고른 댓글의 글자 바탕'),
  v('--comment-anchor-line', '댓글 앵커', '댓글 단 글자 밑줄'),
  v('--font-sans', '서체', '산세리프 서체'),
  v('--font-serif', '서체', '세리프 서체'),
  v('--font-mono', '서체', '고정폭 서체'),
  v('--font-display', '서체', '제목 서체 — 덮으면 설정 제목 서체가 안 먹습니다'),
  v('--font-body', '서체', '본문 서체 — 덮으면 설정 본문 서체가 안 먹습니다'),
  v('--tracking', '서체', '자간'),
  v('--radius-control', '모양', '버튼·입력칸 모서리'),
  v('--radius-dialog', '모양', '대화상자 모서리'),
  v('--radius-image', '모양', '이미지 모서리'),
]

const MENU_FILES = [
  'src/app/ContextMenu.tsx',
  'src/app/AccountMenu.tsx',
  'src/app/EditorToolbar.tsx',
  'src/app/ExportMenu.tsx',
  'src/app/FolderMenu.tsx',
  'src/app/HelpMenu.tsx',
  'src/app/ShareMenu.tsx',
  'src/app/ToolbarCategoryMenu.tsx',
  'src/app/ViewModeMenu.tsx',
]

export const CHROME_HOOKS: readonly ChromeHook[] = [
  { value: 'app', label: '앱 화면 전체', files: ['src/app/App.tsx'] },
  { value: 'sidebar', label: '사이드바 — 접힌 레일·좁은 화면 겹침 포함', files: ['src/app/Sidebar.tsx'] },
  { value: 'sidebar-list', label: '사이드바 문서·폴더 목록 — 접힌 레일에서는 없습니다', files: ['src/app/Sidebar.tsx'] },
  { value: 'topbar', label: '위 막대', files: ['src/app/TopBar.tsx'] },
  { value: 'statusbar', label: '아래 상태 막대', files: ['src/app/StatusBar.tsx'] },
  { value: 'content', label: '문서 영역 — data-view-mode 가 live·raw·view', files: ['src/app/DocumentArea.tsx'] },
  {
    value: 'doc-title',
    label: '문서 제목 — 편집·보기·인쇄',
    files: ['src/editor/docTitle.ts', 'src/viewer/Viewer.tsx', 'src/app/printDoc.ts'],
  },
  { value: 'editor', label: '편집기 — 편집·원문 모드', files: ['src/editor/Editor.tsx'] },
  { value: 'viewer', label: '보기 모드 본문 틀', files: ['src/viewer/Viewer.tsx'] },
  { value: 'print', label: '인쇄 영역', files: ['src/app/App.tsx'] },
  { value: 'outline', label: '목차', files: ['src/app/Outline.tsx', 'src/app/OutlinePanel.tsx'] },
  { value: 'comments', label: '댓글 — 옆 레일·휴대폰 판', files: ['src/app/CommentRailPanel.tsx'] },
  { value: 'dialog', label: '대화상자 — 설정·팔레트·검색 포함', files: ['src/app/Dialog.tsx'] },
  { value: 'menu', label: '메뉴 — 우클릭·드롭다운', files: MENU_FILES },
  { value: 'notice', label: '알림 띠', files: ['src/app/NoticeBar.tsx'] },
  { value: 'home', label: '홈 화면', files: ['src/app/EmptyState.tsx'] },
  { value: 'map', label: '지도 화면 — 캔버스 안은 CSS 가 닿지 않습니다', files: ['src/app/MapPage.tsx'] },
]

const EDIT = ':root:root .cm-editor .cm-line'
const VIEW = ':root:root .markdown-body'

export const CONTENT_HOOKS: readonly ContentHook[] = [
  {
    id: 'heading',
    label: '제목 1~6',
    edit: [1, 2, 3, 4, 5, 6].map((n) => `${EDIT}.md-h${n}`),
    view: [1, 2, 3, 4, 5, 6].map((n) => `${VIEW} h${n}`),
  },
  { id: 'quote', label: '인용', edit: [`${EDIT}.md-quote`], view: [`${VIEW} blockquote`] },
  {
    id: 'callout',
    label: '콜아웃 — 종류별은 두 모드 모두 .md-callout--{종류}',
    edit: [`${EDIT}.md-callout`],
    view: [`${VIEW} .markdown-callout`],
  },
  {
    id: 'codeblock',
    label: '코드블록 — 편집 모드는 줄(커서가 들어갔을 때·원문 모드)과 접힌 블록 두 모양',
    edit: [`${EDIT}.md-fence-line`, ':root:root .md-block.md-codeblock'],
    view: [`${VIEW} pre`],
  },
  {
    id: 'inline-code',
    label: '인라인 코드',
    edit: [`${EDIT}:not(.md-fence-line) .md-code`],
    view: [`${VIEW} :not(pre) > code`],
  },
  { id: 'table', label: '표', edit: [':root:root .md-block.md-table table'], view: [`${VIEW} table`] },
  { id: 'link', label: '링크', edit: [`${EDIT} .md-link`], view: [`${VIEW} a`] },
  {
    id: 'highlight',
    label: '하이라이트 (==…==)',
    edit: [':root:root .cm-editor .md-highlight'],
    view: [`${VIEW} mark`],
  },
  { id: 'list', label: '목록 항목', edit: [`${EDIT}.md-list-line`], view: [`${VIEW} li`] },
  {
    id: 'hr',
    label: '구분선 — 편집 모드의 선은 ::before 가 그립니다',
    edit: [`${EDIT}.md-hr`],
    view: [`${VIEW} hr`],
  },
  { id: 'body', label: '본문 전체', edit: [':root:root .cm-editor .cm-content'], view: [VIEW] },
]

export const STATE_ATTRS: readonly StateAttr[] = [
  {
    name: 'data-theme',
    on: 'html',
    values: ['white', 'sepia', 'dark'],
    label: '테마 — 시스템 설정이어도 white·dark 중 하나. 인쇄하는 동안과 HTML 내보내기에는 없습니다',
  },
  { name: 'data-heading-font', on: 'html', values: ['serif', 'sans'], label: '설정 제목 서체' },
  { name: 'data-body-font', on: 'html', values: ['sans', 'serif'], label: '설정 본문 서체' },
  { name: 'data-font-size', on: 'html', values: ['small', 'medium', 'large'], label: '설정 글자 크기' },
  { name: 'data-indent', on: 'html', values: ['2', '4'], label: '설정 들여쓰기' },
  { name: 'data-printing', on: 'html', values: ['1'], label: '인쇄하는 동안만' },
  {
    name: 'data-user-css',
    on: 'html',
    values: ['on', 'off', 'safe'],
    label: '사용자 CSS 적용 상태 — 켠 스니펫이 적용 중이면 on, 주소에 ?safe 를 붙여 열면 safe',
  },
  { name: 'data-view-mode', on: 'content', values: ['live', 'raw', 'view'], label: '편집·원문·보기 모드' },
]

const STRIP_COMMENTS = /\/\*[\s\S]*?\*\//g

// 주석을 지운 CSS 에서 블록 본문의 --이름: 값 을 읽는다. 블록이 없으면 null
function readVarBlock(css: string, head: RegExp): Map<string, string> | null {
  const match = head.exec(css.replace(STRIP_COMMENTS, ''))
  if (!match) return null
  const out = new Map<string, string>()
  const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g
  let m: RegExpExecArray | null
  while ((m = declRe.exec(match[1]))) out.set(m[1], m[2].replace(/\s+/g, ' ').trim())
  return out
}

function stateAttrsText(): string {
  const groups: { on: StateAttr['on']; names: string[] }[] = []
  for (const attr of STATE_ATTRS) {
    if (attr.name === 'data-theme') continue
    const last = groups[groups.length - 1]
    if (last && last.on === attr.on) last.names.push(attr.name)
    else groups.push({ on: attr.on, names: [attr.name] })
  }
  return groups.map((g) => `${g.names.join(' · ')} ${g.on === 'html' ? '(<html>)' : '(문서 영역)'}`).join(', ')
}

function headerComment(): string {
  return [
    '/*',
    '  사용자 CSS 템플릿',
    '  모든 줄이 주석이라 켜 둬도 화면이 바뀌지 않습니다.',
    '  바꾸고 싶은 줄의 앞뒤 주석 표시를 지우면 바로 적용됩니다.',
    `  사용법: ${USER_CSS_GUIDE_PATH}`,
    '',
    '  선택자 규칙',
    '  - 모든 테마·인쇄·HTML 내보내기에: :root:root',
    "  - 한 테마에만: :root[data-theme='white'] · 'sepia' · 'dark'",
    `  - 설정·상태에 따라: ${stateAttrsText()}`,
    '  - 이 템플릿에 없는 클래스는 업데이트로 바뀔 수 있습니다.',
    '',
    '  화면이 망가져 이 창을 열 수 없으면 주소 끝에 ?safe 를 붙여 여세요 (/?safe).',
    '*/',
  ].join('\n')
}

export function buildTemplateCss(tokensCss: string): string {
  const light = readVarBlock(tokensCss, /:root\s*\{([^}]*)\}/)
  const dark = readVarBlock(tokensCss, /:root\[data-theme='dark'\]\s*\{([^}]*)\}/)
  const varLines = (pub: PublicVar, values: Map<string, string> | null) => [
    `  /* ${pub.label} */`,
    `  /* ${pub.name}: ${values?.get(pub.name) ?? ''}; */`,
  ]

  const lines: string[] = [headerComment(), '', ':root:root {']
  let group: PublicVarGroup | null = null
  for (const pub of PUBLIC_VARS) {
    if (pub.group !== group) {
      if (group !== null) lines.push('')
      lines.push(`  /* ── ${pub.group} ── */`)
      group = pub.group
    }
    lines.push(...varLines(pub, light))
  }
  lines.push('}', '', '/* ── 다크 테마에서 값이 다른 것 ── */', ":root[data-theme='dark'] {")
  for (const pub of PUBLIC_VARS) if (dark?.has(pub.name)) lines.push(...varLines(pub, dark))
  lines.push('}', '')

  lines.push('/* ── 화면 뼈대 — 요소가 그 자리에 있다는 것만 약속합니다. 앱 규칙에 지면 특정도를 올리거나 !important 를 쓰세요 ── */')
  for (const hook of CHROME_HOOKS) {
    lines.push(`/* ${hook.label} */`, `/* :root:root [data-ui="${hook.value}"] { } */`)
  }
  lines.push('', '/* ── 본문 — 이 선택자는 앱 규칙과 특정도가 같거나 높아 그대로 쓰면 이깁니다 ── */')
  for (const hook of CONTENT_HOOKS) {
    lines.push(`/* ${hook.label} — 편집 모드 */`, ...hook.edit.map((s) => `/* ${s} { } */`))
    lines.push(`/* ${hook.label} — 보기·인쇄·HTML */`, ...hook.view.map((s) => `/* ${s} { } */`))
  }
  return `${lines.join('\n')}\n`
}
