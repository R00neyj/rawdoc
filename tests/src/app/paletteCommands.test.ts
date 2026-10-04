import { describe, expect, it } from 'vitest'
import { PALETTE_COMMANDS } from '../../../src/app/paletteCommands'
import { EDITOR_COMMANDS } from '../../../src/app/contextMenuItems'
import { filterPaletteItems } from '../../../src/app/paletteContract'
import type { PaletteContext } from '../../../src/app/paletteContract'
import type { TemplateEntry } from '../../../src/lib/templates'

type ExtraCtx = Pick<PaletteContext, 'nav' | 'docActions' | 'view' | 'output'>

function ctx(
  templates: readonly TemplateEntry[],
  e2ee?: PaletteContext['e2ee'],
  comments?: PaletteContext['comments'],
  notifications?: PaletteContext['notifications'],
  shortcuts?: PaletteContext['shortcuts'],
  extra?: Partial<ExtraCtx>,
): PaletteContext {
  return {
    canInsertTemplate: true,
    canPrint: true,
    templates,
    insertTemplate: async () => {},
    printDoc: () => {},
    e2ee,
    comments,
    notifications,
    shortcuts,
    ...extra,
  }
}

// 완화한 id 정규식(F-505 3.4, 사용자 결정 Q1) — 영역은 소문자·숫자, 동작은 소문자로 시작해 대문자·숫자·하이픈을 더 받는다
const PALETTE_ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9-]*)+$/

describe('PALETTE_COMMANDS — U3 (F-2022.md 11.1, F-404.md 9장 회귀, F-505 U24)', () => {
  it('id 가 순서대로, 겹치지 않고, 완화한 정규식을 통과한다', () => {
    const ids = PALETTE_COMMANDS.map((c) => c.id)
    expect(ids).toEqual([
      'template.insert',
      'insert.date', // F-2088 날짜·시각 넣기
      'insert.time',
      'doc.print',
      'e2ee.lock',
      'e2ee.unlock',
      'comment.add',
      'comment.toggleRail',
      'notifications.open',
      'shortcuts.open',
      'doc.new',
      'folder.new',
      'doc.import',
      'github.import',
      'github.pull',
      'github.push',
      'search.open',
      'nav.home',
      'nav.map',
      'nav.help',
      'nav.guides',
      'nav.shares',
      'nav.settings',
      'doc.openNewTab',
      'doc.togglePin',
      'doc.move',
      'doc.exportMd',
      'doc.exportTxt',
      'doc.exportHtml',
      'doc.copyRich',
      'share.copyLink',
      'share.copyMarkdown',
      'share.invite',
      'doc.delete',
      'mode.live',
      'mode.raw',
      'mode.view',
      'view.sidebar',
      'view.theme',
      'view.lineNumbers',
      'view.toolbar',
      'view.wikiPreview',
      // F-2055 — 서식·단락·삽입 27개가 끝에
      ...EDITOR_COMMANDS.map((c) => `editor.${c.id}`),
    ])
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(PALETTE_ID_RE)
  })

  it('U24 — 완화한 정규식은 camelCase 세그먼트를 받고, 잘못된 모양은 걸러낸다 (r5)', () => {
    for (const ok of ['comment.add', 'comment.toggleRail', 'notifications.open', 'template.insert', 'doc.print', 'e2ee.lock', 'e2ee.unlock']) {
      expect(ok).toMatch(PALETTE_ID_RE)
    }
    for (const bad of ['Comment.add', 'comment.Toggle', 'comment', 'comment.toggle_rail', 'comment.-x']) {
      expect(bad).not.toMatch(PALETTE_ID_RE)
    }
  })

  // F-2037.md 9장 — 폴더 줄은 사용자 템플릿이 없을 때만, 변수·도움말 줄은 늘(U5)
  it('template.insert 의 hint — 폴더 줄은 사용자 템플릿이 없을 때만, 변수·도움말 줄은 늘', () => {
    const cmd = PALETTE_COMMANDS.find((c) => c.id === 'template.insert')
    if (!cmd || cmd.kind !== 'pick' || !cmd.hint) throw new Error('template.insert not found')

    const folderLine = "최상위에 '템플릿' 폴더를 만들고 문서를 넣으면 여기에 함께 나옵니다."
    const varsLine = '{{date}}·{{time}}·{{title}}은 넣을 때 오늘 날짜·지금 시각·문서 제목으로 바뀝니다. {{date:YYYY.MM.DD}}처럼 형식을 붙일 수도 있습니다.'
    const helpLine = "자세한 내용은 도움말의 '템플릿' 절에 있습니다."

    const noDocTemplates: TemplateEntry[] = [{ id: 'builtin:meeting', title: '회의록', detail: '내장', source: { kind: 'builtin', body: '' } }]
    const noDocHint = cmd.hint(ctx(noDocTemplates))
    expect(noDocHint).toBe([folderLine, varsLine, helpLine].join('\n'))
    expect(noDocHint).not.toBeNull()

    const withDocTemplate: TemplateEntry[] = [
      { id: 'doc:1', title: '주간 보고', detail: '템플릿', source: { kind: 'doc', docId: '1' } },
      ...noDocTemplates,
    ]
    const withDocHint = cmd.hint(ctx(withDocTemplate))
    expect(withDocHint).toBe([varsLine, helpLine].join('\n'))
    expect(withDocHint).not.toBeNull()
  })
})

