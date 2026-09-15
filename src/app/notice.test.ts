import { describe, it, expect } from 'vitest'
import { pushNotice, type Notice } from './notice'

describe('pushNotice', () => {
  it('현재가 없으면 새 알림을 그대로 쓴다', () => {
    const next: Notice = { type: 'info', message: 'hi' }
    expect(pushNotice(null, next)).toBe(next)
  })

  it('info 는 새 info 로 대체된다', () => {
    const next: Notice = { type: 'info', message: 'new' }
    expect(pushNotice({ type: 'info', message: 'old' }, next)).toBe(next)
  })

  it('error 는 새 info 로 대체되지 않는다', () => {
    const current: Notice = { type: 'error', message: 'err' }
    expect(pushNotice(current, { type: 'info', message: 'new' })).toBe(current)
  })

  it('update 는 새 info 로 대체되지 않는다', () => {
    const current: Notice = { type: 'update', message: 'upd' }
    expect(pushNotice(current, { type: 'info', message: 'new' })).toBe(current)
  })

  it('error 는 새 error 로 대체된다', () => {
    const next: Notice = { type: 'error', message: 'new-err' }
    expect(pushNotice({ type: 'error', message: 'old' }, next)).toBe(next)
  })

  it('info 는 새 error 로 대체된다', () => {
    const next: Notice = { type: 'error', message: 'err' }
    expect(pushNotice({ type: 'info', message: 'old' }, next)).toBe(next)
  })

  it('error 는 새 update 로 대체된다', () => {
    const next: Notice = { type: 'update', message: 'upd' }
    expect(pushNotice({ type: 'error', message: 'old' }, next)).toBe(next)
  })

  it('warn 은 새 info 로 대체되지 않는다', () => {
    const current: Notice = { type: 'warn', message: 'warn' }
    expect(pushNotice(current, { type: 'info', message: 'new' })).toBe(current)
  })

  it('warn 은 새 error 로 대체된다', () => {
    const next: Notice = { type: 'error', message: 'err' }
    expect(pushNotice({ type: 'warn', message: 'old' }, next)).toBe(next)
  })

  it('warn 은 새 update 로 대체된다', () => {
    const next: Notice = { type: 'update', message: 'upd' }
    expect(pushNotice({ type: 'warn', message: 'old' }, next)).toBe(next)
  })

  it('info 는 새 warn 으로 대체된다', () => {
    const next: Notice = { type: 'warn', message: 'warn' }
    expect(pushNotice({ type: 'info', message: 'old' }, next)).toBe(next)
  })
})
