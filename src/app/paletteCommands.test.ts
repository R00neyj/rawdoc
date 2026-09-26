import { describe, expect, it } from 'vitest'
import { PALETTE_COMMANDS } from './paletteCommands'
import type { PaletteContext } from './paletteContract'
import type { TemplateEntry } from '../lib/templates'

function ctx(
  templates: readonly TemplateEntry[],
  e2ee?: PaletteContext['e2ee'],
  comments?: PaletteContext['comments'],
  notifications?: PaletteContext['notifications'],
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
  }
}

// 완화한 id 정규식(F-505 3.4, 사용자 결정 Q1) — 영역은 소문자·숫자, 동작은 소문자로 시작해 대문자·숫자·하이픈을 더 받는다
const PALETTE_ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9-]*)+$/

describe('PALETTE_COMMANDS — U3 (F-2022.md 11.1, F-404.md 9장 회귀, F-505 U24)', () => {
  it('id 가 순서대로, 겹치지 않고, 완화한 정규식을 통과한다', () => {
    const ids = PALETTE_COMMANDS.map((c) => c.id)
    expect(ids).toEqual(['template.insert', 'doc.print', 'e2ee.lock', 'e2ee.unlock', 'comment.add', 'comment.toggleRail', 'notifications.open'])
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