describe('e2ee.lock·e2ee.unlock — U14 (F-404.md 10.1)', () => {
  function findWhen(id: string) {
    const cmd = PALETTE_COMMANDS.find((c) => c.id === id)
    if (!cmd) throw new Error(`${id} not found`)
    return cmd.when
  }

  it('ctx.e2ee 가 없으면 둘 다 when 이 거짓', () => {
    expect(findWhen('e2ee.lock')(ctx([]))).toBe(false)
    expect(findWhen('e2ee.unlock')(ctx([]))).toBe(false)
  })

  it("status 'open' 이면 잠그기만, 'locked' 면 열기만, 'none'·'unknown' 이면 둘 다 거짓", () => {
    const open = ctx([], { status: 'open', lock: () => {}, openUnlock: () => {} })
    expect(findWhen('e2ee.lock')(open)).toBe(true)
    expect(findWhen('e2ee.unlock')(open)).toBe(false)

    const locked = ctx([], { status: 'locked', lock: () => {}, openUnlock: () => {} })
    expect(findWhen('e2ee.lock')(locked)).toBe(false)
    expect(findWhen('e2ee.unlock')(locked)).toBe(true)

    const none = ctx([], { status: 'none', lock: () => {}, openUnlock: () => {} })
    expect(findWhen('e2ee.lock')(none)).toBe(false)
    expect(findWhen('e2ee.unlock')(none)).toBe(false)

    const unknown = ctx([], { status: 'unknown', lock: () => {}, openUnlock: () => {} })
    expect(findWhen('e2ee.lock')(unknown)).toBe(false)
    expect(findWhen('e2ee.unlock')(unknown)).toBe(false)
  })

  it('실행 — e2ee.lock 은 lock(), e2ee.unlock 은 openUnlock() 을 부른다', () => {
    const lock = () => {
      lockCalled = true
    }
    const openUnlock = () => {
      openUnlockCalled = true
    }
    let lockCalled = false
    let openUnlockCalled = false
    const context = ctx([], { status: 'open', lock, openUnlock })
    const lockCmd = PALETTE_COMMANDS.find((c) => c.id === 'e2ee.lock')
    if (!lockCmd || lockCmd.kind !== 'action') throw new Error('e2ee.lock not found')
    lockCmd.run(context)
    expect(lockCalled).toBe(true)

    const unlockCmd = PALETTE_COMMANDS.find((c) => c.id === 'e2ee.unlock')
    if (!unlockCmd || unlockCmd.kind !== 'action') throw new Error('e2ee.unlock not found')
    unlockCmd.run(context)
    expect(openUnlockCalled).toBe(true)
  })
})

