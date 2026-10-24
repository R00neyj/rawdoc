import { describe, expect, it } from 'vitest'
import { launchOpenFailNotice, localFileOpenSettingVisible, parseLocalFileOpenMode, planLaunch } from '../../../../src/app/localFile/localFileOpen'

describe('F-2156 parseLocalFileOpenMode (A1)', () => {
  it("'edit' 만 edit, 나머지는 import", () => {
    expect(parseLocalFileOpenMode('edit')).toBe('edit')
    for (const raw of ['import', null, undefined, '', 'EDIT', 'foo']) expect(parseLocalFileOpenMode(raw)).toBe('import')
  })
})

describe('F-2156 localFileOpenSettingVisible (A2)', () => {
  const picker = () => {}
  it('launchQueue 와 함수 picker 가 둘 다 있을 때만 참', () => {
    expect(localFileOpenSettingVisible({ launchQueue: {}, showOpenFilePicker: picker })).toBe(true)
    expect(localFileOpenSettingVisible({ launchQueue: {} })).toBe(false)
    expect(localFileOpenSettingVisible({ showOpenFilePicker: picker })).toBe(false)
    expect(localFileOpenSettingVisible({})).toBe(false)
    expect(localFileOpenSettingVisible({ launchQueue: {}, showOpenFilePicker: true })).toBe(false)
  })
})

describe('F-2156 planLaunch (A3)', () => {
  it('import 는 개수 무관 import', () => {
    expect(planLaunch('import', ['a.md'])).toEqual({ kind: 'import' })
    expect(planLaunch('import', ['a.md', 'b.md', 'c.md'])).toEqual({ kind: 'import' })
  })
  it('edit 1개는 index 0·알림 없음', () => {
    expect(planLaunch('edit', ['a.md'])).toEqual({ kind: 'edit', index: 0, notice: null })
  })
  it('edit 3개는 마지막·알림', () => {
    expect(planLaunch('edit', ['a.md', 'b.md', 'c.md'])).toEqual({
      kind: 'edit',
      index: 2,
      notice: '파일은 한 번에 하나만 고칠 수 있어 "c.md" 만 열었습니다.',
    })
  })
})

describe('F-2156 launchOpenFailNotice (A4)', () => {
  it('missing 만 문구, 나머지 null', () => {
    expect(launchOpenFailNotice('missing', 'a.md')).toBe('"a.md" 을(를) 열지 못했습니다.')
    for (const r of ['not-utf8', 'error', 'opened', 'same'] as const) expect(launchOpenFailNotice(r, 'a.md')).toBeNull()
  })
})
