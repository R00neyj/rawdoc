// F-3004 U1~U6 서비스 워커 푸시 처리기 순수 규칙·파일 계약 (specs/features/F-3004.md 3장·7.1)
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  pickPushWindow,
  PUSH_BADGE_URL,
  PUSH_ICON_URL,
  pushClickUrl,
  pushNotificationSpec,
  type PushWindowCandidate,
} from '../../../src/pwa/pushSwCore'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
// 앱 tsconfig 의 node:fs 선언(src/vite-env.d.ts)은 utf-8 읽기뿐이라 바이트 읽기만 좁혀 부른다
const readBytes = readFileSync as unknown as (path: string) => Uint8Array

const DOC_ID = '0b8f2a3e-6a4c-4f7e-9d1a-2f3b4c5d6e7f'
const valid = {
  v: 1,
  title: 'a@x.com님이 멘션했습니다',
  body: '"회의록" · 이번 주 검토',
  tag: `doc:${DOC_ID}`,
  url: `/#/d/${DOC_ID}/c/t1`,
}
const ICON = '/icons/icon-192.png'
const BADGE = '/icons/badge-96.png'
const fallback = {
  title: '새 알림',
  options: { body: '', tag: 'fallback', icon: ICON, badge: BADGE, lang: 'ko', data: { url: '/' } },
}

describe('pushNotificationSpec — U1·U2·U3', () => {
  it('U1 올바른 본문은 그대로, 옵션 키는 여섯뿐', () => {
    for (const tag of [valid.tag, 'quota', 'test', `share:${DOC_ID}`]) {
      const payload = { ...valid, tag }
      expect(pushNotificationSpec(JSON.stringify(payload))).toEqual({
        title: payload.title,
        options: { body: payload.body, tag, icon: ICON, badge: BADGE, lang: 'ko', data: { url: payload.url } },
      })
    }
  })

  it('U2 풀기·모양 실패는 모두 대체 알림이고 던지지 않는다', () => {
    const inputs: (string | null)[] = [
      null,
      '',
      'not json',
      '[]',
      'null',
      JSON.stringify({ ...valid, v: 2 }),
      JSON.stringify({ ...valid, kind: 'comment' }),
      JSON.stringify({ ...valid, title: '' }),
      JSON.stringify({ ...valid, tag: 'fallback' }),
    ]
    for (const input of inputs) {
      expect(() => pushNotificationSpec(input)).not.toThrow()
      expect(pushNotificationSpec(input)).toEqual(fallback)
    }
  })

  it('U3 틀린 주소는 data.url 만 / 로 바뀐다', () => {
    for (const url of ['//evil.com', 'https://evil.com/x', '/\\evil.com']) {
      expect(pushNotificationSpec(JSON.stringify({ ...valid, url }))).toEqual({
        title: valid.title,
        options: { body: valid.body, tag: valid.tag, icon: ICON, badge: BADGE, lang: 'ko', data: { url: '/' } },
      })
    }
  })
})

describe('pushClickUrl — U4', () => {
  it('올바른 주소는 그대로', () => {
    expect(pushClickUrl({ url: '/#/d/a/c/b' })).toBe('/#/d/a/c/b')
  })

  it('객체가 아니거나 url 이 틀리면 /', () => {
    for (const data of [null, undefined, {}, { url: 5 }, { url: '//evil.com' }, '/#/d/a']) {
      expect(pushClickUrl(data)).toBe('/')
    }
  })
})