describe('comment.add·comment.toggleRail — U22 (F-505 3.4)', () => {
  function visibleIds(comments?: PaletteContext['comments']) {
    const context = ctx([], undefined, comments)
    return PALETTE_COMMANDS.filter((c) => c.when(context)).map((c) => c.id)
  }

  it('comments 없으면 댓글 명령 0개', () => {
    expect(visibleIds(undefined)).not.toContain('comment.add')
    expect(visibleIds(undefined)).not.toContain('comment.toggleRail')
  })

  it('canAdd 거짓이면 comment.toggleRail 만', () => {
    const ids = visibleIds({ canAdd: false, railOpen: false, add: () => {}, toggleRail: () => {} })
    expect(ids).not.toContain('comment.add')
    expect(ids).toContain('comment.toggleRail')
  })

  it('canAdd 참·railOpen 참이면 둘 다, 토글 라벨은 댓글 닫기', () => {
    const context = ctx([], undefined, { canAdd: true, railOpen: true, add: () => {}, toggleRail: () => {} })
    const visible = PALETTE_COMMANDS.filter((c) => c.when(context))
    expect(visible.map((c) => c.id)).toEqual(expect.arrayContaining(['comment.add', 'comment.toggleRail']))
    const toggle = visible.find((c) => c.id === 'comment.toggleRail')
    expect(toggle?.label).toBe('댓글 닫기')
    const add = PALETTE_COMMANDS.find((c) => c.id === 'comment.add')
    expect(add?.shortcut).toBe('Ctrl+Alt+M')
  })

  it('railOpen 거짓이면 토글 라벨은 댓글 열기', () => {
    const context = ctx([], undefined, { canAdd: true, railOpen: false, add: () => {}, toggleRail: () => {} })
    const visible = PALETTE_COMMANDS.filter((c) => c.when(context))
    const toggle = visible.find((c) => c.id === 'comment.toggleRail')
    expect(toggle?.label).toBe('댓글 열기')
  })
})

describe('notifications.open — U19 (F-507 3.6)', () => {
  it('ctx.notifications 없으면 안 보인다, 있으면 보이고 라벨이 알림 열기', () => {
    const withoutIt = ctx([], undefined, undefined, undefined)
    expect(PALETTE_COMMANDS.filter((c) => c.when(withoutIt)).map((c) => c.id)).not.toContain('notifications.open')

    const withIt = ctx([], undefined, undefined, { open: () => {} })
    const visible = PALETTE_COMMANDS.filter((c) => c.when(withIt))
    const cmd = visible.find((c) => c.id === 'notifications.open')
    expect(cmd?.label).toBe('알림 열기')
  })

  it('실행 — ctx.notifications.open() 을 부른다', () => {
    let opened = false
    const context = ctx([], undefined, undefined, { open: () => { opened = true } })
    const cmd = PALETTE_COMMANDS.find((c) => c.id === 'notifications.open')
    if (!cmd || cmd.kind !== 'action') throw new Error('notifications.open not found')
    cmd.run(context)
    expect(opened).toBe(true)
  })
})

describe('shortcuts.open — U12 (F-2052 6.3)', () => {
  it('ctx.shortcuts 없으면 안 보이고, 있으면 보이며 라벨 단축키 보기', () => {
    const withoutIt = ctx([], undefined, undefined, undefined, undefined)
    expect(PALETTE_COMMANDS.filter((c) => c.when(withoutIt)).map((c) => c.id)).not.toContain('shortcuts.open')

    const withIt = ctx([], undefined, undefined, undefined, { open: () => {} })
    const visible = PALETTE_COMMANDS.filter((c) => c.when(withIt))
    const cmd = visible.find((c) => c.id === 'shortcuts.open')
    expect(cmd?.label).toBe('단축키 보기')
  })

  it('실행 — ctx.shortcuts.open() 을 한 번 부른다', () => {
    let openCount = 0
    const context = ctx([], undefined, undefined, undefined, { open: () => { openCount += 1 } })
    const cmd = PALETTE_COMMANDS.find((c) => c.id === 'shortcuts.open')
    if (!cmd || cmd.kind !== 'action') throw new Error('shortcuts.open not found')
    cmd.run(context)
    expect(openCount).toBe(1)
  })
})

