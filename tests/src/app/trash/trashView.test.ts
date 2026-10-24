import { describe, it, expect } from 'vitest'
import type { TrashItem } from '../../../../src/lib/trash/trash'
import {
  DELETE_TRASH_TEXT, emptiedNotice, emptyConfirm, purgeOneConfirm, purgeOneNotice, restoreNotice, TRASH_HEAD_NOTE, TRASH_HEAD_NOTE_LOCAL, trashItemTitle, trashRowMeta,
} from '../../../../src/app/trash/trashView'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 9, 16, 15, 0, 0).getTime()
const at = (daysAgo: number, hour = 9) => new Date(2026, 9, 16 - daysAgo, hour, 0, 0).getTime()

function item(over: Partial<TrashItem> = {}): TrashItem {
  const deletedAt = over.deletedAt ?? at(0)
  return { id: 'a', title: '문서', deletedAt, deletedBy: 'app', path: 'A/B', purgeAt: deletedAt + 30 * DAY, ...over }
}

describe('F-2145 U1 trashRowMeta ① 경로', () => {
  it('경로가 있으면 그대로, 없으면 (최상위)', () => {
    expect(trashRowMeta(item(), NOW).split(' · ')[0]).toBe('A/B')
    expect(trashRowMeta(item({ path: null }), NOW).split(' · ')[0]).toBe('(최상위)')
  })
})

describe('F-2145 U2 trashRowMeta ② 지운 때', () => {
  it('같은 날 오늘·하루 전 어제·그 밖 n일 전(로컬 날짜 차)', () => {
    expect(trashRowMeta(item({ deletedAt: at(0, 0) }), NOW).split(' · ')[1]).toBe('오늘')
    expect(trashRowMeta(item({ deletedAt: at(1, 23) }), NOW).split(' · ')[1]).toBe('어제')
    expect(trashRowMeta(item({ deletedAt: at(5) }), NOW).split(' · ')[1]).toBe('5일 전')
  })
})

describe('F-2145 U3 trashRowMeta ③ 남은 날', () => {
  it('ceil 로 세고 1 미만이면 곧 지워짐', () => {
    expect(trashRowMeta(item({ purgeAt: NOW + 30 * DAY }), NOW).split(' · ')[2]).toBe('30일 남음')
    expect(trashRowMeta(item({ purgeAt: NOW + 29 * DAY + 1 }), NOW).split(' · ')[2]).toBe('30일 남음')
    expect(trashRowMeta(item({ purgeAt: NOW + 1 }), NOW).split(' · ')[2]).toBe('1일 남음')
    expect(trashRowMeta(item({ purgeAt: NOW }), NOW).split(' · ')[2]).toBe('곧 지워짐')
    expect(trashRowMeta(item({ purgeAt: NOW - DAY }), NOW).split(' · ')[2]).toBe('곧 지워짐')
  })
})

describe('F-2145 U4 trashRowMeta ④ 지운 주체', () => {
  const actorPart = (deletedBy: string) => trashRowMeta(item({ deletedBy: deletedBy as TrashItem['deletedBy'] }), NOW).split(' · ')[3]
  it('app·cli·mcp 이름·빈 mcp·모르는 값', () => {
    expect(actorPart('app')).toBe('앱에서 지움')
    expect(actorPart('cli')).toBe('CLI에서 지움')
    expect(actorPart('mcp:Claude')).toBe('Claude에서 지움')
    expect(actorPart('mcp:')).toBe('연결된 앱에서 지움')
    expect(actorPart('web')).toBeUndefined()
  })
})

describe('로컬 휴지통 행·머리 (small 2026-10-16)', () => {
  it('지운 주체가 없으면 경로·지운 때·남은 날 셋만', () => {
    expect(trashRowMeta(item({ deletedBy: undefined }), NOW)).toBe('A/B · 오늘 · 30일 남음')
  })
  it('머리 안내는 이 브라우저에 저장된 문서를 앞에 붙인다', () => {
    expect(TRASH_HEAD_NOTE_LOCAL).toBe(`이 브라우저에 저장된 문서 · ${TRASH_HEAD_NOTE}`)
    expect(TRASH_HEAD_NOTE_LOCAL).toBe('이 브라우저에 저장된 문서 · 30일이 지나면 영구히 지워집니다.')
  })
})

describe('F-2145 U5 알림·확인 문구', () => {
  it('복원 둘·영구 삭제·비우기', () => {
    expect(restoreNotice('메모', false)).toBe('"메모" 을(를) 복원했습니다.')
    expect(restoreNotice('메모', true)).toBe('"메모" 을(를) 최상위로 복원했습니다. 원래 폴더가 없습니다.')
    expect(purgeOneNotice('메모')).toBe('"메모" 을(를) 영구히 지웠습니다.')
    expect(emptiedNotice(3)).toBe('문서 3개를 영구히 지웠습니다.')
  })
  it('D-24 확인 둘', () => {
    expect(purgeOneConfirm('메모')).toEqual({ title: '영구 삭제', message: '"메모" 을(를) 영구히 지울까요? 되돌릴 수 없습니다.', confirmLabel: '영구 삭제' })
    expect(emptyConfirm(4)).toEqual({ title: '휴지통 비우기', message: '휴지통의 문서 4개를 모두 영구히 지울까요? 되돌릴 수 없습니다.', confirmLabel: '비우기' })
  })
  it('금고 문서 제목·빈 제목', () => {
    expect(trashItemTitle(item({ title: '', e2ee: true }))).toBe('금고 문서')
    expect(trashItemTitle(item({ title: '  ' }))).toBe('제목 없는 문서')
  })
  it('지우기 문구 셋', () => {
    expect(DELETE_TRASH_TEXT.doc('메모')).toBe('"메모" 을(를) 휴지통으로 옮길까요? 30일 뒤 영구히 지워집니다.')
    expect(DELETE_TRASH_TEXT.bulk(3)).toBe('선택한 3개 항목을 삭제할까요? 문서는 휴지통으로 옮겨지고 30일 뒤 영구히 지워집니다.')
  })
})