describe('pickPushWindow — U5', () => {
  const ORIGIN = 'https://rawdoc.test'
  const win = (url: string, focused: boolean, visibilityState: string): PushWindowCandidate => ({ url, focused, visibilityState })

  it('① 빈 목록 → null', () => {
    expect(pickPushWindow([], ORIGIN)).toBeNull()
  })

  it('② 앱이 아닌 같은 출처 페이지·다른 출처·틀린 주소만 → null', () => {
    const list = [
      win(`${ORIGIN}/welcome`, true, 'visible'),
      win(`${ORIGIN}/guides/x`, false, 'visible'),
      win(`${ORIGIN}/sw.js`, false, 'visible'),
      win('https://other.test/', true, 'visible'),
      win('not a url', true, 'visible'),
    ]
    expect(pickPushWindow(list, ORIGIN)).toBeNull()
  })

  it('③ 포커스된 앱 창이 먼저', () => {
    const list = [win(`${ORIGIN}/`, false, 'visible'), win(`${ORIGIN}/`, true, 'hidden')]
    expect(pickPushWindow(list, ORIGIN)).toBe(list[1])
  })

  it('④ 포커스가 없으면 보이는 앱 창', () => {
    const list = [win(`${ORIGIN}/`, false, 'hidden'), win(`${ORIGIN}/`, false, 'visible')]
    expect(pickPushWindow(list, ORIGIN)).toBe(list[1])
  })

  it('⑤ 모두 숨었으면 목록 순서', () => {
    const list = [win(`${ORIGIN}/#/d/a`, false, 'hidden'), win(`${ORIGIN}/#/d/b`, false, 'hidden')]
    expect(pickPushWindow(list, ORIGIN)).toBe(list[0])
  })

  it('⑥ 포커스된 /guides 보다 숨은 앱 창', () => {
    const list = [win(`${ORIGIN}/guides`, true, 'visible'), win(`${ORIGIN}/`, false, 'hidden')]
    expect(pickPushWindow(list, ORIGIN)).toBe(list[1])
  })

  it('⑦ 쿼리·해시가 붙어도 앱 창', () => {
    const list = [win(`${ORIGIN}/?app=1#/d/x`, false, 'hidden')]
    expect(pickPushWindow(list, ORIGIN)).toBe(list[0])
  })
})

describe('파일 계약 — U6', () => {
  const isFile = (path: string) => {
    try {
      return !statSync(path).isDirectory()
    } catch {
      return false
    }
  }

  it('① 아이콘·배지 파일이 있다', () => {
    expect(PUSH_ICON_URL).toBe(ICON)
    expect(PUSH_BADGE_URL).toBe(BADGE)
    expect(isFile(join(ROOT, 'public', PUSH_ICON_URL))).toBe(true)
    expect(isFile(join(ROOT, 'public', PUSH_BADGE_URL))).toBe(true)
  })

  it('② 배지는 96×96 8비트 RGBA PNG', () => {
    const png = readBytes(join(ROOT, 'public', PUSH_BADGE_URL))
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR')
    expect(view.getUint32(16)).toBe(96)
    expect(view.getUint32(20)).toBe(96)
    expect(png[24]).toBe(8)
    expect(png[25]).toBe(6)
  })

  it('③ _headers 의 /push-sw.js 덩어리가 /assets/* 앞에서 no-cache', () => {
    const lines = readFileSync(join(ROOT, 'public', '_headers'), 'utf-8').split(/\r?\n/)
    const assetsAt = lines.findIndex((line) => line.trim() === '/assets/*')
    const pushAt = lines.findIndex((line) => line.trim() === '/push-sw.js')
    expect(pushAt).toBeGreaterThanOrEqual(0)
    expect(pushAt).toBeLessThan(assetsAt)
    const block: string[] = []
    for (const line of lines.slice(pushAt + 1)) {
      if (!/^\s/.test(line) || !line.trim()) break
      block.push(line.trim())
    }
    expect(block).toContain('Cache-Control: no-cache')
  })

  it('④ pushSwCore.ts 는 ../lib/pushPayload 하나만 import 한다', () => {
    const source = readFileSync(join(ROOT, 'src', 'pwa', 'pushSwCore.ts'), 'utf-8')
    const froms = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    const bare = [...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
    expect([...froms, ...bare]).toEqual(['../lib/pushPayload'])
  })
})