// F-2054 새 명령 29개의 id — 등록 순서(3.1)
const F2054_IDS = [
  'doc.new', 'folder.new', 'doc.import',
  'search.open', 'nav.home', 'nav.map', 'nav.help', 'nav.guides', 'nav.shares', 'nav.settings',
  'doc.openNewTab', 'doc.togglePin', 'doc.move', 'doc.exportMd', 'doc.exportTxt', 'doc.exportHtml',
  'doc.copyRich', 'share.copyLink', 'share.copyMarkdown', 'share.invite', 'doc.delete',
  'mode.live', 'mode.raw', 'mode.view', 'view.sidebar', 'view.theme', 'view.lineNumbers', 'view.toolbar', 'view.wikiPreview',
]

function visibleIdsOf(context: PaletteContext) {
  return PALETTE_COMMANDS.filter((c) => c.when(context)).map((c) => c.id)
}

function noop() {}

function fullExtra(overrides: Partial<ExtraCtx> = {}): ExtraCtx {
  return {
    nav: {
      screen: 'doc',
      openSearch: noop,
      goHome: noop,
      openMap: noop,
      openHelp: noop,
      openGuides: noop,
      openSettings: noop,
      openShares: noop,
    },
    docActions: {
      newDoc: noop,
      newFolder: noop,
      importDoc: noop,
      current: { owned: true, pinned: false, openNewTab: noop, togglePin: noop, move: noop, remove: noop },
    },
    view: {
      mode: 'live',
      setMode: noop,
      sidebar: 'expanded',
      toggleSidebar: noop,
      theme: 'system',
      setTheme: noop,
      lineNumbers: true,
      toolbar: true,
      wikiPreview: true,
      toggleLineNumbers: noop,
      toggleToolbar: noop,
      toggleWikiPreview: noop,
    },
    output: {
      e2ee: false,
      exportMd: noop,
      exportTxt: noop,
      exportHtml: noop,
      copyRich: noop,
      copyLink: noop,
      copyMarkdown: noop,
      invite: noop,
    },
    ...overrides,
  }
}

describe('F-2054 새 명령 — U2 (F-2054 11.1)', () => {
  it('기존 ctx([]) (새 필드 없음) 이면 29개 모두 when 이 거짓', () => {
    const context = ctx([])
    for (const id of F2054_IDS) {
      const cmd = PALETTE_COMMANDS.find((c) => c.id === id)
      if (!cmd) throw new Error(`${id} not found`)
      expect(cmd.when(context), id).toBe(false)
    }
  })
})

describe('nav — U3 (F-2054 11.1)', () => {
  const screens = ['doc', 'home', 'help', 'map', 'shares', 'sharedLink'] as const

  it('home 에서 nav.home 없음, help 에서 nav.help 없음, map 에서 nav.map 없음, shares 에서 nav.shares 없음, 그 밖 모두 보임', () => {
    for (const screen of screens) {
      const extra = fullExtra({ nav: { ...fullExtra().nav!, screen } })
      const ids = visibleIdsOf(ctx([], undefined, undefined, undefined, undefined, extra))
      expect(ids.includes('nav.home'), `${screen} nav.home`).toBe(screen !== 'home')
      expect(ids.includes('nav.help'), `${screen} nav.help`).toBe(screen !== 'help')
      expect(ids.includes('nav.map'), `${screen} nav.map`).toBe(screen !== 'map')
      expect(ids.includes('nav.shares'), `${screen} nav.shares`).toBe(screen !== 'shares')
      expect(ids).toContain('search.open')
      expect(ids).toContain('nav.guides')
      expect(ids).toContain('nav.settings')
    }
  })

  it('openShares 없으면 nav.shares 없음', () => {
    const extra = fullExtra({ nav: { ...fullExtra().nav!, openShares: undefined } })
    const ids = visibleIdsOf(ctx([], undefined, undefined, undefined, undefined, extra))
    expect(ids).not.toContain('nav.shares')
  })

  it('각 명령 run 이 해당 함수를 1번 부른다', () => {
    const calls: Record<string, number> = {}
    const inc = (k: string) => () => {
      calls[k] = (calls[k] ?? 0) + 1
    }
    const nav = {
      screen: 'home' as const,
      openSearch: inc('openSearch'),
      goHome: inc('goHome'),
      openMap: inc('openMap'),
      openHelp: inc('openHelp'),
      openGuides: inc('openGuides'),
      openSettings: inc('openSettings'),
      openShares: inc('openShares'),
    }
    const context = ctx([], undefined, undefined, undefined, undefined, { nav })
    for (const [id, key] of [
      ['search.open', 'openSearch'],
      ['nav.map', 'openMap'],
      ['nav.help', 'openHelp'],
      ['nav.guides', 'openGuides'],
      ['nav.settings', 'openSettings'],
    ] as const) {
      const cmd = PALETTE_COMMANDS.find((c) => c.id === id)
      if (!cmd || cmd.kind !== 'action') throw new Error(`${id} not found`)
      cmd.run(context)
      expect(calls[key]).toBe(1)
    }
    // nav.home·nav.shares 는 home 화면에선 nav.shares 만 보이지 않으니 직접 run 호출로 확인
    const homeCmd = PALETTE_COMMANDS.find((c) => c.id === 'nav.home')
    if (!homeCmd || homeCmd.kind !== 'action') throw new Error('nav.home not found')
    homeCmd.run(context)
    expect(calls.goHome).toBe(1)
    const sharesCmd = PALETTE_COMMANDS.find((c) => c.id === 'nav.shares')
    if (!sharesCmd || sharesCmd.kind !== 'action') throw new Error('nav.shares not found')
    sharesCmd.run(context)
    expect(calls.openShares).toBe(1)
  })

  it("search.open.shortcut === 'Ctrl+Shift+F'", () => {
    const cmd = PALETTE_COMMANDS.find((c) => c.id === 'search.open')
    expect(cmd?.shortcut).toBe('Ctrl+Shift+F')
  })
})

