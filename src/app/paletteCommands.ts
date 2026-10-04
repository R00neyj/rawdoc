// 등록된 명령 목록 — 1차는 템플릿 삽입·인쇄 두 개 (specs/features/F-2022.md 3.3). 명령을 더할 때 고치는 곳이 여기다
import type { PaletteCommand, PaletteItem } from './paletteContract'
import { THEME_OPTIONS, type ThemePref } from './theme'
import { EDITOR_PALETTE_COMMANDS } from './paletteEditorCommands'
import { PALETTE_DATETIME_COMMANDS } from './paletteDateTimeCommands'

// 테마 2단계 각 줄의 keywords (F-2054 3.5)
const THEME_ITEM_KEYWORDS: Record<ThemePref, readonly string[]> = {
  system: ['system', '자동', 'auto', 'os'],
  white: ['white', 'light', '라이트', '밝게'],
  sepia: ['sepia', '종이'],
  dark: ['dark', '어둡게', '야간', '밤'],
}

export const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  {
    id: 'template.insert',
    kind: 'pick',
    label: '템플릿 삽입',
    keywords: ['템플릿', 'template', '서식', '양식', '틀', '넣기'],
    when: (ctx) => ctx.canInsertTemplate,
    stageTitle: '템플릿 삽입',
    placeholder: '템플릿 이름',
    emptyText: '맞는 템플릿이 없습니다',
    // 늘 문자열을 돌려준다 — 폴더 규칙 줄은 사용자 템플릿이 0개일 때만, 변수·도움말 안내 줄은 늘 (F-2037.md 5.1)
    hint: (ctx) => {
      const lines: string[] = []
      if (!ctx.templates.some((t) => t.source.kind === 'doc')) {
        lines.push("최상위에 '템플릿' 폴더를 만들고 문서를 넣으면 여기에 함께 나옵니다.")
      }
      lines.push('{{date}}·{{time}}·{{title}}은 넣을 때 오늘 날짜·지금 시각·문서 제목으로 바뀝니다. {{date:YYYY.MM.DD}}처럼 형식을 붙일 수도 있습니다.')
      lines.push("자세한 내용은 도움말의 '템플릿' 절에 있습니다.")
      return lines.join('\n')
    },
    items: (ctx) => ctx.templates.map((t) => ({ id: t.id, label: t.title, detail: t.detail })),
    pick: (item, ctx, signal) => ctx.insertTemplate(item.id, signal),
  },
  ...PALETTE_DATETIME_COMMANDS,
  {
    id: 'doc.print',
    kind: 'action',
    label: 'PDF (A4 인쇄)',
    keywords: ['인쇄', 'print', 'pdf', 'a4', '내보내기'],
    when: (ctx) => ctx.canPrint,
    run: (ctx) => ctx.printDoc(),
  },
  {
    id: 'e2ee.lock',
    kind: 'action',
    label: '금고 잠그기',
    keywords: ['금고', '잠그기', '잠금', 'lock', '암호'],
    when: (ctx) => ctx.e2ee?.status === 'open',
    run: (ctx) => ctx.e2ee?.lock(),
  },
  {
    id: 'e2ee.unlock',
    kind: 'action',
    label: '금고 열기',
    keywords: ['금고', '열기', 'unlock', '암호'],
    when: (ctx) => ctx.e2ee?.status === 'locked',
    run: (ctx) => ctx.e2ee?.openUnlock(),
  },
  {
    id: 'comment.add',
    kind: 'action',
    label: '댓글 달기',
    shortcut: 'Ctrl+Alt+M',
    keywords: ['댓글', 'comment', '달기', '코멘트', '메모'],
    when: (ctx) => Boolean(ctx.comments?.canAdd),
    run: (ctx) => ctx.comments?.add(),
  },
  {
    id: 'comment.toggleRail',
    kind: 'action',
    // 상태 따라 라벨이 바뀌는 명령 — when() 이 저장한 railOpen 을 라벨 getter 가 읽는다(3.4)
    get label() {
      return toggleRailOpen ? '댓글 닫기' : '댓글 열기'
    },
    shortcut: 'Ctrl+M',
    keywords: ['댓글', 'comment', '레일', '열기', '닫기'],
    when: (ctx) => {
      toggleRailOpen = Boolean(ctx.comments?.railOpen)
      return Boolean(ctx.comments)
    },
    run: (ctx) => ctx.comments?.toggleRail(),
  },
  {
    id: 'notifications.open',
    kind: 'action',
    label: '알림 열기',
    keywords: ['알림', 'notification', '멘션', '답글', '받은'],
    when: (ctx) => Boolean(ctx.notifications),
    run: (ctx) => ctx.notifications?.open(),
  },
  {
    id: 'shortcuts.open',
    kind: 'action',
    label: '단축키 보기',
    shortcut: 'Ctrl+Shift+/',
    keywords: ['단축키', 'shortcut', 'keyboard', '키보드', 'hotkey', '키 목록'],
    when: (ctx) => Boolean(ctx.shortcuts),
    run: (ctx) => ctx.shortcuts?.open(),
  },

  // ----- 만들기 (F-2054 3.2) -----
  {
    id: 'doc.new',
    kind: 'action',
    label: '새 문서',
    keywords: ['new', '문서 만들기', '추가', '노트', 'note', 'page', '빈 문서'],
    when: (ctx) => Boolean(ctx.docActions),
    run: (ctx) => ctx.docActions?.newDoc(),
  },
  {
    id: 'folder.new',
    kind: 'action',
    label: '새 폴더',
    keywords: ['folder', '폴더 만들기', '디렉터리', 'directory', '그룹'],
    when: (ctx) => Boolean(ctx.docActions),
    run: (ctx) => ctx.docActions?.newFolder(),
  },
  {
    id: 'doc.import',
    kind: 'action',
    label: '.md 가져오기',
    keywords: ['import', '가져오기', '불러오기', '업로드', 'upload', '파일 열기', 'md', 'markdown', '마크다운'],
    when: (ctx) => Boolean(ctx.docActions),
    run: (ctx) => ctx.docActions?.importDoc(),
  },
  {
    id: 'github.import',
    kind: 'action',
    label: 'GitHub에서 가져오기…',
    keywords: ['github', '깃허브', '저장소', '가져오기', 'import', 'repo'],
    when: (ctx) => Boolean(ctx.github),
    run: (ctx) => ctx.github?.importFile(),
  },
  {
    id: 'github.pull',
    kind: 'action',
    label: '이 문서 GitHub에서 당기기…',
    keywords: ['github', '깃허브', '저장소', '당기기', 'pull', '풀'],
    when: (ctx) => Boolean(ctx.github?.pull),
    run: (ctx) => ctx.github?.pull?.(),
  },
  {
    id: 'github.push',
    kind: 'action',
    label: '이 문서 GitHub에 푸시…',
    keywords: ['github', '깃허브', '저장소', '푸시', 'push', '올리기'],
    when: (ctx) => Boolean(ctx.github?.push),
    run: (ctx) => ctx.github?.push?.(),
  },

  // ----- 이동 (F-2054 3.2) -----
  {
    id: 'search.open',
    kind: 'action',
    label: '여러 문서 검색',
    shortcut: 'Ctrl+Shift+F',
    keywords: ['검색', 'search', '본문 검색', '전체 검색', '모든 문서', 'find in files'],
    when: (ctx) => Boolean(ctx.nav),
    run: (ctx) => ctx.nav?.openSearch(),
  },
  {
    id: 'nav.home',
    kind: 'action',
    label: '홈으로',
    keywords: ['홈', 'home', '처음', '시작 화면', '최근 문서', '메인'],
    when: (ctx) => Boolean(ctx.nav) && ctx.nav?.screen !== 'home',
    run: (ctx) => ctx.nav?.goHome(),
  },
  {
    id: 'nav.map',
    kind: 'action',
    label: '지도 열기',
    keywords: ['지도', 'map', 'graph', '그래프', '네트워크', '연결', '위키링크'],
    when: (ctx) => Boolean(ctx.nav) && ctx.nav?.screen !== 'map',
    run: (ctx) => ctx.nav?.openMap(),
  },
  {
    id: 'nav.help',
    kind: 'action',
    label: '도움말 열기',
    keywords: ['도움말', 'help', '설명서', 'manual', 'faq', '사용 방법'],
    when: (ctx) => Boolean(ctx.nav) && ctx.nav?.screen !== 'help',
    run: (ctx) => ctx.nav?.openHelp(),
  },
  {
    id: 'nav.guides',
    kind: 'action',
    label: '사용법 열기 (새 탭)',
    keywords: ['사용법', 'guides', 'guide', '가이드', '튜토리얼', 'tutorial', '사이트'],
    when: (ctx) => Boolean(ctx.nav),
    run: (ctx) => ctx.nav?.openGuides(),
  },
  {
    id: 'nav.shares',
    kind: 'action',
    label: '공유 관리 열기',
    keywords: ['공유 관리', 'shares', '공유', 'share', '링크 목록', '초대 목록', '권한'],
    when: (ctx) => Boolean(ctx.nav?.openShares) && ctx.nav?.screen !== 'shares',
    run: (ctx) => ctx.nav?.openShares?.(),
  },
  {
    id: 'nav.settings',
    kind: 'action',
    label: '설정 열기',
    keywords: ['설정', 'settings', '환경설정', '옵션', 'preferences', 'options'],
    when: (ctx) => Boolean(ctx.nav),
    run: (ctx) => ctx.nav?.openSettings(),
  },

  // ----- 지금 문서 (F-2054 3.3, 사용자 결정 8) -----
  {
    id: 'doc.openNewTab',
    kind: 'action',
    label: '이 문서 새 탭에서 열기',
    keywords: ['새 탭', 'new tab', 'tab', '창', 'window', '나란히'],
    when: (ctx) => Boolean(ctx.docActions?.current),
    run: (ctx) => ctx.docActions?.current?.openNewTab(),
  },
  {
    id: 'doc.togglePin',
    kind: 'action',
    // 상태 따라 라벨이 바뀌는 명령 — when() 이 저장한 pinned 를 라벨 getter 가 읽는다(3.6)
    get label() {
      return docTogglePinned ? '이 문서 고정 해제' : '이 문서 상단 고정'
    },
    keywords: ['고정', 'pin', '상단', '위로', '즐겨찾기', '북마크', 'bookmark'],
    when: (ctx) => {
      docTogglePinned = Boolean(ctx.docActions?.current?.pinned)
      return Boolean(ctx.docActions?.current?.owned)
    },
    run: (ctx) => ctx.docActions?.current?.togglePin(),
  },
  {
    id: 'doc.move',
    kind: 'action',
    label: '이 문서 폴더로 이동…',
    keywords: ['이동', 'move', '폴더', '옮기기', '정리'],
    when: (ctx) => Boolean(ctx.docActions?.current?.owned),
    run: (ctx) => ctx.docActions?.current?.move(),
  },
  {
    id: 'doc.exportMd',
    kind: 'action',
    label: '.md 내보내기',
    shortcut: 'Ctrl+S',
    keywords: ['내보내기', 'export', 'md', 'markdown', '마크다운', '다운로드', 'download', '저장', '파일'],
    when: (ctx) => Boolean(ctx.output),
    run: (ctx) => ctx.output?.exportMd(),
  },
  {
    id: 'doc.exportTxt',
    kind: 'action',
    label: '.txt 내보내기 (평문)',
    keywords: ['내보내기', 'export', 'txt', 'text', '텍스트', '평문', 'plain', '다운로드'],
    when: (ctx) => Boolean(ctx.output),
    run: (ctx) => ctx.output?.exportTxt(),
  },
  {
    id: 'doc.exportHtml',
    kind: 'action',
    label: 'HTML 파일 내보내기',
    keywords: ['내보내기', 'export', 'html', '웹', 'web', '다운로드'],
    when: (ctx) => Boolean(ctx.output),
    run: (ctx) => ctx.output?.exportHtml(),
  },
  {
    id: 'doc.copyRich',
    kind: 'action',
    label: '서식 있는 복사',
    keywords: ['복사', 'copy', 'rich', 'html', '붙여넣기', '워드', 'word', '메일', 'email'],
    when: (ctx) => Boolean(ctx.output),
    run: (ctx) => ctx.output?.copyRich(),
  },
  {
    id: 'share.copyLink',
    kind: 'action',
    label: '링크 복사',
    keywords: ['공유', 'share', '링크', 'link', 'url', '주소', '복사', 'copy'],
    when: (ctx) => Boolean(ctx.output) && !ctx.output?.e2ee,
    run: (ctx) => ctx.output?.copyLink(),
  },
  {
    id: 'share.copyMarkdown',
    kind: 'action',
    label: '마크다운 복사',
    keywords: ['공유', 'share', '마크다운', 'markdown', 'md', '원문', '복사', 'copy'],
    when: (ctx) => Boolean(ctx.output),
    run: (ctx) => ctx.output?.copyMarkdown(),
  },
  {
    id: 'share.invite',
    kind: 'action',
    label: '사람 초대…',
    keywords: ['초대', 'invite', '공유', 'share', '권한', '이메일', 'email', '함께 편집'],
    when: (ctx) => Boolean(ctx.output?.invite) && !ctx.output?.e2ee,
    run: (ctx) => ctx.output?.invite?.(),
  },
  {
    id: 'doc.delete',
    kind: 'action',
    label: '이 문서 삭제',
    keywords: ['삭제', 'delete', '지우기', '제거', 'remove', '없애기'],
    when: (ctx) => Boolean(ctx.docActions?.current?.owned),
    run: (ctx) => ctx.docActions?.current?.remove(),
  },

  // ----- 보기 (F-2054 3.4) -----
  {
    id: 'mode.live',
    kind: 'action',
    label: '편집 모드로 전환',
    keywords: ['편집', 'edit', 'live', '모드', 'mode', '라이브'],
    when: (ctx) => ctx.view?.mode === 'raw' || ctx.view?.mode === 'view',
    run: (ctx) => ctx.view?.setMode('live'),
  },
  {
    id: 'mode.raw',
    kind: 'action',
    label: '원문 모드로 전환',
    keywords: ['원문', 'raw', 'source', '소스', '마크다운', 'markdown', '코드', '모드', 'mode'],
    when: (ctx) => ctx.view?.mode === 'live' || ctx.view?.mode === 'view',
    run: (ctx) => ctx.view?.setMode('raw'),
  },
  {
    id: 'mode.view',
    kind: 'action',
    label: '보기 모드로 전환',
    keywords: ['보기', 'view', 'read', '읽기', '읽기 전용', '모드', 'mode', '미리보기', 'preview'],
    when: (ctx) => ctx.view?.mode === 'live' || ctx.view?.mode === 'raw',
    run: (ctx) => ctx.view?.setMode('view'),
  },
  {
    id: 'view.sidebar',
    kind: 'action',
    // 4.4 표 — 넓은 창 펼침/레일, 좁은 창 열림/닫힘
    get label() {
      if (sidebarViewState === 'expanded') return '사이드바 접기'
      if (sidebarViewState === 'collapsed') return '사이드바 펴기'
      if (sidebarViewState === 'narrowOpen') return '사이드바 닫기'
      return '사이드바 열기'
    },
    keywords: ['사이드바', 'sidebar', '목록', '패널', 'panel', '레일', 'toggle'],
    when: (ctx) => {
      sidebarViewState = ctx.view?.sidebar ?? null
      return Boolean(ctx.view)
    },
    run: (ctx) => ctx.view?.toggleSidebar(),
  },
  {
    id: 'view.theme',
    kind: 'pick',
    label: '테마 바꾸기',
    keywords: ['테마', 'theme', '다크', 'dark', '라이트', 'light', '화이트', 'white', '세피아', 'sepia', '밝게', '어둡게', '야간', '색'],
    when: (ctx) => Boolean(ctx.view),
    stageTitle: '테마 바꾸기',
    placeholder: '테마 이름',
    emptyText: '맞는 테마가 없습니다',
    items: (ctx): PaletteItem[] =>
      THEME_OPTIONS.map((opt) => ({
        id: opt.value,
        label: opt.label,
        detail: ctx.view?.theme === opt.value ? '사용 중' : undefined,
        keywords: THEME_ITEM_KEYWORDS[opt.value],
      })),
    pick: (item, ctx) => ctx.view?.setTheme(item.id as ThemePref),
  },
  {
    id: 'view.lineNumbers',
    kind: 'action',
    get label() {
      return lineNumbersOn ? '줄 번호 숨기기' : '줄 번호 표시하기'
    },
    keywords: ['줄 번호', 'line numbers', '행 번호', '거터', 'gutter', '번호'],
    when: (ctx) => {
      lineNumbersOn = Boolean(ctx.view?.lineNumbers)
      return Boolean(ctx.view)
    },
    run: (ctx) => ctx.view?.toggleLineNumbers(),
  },
  {
    id: 'view.toolbar',
    kind: 'action',
    get label() {
      return toolbarOn ? '탭바 숨기기' : '탭바 표시하기'
    },
    keywords: ['탭바', 'toolbar', '툴바', '도구 모음', '단추 줄', '리본'],
    when: (ctx) => {
      toolbarOn = Boolean(ctx.view?.toolbar)
      return Boolean(ctx.view)
    },
    run: (ctx) => ctx.view?.toggleToolbar(),
  },
  {
    id: 'view.wikiPreview',
    kind: 'action',
    get label() {
      return wikiPreviewOn ? '위키링크 미리보기 숨기기' : '위키링크 미리보기 표시하기'
    },
    keywords: ['위키링크', 'wikilink', '미리보기', 'preview', 'hover', '호버', '링크 미리보기'],
    when: (ctx) => {
      wikiPreviewOn = Boolean(ctx.view?.wikiPreview)
      return Boolean(ctx.view)
    },
    run: (ctx) => ctx.view?.toggleWikiPreview(),
  },
  // 서식·단락·삽입 27개 — 앱 명령 뒤, 마지막 (F-2055 3.3)
  ...EDITOR_PALETTE_COMMANDS,
]

// comment.toggleRail 라벨 getter 가 읽는 값 — visibleCommands() 가 when() 을 부른 뒤 같은 렌더에서 라벨을 읽는다
let toggleRailOpen = false
// F-2054 라벨 getter 가 읽는 값 — 명령마다 하나(3.6)
let docTogglePinned = false
let sidebarViewState: 'expanded' | 'collapsed' | 'narrowOpen' | 'narrowClosed' | null = null
let lineNumbersOn = false
let toolbarOn = false
let wikiPreviewOn = false
