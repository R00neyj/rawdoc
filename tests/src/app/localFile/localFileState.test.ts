// F-2155 A2 — 로컬 파일 저장 상태 전이·hasUnwritten·문구·localFileTitle
import { describe, expect, it } from 'vitest'
import {
  hasUnwritten,
  initialLocalSave,
  LOCAL_SAVE_DEBOUNCE_MS,
  LOCAL_SAVE_TEXT,
  localFileTitle,
  localSaveDot,
  nextLocalSave,
  type LocalSaveEvent,
  type LocalSaveState,
} from '../../../../src/app/localFile/localFileState'

const permissionError = new DOMException('denied', 'NotAllowedError')
const ioError = new DOMException('disk', 'InvalidStateError')

function run(start: LocalSaveState, events: LocalSaveEvent[]) {
  let state = start
  let notices = 0
  for (const event of events) {
    const next = nextLocalSave(state, event)
    state = next.state
    if (next.notifyError) notices++
  }
  return { state, notices }
}

describe('F-2155 U2 처음 상태', () => {
  it('쓰기 권한이 있으면 saved, 없으면 permission', () => {
    expect(initialLocalSave(true)).toEqual({ status: 'saved', dirty: false, writing: false, canWrite: true })
    expect(initialLocalSave(false)).toEqual({ status: 'permission', dirty: false, writing: false, canWrite: false })
  })

  it('자동 저장은 마지막 입력 뒤 1,000ms', () => {
    expect(LOCAL_SAVE_DEBOUNCE_MS).toBe(1000)
  })
})

describe('F-2155 U2 상태 전이', () => {
  it('입력 → dirty, 쓰기 시작·성공 → saved', () => {
    const typed = run(initialLocalSave(true), [{ type: 'input' }]).state
    expect(typed).toMatchObject({ status: 'dirty', dirty: true })
    const started = run(typed, [{ type: 'write-start' }]).state
    expect(started).toMatchObject({ status: 'dirty', dirty: false, writing: true })
    expect(run(started, [{ type: 'write-ok' }]).state).toEqual({ status: 'saved', dirty: false, writing: false, canWrite: true })
  })

  it('쓰는 동안 또 입력하면 성공해도 dirty 로 남는다', () => {
    const { state } = run(initialLocalSave(true), [{ type: 'input' }, { type: 'write-start' }, { type: 'input' }, { type: 'write-ok' }])
    expect(state).toMatchObject({ status: 'dirty', dirty: true, writing: false })
  })

  it('NotAllowedError·SecurityError → 권한 잃음, permission, 알림 없음', () => {
    for (const error of [permissionError, new DOMException('x', 'SecurityError')]) {
      const { state, notices } = run(initialLocalSave(true), [{ type: 'input' }, { type: 'write-start' }, { type: 'write-fail', error }])
      expect(state).toEqual({ status: 'permission', dirty: true, writing: false, canWrite: false })
      expect(notices).toBe(0)
    }
  })

  it('그 밖 실패 → error, 알림은 error 로 들어갈 때 한 번만', () => {
    const { state, notices } = run(initialLocalSave(true), [
      { type: 'input' }, { type: 'write-start' }, { type: 'write-fail', error: ioError },
      { type: 'input' }, { type: 'write-start' }, { type: 'write-fail', error: ioError },
    ])
    expect(state).toEqual({ status: 'error', dirty: true, writing: false, canWrite: true })
    expect(notices).toBe(1)
  })

  it('error 중 입력해도 error 표시가 남고, 다음 성공에서 saved 로 돌아온 뒤 다시 실패하면 또 알린다', () => {
    const failed = run(initialLocalSave(true), [{ type: 'input' }, { type: 'write-start' }, { type: 'write-fail', error: ioError }]).state
    expect(run(failed, [{ type: 'input' }]).state.status).toBe('error')
    const { state, notices } = run(failed, [
      { type: 'input' }, { type: 'write-start' }, { type: 'write-ok' },
      { type: 'input' }, { type: 'write-start' }, { type: 'write-fail', error: ioError },
    ])
    expect(state.status).toBe('error')
    expect(notices).toBe(1)
  })

  it('권한 없을 때 입력 → permission 그대로 dirty', () => {
    expect(run(initialLocalSave(false), [{ type: 'input' }]).state).toEqual({ status: 'permission', dirty: true, writing: false, canWrite: false })
  })

  it('권한 얻음 → 남은 변경이 있으면 dirty, 없으면 saved', () => {
    expect(run(initialLocalSave(false), [{ type: 'input' }, { type: 'permission', granted: true }]).state)
      .toEqual({ status: 'dirty', dirty: true, writing: false, canWrite: true })
    expect(run(initialLocalSave(false), [{ type: 'permission', granted: true }]).state.status).toBe('saved')
    expect(run(initialLocalSave(false), [{ type: 'permission', granted: false }]).state.status).toBe('permission')
  })

  it('쓰기 전 훅이 건너뛰면 dirty 를 남긴다', () => {
    expect(run(initialLocalSave(true), [{ type: 'input' }, { type: 'write-skip' }]).state).toMatchObject({ status: 'dirty', dirty: true, writing: false })
  })

  it('remount → dirty 버리고 권한에 맞는 처음 상태', () => {
    const failed = run(initialLocalSave(true), [{ type: 'input' }, { type: 'write-start' }, { type: 'write-fail', error: ioError }]).state
    expect(run(failed, [{ type: 'reset', canWrite: true }]).state).toEqual(initialLocalSave(true))
    expect(run(failed, [{ type: 'reset', canWrite: false }]).state).toEqual(initialLocalSave(false))
  })
})

describe('F-2155 U2 hasUnwritten', () => {
  it('dirty 이거나 쓰는 중이면 참', () => {
    expect(hasUnwritten(initialLocalSave(true))).toBe(false)
    expect(hasUnwritten({ ...initialLocalSave(true), dirty: true })).toBe(true)
    expect(hasUnwritten({ ...initialLocalSave(true), writing: true })).toBe(true)
    expect(hasUnwritten({ ...initialLocalSave(false), dirty: true })).toBe(true)
  })
})

describe('F-2155 U2 문구·점', () => {
  it('상태 넷의 글자', () => {
    expect(LOCAL_SAVE_TEXT).toEqual({ saved: '파일에 저장됨', dirty: '입력 중…', error: '저장 실패', permission: '저장 권한 필요' })
  })

  it('점 — permission 은 error 점', () => {
    expect(localSaveDot('saved')).toBe('saved')
    expect(localSaveDot('dirty')).toBe('dirty')
    expect(localSaveDot('error')).toBe('error')
    expect(localSaveDot('permission')).toBe('error')
  })

  it('localFileTitle 은 끝 .md 만 뗀다', () => {
    expect(localFileTitle('메모.md')).toBe('메모')
    expect(localFileTitle('회의.MD')).toBe('회의')
    expect(localFileTitle('a.md.md')).toBe('a.md')
    expect(localFileTitle('노트.markdown')).toBe('노트.markdown')
    expect(localFileTitle('.md')).toBe('.md')
  })
})