describe('docActions — U4 (F-2054 11.1)', () => {
  it('current 없음 — 만들기 3개만 보인다', () => {
    const extra = fullExtra({ docActions: { newDoc: noop, newFolder: noop, importDoc: noop } })
    const ids = visibleIdsOf(ctx([], undefined, undefined, undefined, undefined, extra))
    expect(ids).toContain('doc.new')
    expect(ids).toContain('folder.new')
    expect(ids).toContain('doc.import')
    expect(ids).not.toContain('doc.openNewTab')
    expect(ids).not.toContain('doc.togglePin')
    expect(ids).not.toContain('doc.move')
    expect(ids).not.toContain('doc.delete')
  })

  it('owned:false — doc.openNewTab 만', () => {
    const extra = fullExtra({
      docActions: {
        newDoc: noop,
        newFolder: noop,
        importDoc: noop,
        current: { owned: false, pinned: false, openNewTab: noop, togglePin: noop, move: noop, remove: noop },
      },
    })
    const ids = visibleIdsOf(ctx([], undefined, undefined, undefined, undefined, extra))
    expect(ids).toContain('doc.openNewTab')
    expect(ids).not.toContain('doc.togglePin')
    expect(ids).not.toContain('doc.move')
    expect(ids).not.toContain('doc.delete')
  })

  it('owned:true — 4개 모두, doc.togglePin 라벨이 pinned 를 따른다', () => {
    const extraUnpinned = fullExtra()
    const idsUnpinned = visibleIdsOf(ctx([], undefined, undefined, undefined, undefined, extraUnpinned))
    expect(idsUnpinned).toContain('doc.openNewTab')
    expect(idsUnpinned).toContain('doc.togglePin')
    expect(idsUnpinned).toContain('doc.move')
    expect(idsUnpinned).toContain('doc.delete')
    const toggleCmd = PALETTE_COMMANDS.find((c) => c.id === 'doc.togglePin')
    if (!toggleCmd) throw new Error('doc.togglePin not found')
    expect(toggleCmd.label).toBe('이 문서 상단 고정')

    const extraPinned = fullExtra({
      docActions: {
        newDoc: noop,
        newFolder: noop,
        importDoc: noop,
        current: { owned: true, pinned: true, openNewTab: noop, togglePin: noop, move: noop, remove: noop },
      },
    })
    visibleIdsOf(ctx([], undefined, undefined, undefined, undefined, extraPinned))
    expect(toggleCmd.label).toBe('이 문서 고정 해제')
  })

  it('run 이 newDoc·newFolder·importDoc·openNewTab·togglePin·move·remove 를 1번씩 부른다', () => {
    const calls: Record<string, number> = {}
    const inc = (k: string) => () => {
      calls[k] = (calls[k] ?? 0) + 1
    }
    const docActions = {
      newDoc: inc('newDoc'),
      newFolder: inc('newFolder'),
      importDoc: inc('importDoc'),
      current: { owned: true, pinned: false, openNewTab: inc('openNewTab'), togglePin: inc('togglePin'), move: inc('move'), remove: inc('remove') },
    }
    const context = ctx([], undefined, undefined, undefined, undefined, { docActions })
    for (const [id, key] of [
      ['doc.new', 'newDoc'],
      ['folder.new', 'newFolder'],
      ['doc.import', 'importDoc'],
      ['doc.openNewTab', 'openNewTab'],
      ['doc.togglePin', 'togglePin'],
      ['doc.move', 'move'],
      ['doc.delete', 'remove'],
    ] as const) {
      const cmd = PALETTE_COMMANDS.find((c) => c.id === id)
      if (!cmd || cmd.kind !== 'action') throw new Error(`${id} not found`)
      cmd.run(context)
      expect(calls[key]).toBe(1)
    }
  })
})

