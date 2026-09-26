// 등록된 명령 목록 — 1차는 템플릿 삽입·인쇄 두 개 (specs/features/F-2022.md 3.3). 명령을 더할 때 고치는 곳이 여기다
import type { PaletteCommand } from './paletteContract'

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
]

// comment.toggleRail 라벨 getter 가 읽는 값 — visibleCommands() 가 when() 을 부른 뒤 같은 렌더에서 라벨을 읽는다
let toggleRailOpen = false
