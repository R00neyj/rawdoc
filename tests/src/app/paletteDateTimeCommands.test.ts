import { afterEach, describe, expect, it, vi } from 'vitest'
import { PALETTE_DATETIME_COMMANDS, dateTimeText } from '../../../src/app/paletteDateTimeCommands'
import { PALETTE_COMMANDS } from '../../../src/app/paletteCommands'
import { filterPaletteItems, type PaletteContext } from '../../../src/app/paletteContract'
import { expandTemplateVariables } from '../../../src/lib/templates'

const PALETTE_ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9-]*)+$/

function baseCtx(dateTime?: PaletteContext['dateTime']): PaletteContext {
  return { canInsertTemplate: true, canPrint: true, templates: [], insertTemplate: async () => {}, printDoc: () => {}, dateTime }
}

afterEach(() => vi.useRealTimers())

describe('PALETTE_DATETIME_COMMANDS — U1', () => {
  it('모양·라벨·keywords·when', () => {
    expect(PALETTE_DATETIME_COMMANDS.map((c) => c.id)).toEqual(['insert.date', 'insert.time'])
    for (const c of PALETTE_DATETIME_COMMANDS) {
      expect(c.kind).toBe('action')
      expect(c.shortcut).toBeUndefined()
      expect(PALETTE_ID_RE.test(c.id)).toBe(true)
    }
    const [d, t] = PALETTE_DATETIME_COMMANDS
    expect(d.label).toBe('오늘 날짜 넣기')
    expect(d.keywords).toEqual(['날짜', '오늘', 'date', 'today', '일자', '삽입'])
    expect(t.label).toBe('지금 시각 넣기')
    expect(t.keywords).toEqual(['시각', '시간', '지금', 'time', 'now', '현재', '타임스탬프', 'timestamp', '삽입'])
    expect(PALETTE_DATETIME_COMMANDS.every((c) => c.when(baseCtx()) === false)).toBe(true)
    expect(PALETTE_DATETIME_COMMANDS.every((c) => c.when(baseCtx({ insert: () => {} })) === true)).toBe(true)
  })
})

describe('실행·형식 — U2', () => {
  it('run 이 실행 순간 값을 넘긴다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 23, 9, 5, 7))
    const insert = vi.fn()
    const ctx = baseCtx({ insert })
    PALETTE_DATETIME_COMMANDS[0].run(ctx)
    PALETTE_DATETIME_COMMANDS[1].run(ctx)
    expect(insert.mock.calls).toEqual([['2026-09-23'], ['09:05']])
  })

  it('경계값과 틀 {{date}}·{{time}} 과 같은 형식', () => {
    expect(dateTimeText('time', new Date(2026, 0, 5, 0, 0, 59))).toBe('00:00')
    expect(dateTimeText('date', new Date(2026, 0, 5, 0, 0, 59))).toBe('2026-01-05')
    expect(dateTimeText('time', new Date(2026, 0, 5, 23, 59))).toBe('23:59')
    const now = new Date(2026, 8, 23, 9, 5, 7)
    expect(expandTemplateVariables('{{date}}|{{time}}', { title: '', now })).toBe(`${dateTimeText('date', now)}|${dateTimeText('time', now)}`)
  })
})

describe('기존 검색어와 안 부딪힌다 — U3', () => {
  const OLD = ['설정', '도움말', '새 문서', '삭제', '원문', '마크다운 복사', '새 폴더', '볼드', '제목 2', '표', '모드', '테마', '다크', '인쇄', '알림', '알림 열기', '댓글', '댓글 달기', '댓글 닫기', '단축키', '템플', '회의', '금고', '금고 잠그기', '.md 가져오기', '.md 내보내기', '여행', '장보기 목록', '주간 보고', '주간 회고', '버그', '노트 틀', '업무', '개인', 'pdf', 'print', 'template', 'ㅋㅋㅋ', 'ㅌㅍㄹ', '템ㅍ', 'ㅅㅁㅅ', 'ㅂㄷㅊ', 'ㅈㅁ 2', '굵게', 'lock', 'unlock', 'comment', 'shortcut', 'notification', '메모', '일일', '없는이름', '업무/주간 보고', '서식', '단락', '블럭', '코드']
  const ctx: PaletteContext = { ...baseCtx({ insert: () => {} }) }
  const ids = (q: string) => filterPaletteItems(PALETTE_COMMANDS.filter((c) => c.when(ctx)), q).map((i) => i.id)

  it('기존 검색어 결과에 insert. 가 없다', () => {
    for (const q of OLD) expect(ids(q).filter((id) => id.startsWith('insert.')), q).toEqual([])
  })
  it('날짜·시각 검색어', () => {
    for (const q of ['날짜', '오늘', 'date', 'today', 'ㄴㅉ']) expect(ids(q)[0], q).toBe('insert.date')
    for (const q of ['시각', '시간', 'time', 'now', '지금']) expect(ids(q)[0], q).toBe('insert.time')
  })
})