describe('view — U5 (F-2054 11.1)', () => {
  it('mode null 이면 모드 명령 0개, live/raw/view 마다 나머지 둘만 보인다', () => {
    const modeNull = fullExtra({ view: { ...fullExtra().view!, mode: null } })
    const idsNull = visibleIdsOf(ctx([], undefined, undefined, undefined, undefined, modeNull))
    expect(idsNull).not.toContain('mode.live')
    expect(idsNull).not.toContain('mode.raw')
    expect(idsNull).not.toContain('mode.view')

    const idsLive = visibleIdsOf(ctx([], undefined, undefined, undefined, undefined, fullExtra({ view: { ...fullExtra().view!, mode: 'live' } })))
    expect(idsLive).not.toContain('mode.live')
    expect(idsLive).toContain('mode.raw')
    expect(idsLive).toContain('mode.view')

    const idsRaw = visibleIdsOf(ctx([], undefined, undefined, undefined, undefined, fullExtra({ view: { ...fullExtra().view!, mode: 'raw' } })))
    expect(idsRaw).toContain('mode.live')
    expect(idsRaw).not.toContain('mode.raw')
    expect(idsRaw).toContain('mode.view')

    const idsView = visibleIdsOf(ctx([], undefined, undefined, undefined, undefined, fullExtra({ view: { ...fullExtra().view!, mode: 'view' } })))
    expect(idsView).toContain('mode.live')
    expect(idsView).toContain('mode.raw')
    expect(idsView).not.toContain('mode.view')
  })

  it('setMode 인자가 명령 모드', () => {
    const calls: string[] = []
    const view = { ...fullExtra().view!, mode: 'view' as const, setMode: (m: string) => calls.push(m) }
    const context = ctx([], undefined, undefined, undefined, undefined, { view })
    for (const id of ['mode.live', 'mode.raw']) {
      const cmd = PALETTE_COMMANDS.find((c) => c.id === id)
      if (!cmd || cmd.kind !== 'action') throw new Error(`${id} not found`)
      cmd.run(context)
    }
    expect(calls).toEqual(['live', 'raw'])
  })

  it('view.sidebar 라벨 — 4.4 표 넷', () => {
    const sidebarCmd = PALETTE_COMMANDS.find((c) => c.id === 'view.sidebar')
    if (!sidebarCmd) throw new Error('view.sidebar not found')
    const table: Record<string, string> = {
      expanded: '사이드바 접기',
      collapsed: '사이드바 펴기',
      narrowClosed: '사이드바 열기',
      narrowOpen: '사이드바 닫기',
    }
    for (const [sidebar, label] of Object.entries(table)) {
      const context = ctx([], undefined, undefined, undefined, undefined, fullExtra({ view: { ...fullExtra().view!, sidebar: sidebar as never } }))
      sidebarCmd.when(context)
      expect(sidebarCmd.label, sidebar).toBe(label)
    }
  })

  it('토글 셋 라벨·run — 줄 번호·탭바·위키링크 미리보기', () => {
    const table = [
      { id: 'view.lineNumbers', field: 'lineNumbers', on: '줄 번호 숨기기', off: '줄 번호 표시하기', toggle: 'toggleLineNumbers' },
      { id: 'view.toolbar', field: 'toolbar', on: '탭바 숨기기', off: '탭바 표시하기', toggle: 'toggleToolbar' },
      { id: 'view.wikiPreview', field: 'wikiPreview', on: '위키링크 미리보기 숨기기', off: '위키링크 미리보기 표시하기', toggle: 'toggleWikiPreview' },
    ] as const
    for (const row of table) {
      let toggleCalls = 0
      const view = { ...fullExtra().view!, [row.field]: true, [row.toggle]: () => { toggleCalls += 1 } }
      const context = ctx([], undefined, undefined, undefined, undefined, { view })
      const cmd = PALETTE_COMMANDS.find((c) => c.id === row.id)
      if (!cmd || cmd.kind !== 'action') throw new Error(`${row.id} not found`)
      cmd.when(context)
      expect(cmd.label, `${row.id} on`).toBe(row.on)
      cmd.run(context)
      expect(toggleCalls).toBe(1)

      const viewOff = { ...fullExtra().view!, [row.field]: false, [row.toggle]: noop }
      cmd.when(ctx([], undefined, undefined, undefined, undefined, { view: viewOff }))
      expect(cmd.label, `${row.id} off`).toBe(row.off)
    }
  })

  it('view.theme — pick, items 4줄 순서·라벨, 지금 값 줄만 사용 중, pick 이 setTheme(id) 를 부른다', () => {
    const cmd = PALETTE_COMMANDS.find((c) => c.id === 'view.theme')
    if (!cmd || cmd.kind !== 'pick') throw new Error('view.theme not found')
    const view = { ...fullExtra().view!, theme: 'sepia' as const }
    const context = ctx([], undefined, undefined, undefined, undefined, { view })
    const items = cmd.items(context)
    expect(items.map((i) => i.id)).toEqual(['system', 'white', 'sepia', 'dark'])
    expect(items.map((i) => i.label)).toEqual(['시스템', '화이트', '세피아', '다크'])
    expect(items.map((i) => i.detail)).toEqual([undefined, undefined, '사용 중', undefined])

    let picked: string | null = null
    const pickView = { ...view, setTheme: (t: string) => { picked = t } }
    void cmd.pick(items[3], ctx([], undefined, undefined, undefined, undefined, { view: pickView }), new AbortController().signal)
    expect(picked).toBe('dark')
  })
})

