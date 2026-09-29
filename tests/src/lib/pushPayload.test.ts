// F-3002 P1~P4 푸시 본문 모양 검사·주소 검사·직렬화·대체 알림 (specs/features/F-3002.md 4장·6.2)
import { describe, expect, it } from 'vitest'
import {
  encodePushPayload,
  FALLBACK_NOTIFICATION,
  PUSH_PAYLOAD_MAX_BYTES,
  readPushPayload,
  safePushUrl,
  type PushPayload,
} from '../../../src/lib/pushPayload'

const DOC_ID = '0b8f2a3e-6a4c-4f7e-9d1a-2f3b4c5d6e7f'
const valid: PushPayload = {
  v: 1,
  title: 'a@x.com님이 멘션했습니다',
  body: '"회의록" · 이번 주 검토',
  tag: `doc:${DOC_ID}`,
  url: `/#/d/${DOC_ID}/c/t1`,
}

describe('readPushPayload — P1', () => {
  it('올바른 다섯 키는 같은 값', () => {
    expect(readPushPayload({ ...valid })).toEqual(valid)
    expect(readPushPayload({ ...valid, tag: 'quota' })).toEqual({ ...valid, tag: 'quota' })
    expect(readPushPayload({ ...valid, tag: 'test' })).toEqual({ ...valid, tag: 'test' })
    expect(readPushPayload({ ...valid, tag: `share:${DOC_ID}` })).toEqual({ ...valid, tag: `share:${DOC_ID}` })
  })

  it('모양이 틀리면 null', () => {
    const { url: _url, ...missing } = valid
    const bad: unknown[] = [
      { ...valid, kind: 'mention' },
      missing,
      { ...valid, v: 2 },
      { ...valid, title: '' },
      { ...valid, body: 3 },
      { ...valid, tag: 'doc:' },
      { ...valid, tag: 'doc:a b' },
      { ...valid, tag: 'fallback' },
      [valid],
      null,
    ]
    for (const input of bad) expect(readPushPayload(input)).toBeNull()
  })

  it('틀린 url 은 버리지 않고 / 로 바꾼다', () => {
    expect(readPushPayload({ ...valid, url: '//evil.com' })).toEqual({ ...valid, url: '/' })
  })
})

describe('safePushUrl — P2', () => {
  it('같은 출처의 / 경로만 그대로', () => {
    expect(safePushUrl('/#/d/abc/c/def')).toBe('/#/d/abc/c/def')
    expect(safePushUrl('/')).toBe('/')
    expect(safePushUrl('/%2F%2Fevil.com')).toBe('/%2F%2Fevil.com')
  })

  it('다른 출처로 풀리는 입력은 /', () => {
    const backslash = '/' + String.fromCharCode(92) + 'evil.com'
    for (const u of ['//evil.com', backslash, '/\t/evil.com', 'https://evil.com', 'javascript:alert(1)', ' /a']) {
      expect(safePushUrl(u)).toBe('/')
    }
    expect(safePushUrl(3)).toBe('/')
    expect(safePushUrl(undefined)).toBe('/')
  })
})

describe('encodePushPayload — P3', () => {
  const enc = new TextEncoder()
  const dec = new TextDecoder()

  it('흔한 본문은 JSON.stringify 의 UTF-8 과 같다', () => {
    const out = encodePushPayload(valid)
    expect(out).not.toBeNull()
    expect(Array.from(out!)).toEqual(Array.from(enc.encode(JSON.stringify(valid))))
  })

  it('3,000 B 를 넘으면 body 만 가장 긴 머리 + … 로 줄인다', () => {
    const body = '가'.repeat(1200)
    const payload: PushPayload = { ...valid, body }
    expect(enc.encode(JSON.stringify(payload)).length).toBeGreaterThan(PUSH_PAYLOAD_MAX_BYTES)
    const out = encodePushPayload(payload)
    expect(out).not.toBeNull()
    expect(out!.length).toBeLessThanOrEqual(PUSH_PAYLOAD_MAX_BYTES)
    const decoded = JSON.parse(dec.decode(out!)) as PushPayload
    expect({ ...decoded, body: '' }).toEqual({ ...payload, body: '' })
    expect(decoded.body.endsWith('…')).toBe(true)
    const head = decoded.body.slice(0, -1)
    expect(body.startsWith(head)).toBe(true)
    const oneMore = { ...payload, body: body.slice(0, head.length + 1) + '…' }
    expect(enc.encode(JSON.stringify(oneMore)).length).toBeGreaterThan(PUSH_PAYLOAD_MAX_BYTES)
  })

  it('body 를 비워도 넘으면 null', () => {
    expect(encodePushPayload({ ...valid, title: 'a'.repeat(3001) })).toBeNull()
  })
})

describe('FALLBACK_NOTIFICATION — P4', () => {
  it('대체 알림 값', () => {
    expect(FALLBACK_NOTIFICATION).toEqual({ title: '새 알림', body: '', tag: 'fallback', url: '/' })
  })
})