describe('output — U6 (F-2054 11.1)', () => {
  it('e2ee:true 면 share.copyLink 없음(나머지 5개 있음), invite 없으면 share.invite 없음', () => {
    const output = { e2ee: true, exportMd: noop, exportTxt: noop, exportHtml: noop, copyRich: noop, copyLink: noop, copyMarkdown: noop }
    const ids = visibleIdsOf(ctx([], undefined, undefined, undefined, undefined, { output }))
    expect(ids).not.toContain('share.copyLink')
    expect(ids).not.toContain('share.invite')
    expect(ids).toContain('doc.exportMd')
    expect(ids).toContain('doc.exportTxt')
    expect(ids).toContain('doc.exportHtml')
    expect(ids).toContain('doc.copyRich')
    expect(ids).toContain('share.copyMarkdown')
  })

  it('e2ee:true 면 invite 가 넘어와도 share.invite 없음 (F-2054 4.3, F-409 6.2)', () => {
    const output = { e2ee: true, exportMd: noop, exportTxt: noop, exportHtml: noop, copyRich: noop, copyLink: noop, copyMarkdown: noop, invite: noop }
    const ids = visibleIdsOf(ctx([], undefined, undefined, undefined, undefined, { output }))
    expect(ids).not.toContain('share.invite')
  })

  it('run 이 각 함수를 1번씩 부른다', () => {
    const calls: Record<string, number> = {}
    const inc = (k: string) => () => {
      calls[k] = (calls[k] ?? 0) + 1
    }
    const output = {
      e2ee: false,
      exportMd: inc('exportMd'),
      exportTxt: inc('exportTxt'),
      exportHtml: inc('exportHtml'),
      copyRich: inc('copyRich'),
      copyLink: inc('copyLink'),
      copyMarkdown: inc('copyMarkdown'),
      invite: inc('invite'),
    }
    const context = ctx([], undefined, undefined, undefined, undefined, { output })
    for (const [id, key] of [
      ['doc.exportMd', 'exportMd'],
      ['doc.exportTxt', 'exportTxt'],
      ['doc.exportHtml', 'exportHtml'],
      ['doc.copyRich', 'copyRich'],
      ['share.copyLink', 'copyLink'],
      ['share.copyMarkdown', 'copyMarkdown'],
      ['share.invite', 'invite'],
    ] as const) {
      const cmd = PALETTE_COMMANDS.find((c) => c.id === id)
      if (!cmd || cmd.kind !== 'action') throw new Error(`${id} not found`)
      cmd.run(context)
      expect(calls[key]).toBe(1)
    }
  })

  it('라벨이 바뀐 뒤 거르기 — 첫 번째 결과에 view.lineNumbers 있음, 두 번째엔 없음', () => {
    const view = { ...fullExtra().view!, lineNumbers: true }
    const context = ctx([], undefined, undefined, undefined, undefined, { view })
    const visible1 = PALETTE_COMMANDS.filter((c) => c.when(context))
    const filtered1 = filterPaletteItems(visible1, '숨기기')
    expect(filtered1.some((c) => c.id === 'view.lineNumbers')).toBe(true)

    const view2 = { ...fullExtra().view!, lineNumbers: false }
    const context2 = ctx([], undefined, undefined, undefined, undefined, { view: view2 })
    const visible2 = PALETTE_COMMANDS.filter((c) => c.when(context2))
    const filtered2 = filterPaletteItems(visible2, '숨기기')
    expect(filtered2.some((c) => c.id === 'view.lineNumbers')).toBe(false)
  })
})

describe('3.7 낱말 가드 — U7 (F-2054 11.1)', () => {
  it('댓글·알림·금고·pdf·템플·인쇄·여행·장보기·ㅋㅋㅋ 로는 F-2054 명령이 하나도 안 걸린다', () => {
    const extraOn = fullExtra()
    const extraOff = fullExtra({
      docActions: { newDoc: noop, newFolder: noop, importDoc: noop, current: { owned: true, pinned: true, openNewTab: noop, togglePin: noop, move: noop, remove: noop } },
      view: { ...fullExtra().view!, lineNumbers: false, toolbar: false, wikiPreview: false },
    })
    const commandsOn = PALETTE_COMMANDS.filter((c) => c.when(ctx([], undefined, undefined, undefined, undefined, extraOn)) && F2054_IDS.includes(c.id))
    const commandsOff = PALETTE_COMMANDS.filter((c) => c.when(ctx([], undefined, undefined, undefined, undefined, extraOff)) && F2054_IDS.includes(c.id))
    const words = ['댓글', '알림', '금고', 'pdf', '템플', '인쇄', '여행', '장보기', 'ㅋㅋㅋ']
    for (const q of words) {
      expect(filterPaletteItems(commandsOn, q), q).toEqual([])
      expect(filterPaletteItems(commandsOff, q), q).toEqual([])
    }
  })
})

describe('GitHub 명령 — F-2128 A7', () => {
  const noop = () => {}
  it('ctx.github 없음 → 셋 다 안 보임, importFile 만 → github.import 만, pull·push 주면 각각', () => {
    const ids = (github?: PaletteContext['github']) => visibleIdsOf({ ...ctx([]), github }).filter((id) => id.startsWith('github.'))
    expect(ids(undefined)).toEqual([])
    expect(ids({ importFile: noop })).toEqual(['github.import'])
    expect(ids({ importFile: noop, pull: noop })).toEqual(['github.import', 'github.pull'])
    expect(ids({ importFile: noop, push: noop })).toEqual(['github.import', 'github.push'])
  })
})

describe('GitHub 당기기 글자 — F-2129 A6', () => {
  it('github.pull 은 "이 문서 GitHub에서 당기기…", 푸시는 그대로', () => {
    expect(PALETTE_COMMANDS.find((c) => c.id === 'github.pull')?.label).toBe('이 문서 GitHub에서 당기기…')
    expect(PALETTE_COMMANDS.find((c) => c.id === 'github.push')?.label).toBe('이 문서 GitHub에 푸시…')
  })
})
