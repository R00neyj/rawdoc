import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BOOT_PAINT_SCRIPT } from '../../../src/app/bootPaint'
import { BOOT_PAINT_SHA256, buildCsp, createCspNonce, cspHeaders, cspRevisionSource, staticHeaderLines, CSP_MODE } from '../../../src/lib/cspPolicy'

const TAIL = "frame-ancestors 'none'; report-uri /api/csp-report"
const COMMON = "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"

describe('F-4001 U1 buildCsp', () => {
  it('app', () => {
    expect(buildCsp('app', { origin: 'https://rawdoc.app' })).toBe(
      `default-src 'self'; script-src 'self' 'sha256-${BOOT_PAINT_SHA256}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' wss://rawdoc.app; ${COMMON}; ${TAIL}`,
    )
    expect(buildCsp('app', { origin: 'http://localhost:8790' })).toContain("connect-src 'self' ws://localhost:8790;")
  })
  it('landing', () => {
    expect(buildCsp('landing', { nonce: 'abc' })).toBe(
      `default-src 'self'; script-src 'self' 'nonce-abc'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; ${COMMON}; ${TAIL}`,
    )
  })
  it('login', () => {
    expect(buildCsp('login', {})).toBe(
      `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'self' https://accounts.google.com https://github.com; ${TAIL}`,
    )
  })
  it('site', () => {
    expect(buildCsp('site', {})).toBe(
      `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; ${COMMON}; ${TAIL}`,
    )
  })
})

describe('F-4001 U2 부팅 해시', () => {
  it('BOOT_PAINT_SHA256 = 스크립트 sha256 base64', () => {
    expect(BOOT_PAINT_SHA256).toBe(createHash('sha256').update(BOOT_PAINT_SCRIPT).digest('base64'))
  })
})

describe('F-4001 U3 cspHeaders', () => {
  const kinds = ['app', 'landing', 'login', 'site'] as const
  const opts = { nonce: 'n', origin: 'https://rawdoc.app' }
  it('report-only: CSP 는 frame-ancestors, Report-Only 에 정책', () => {
    for (const k of kinds) {
      const h = cspHeaders(k, 'report-only', opts)
      expect(h['Content-Security-Policy']).toBe("frame-ancestors 'none'")
      expect(h['Content-Security-Policy-Report-Only']).toBe(buildCsp(k, opts))
    }
  })
  it('enforce: CSP 에 정책, Report-Only 없음', () => {
    for (const k of kinds) {
      const h = cspHeaders(k, 'enforce', opts)
      expect(h['Content-Security-Policy']).toBe(buildCsp(k, opts))
      expect(h['Content-Security-Policy-Report-Only']).toBeUndefined()
    }
  })
  it('api 는 모드 무관', () => {
    for (const m of ['report-only', 'enforce'] as const) {
      expect(cspHeaders('api', m, {})).toEqual({ 'Content-Security-Policy': "frame-ancestors 'none'" })
    }
  })
})

describe('F-4001 U4 _headers', () => {
  it('/* 묶음 줄이 staticHeaderLines 와 같다', () => {
    const rows = readFileSync(fileURLToPath(new URL('../../../public/_headers', import.meta.url)), 'utf-8').replace(/\r\n/g, '\n').split('\n')
    const start = rows.findIndex((l) => l === '/*')
    expect(start).toBeGreaterThanOrEqual(0)
    const lines: string[] = []
    for (const l of rows.slice(start + 1)) {
      if (!l.startsWith(' ')) break
      lines.push(l.trim())
    }
    expect(lines).toEqual(staticHeaderLines(CSP_MODE))
  })
})

describe('F-4001 U5 csp-rev', () => {
  it('모드가 다르면 원천이 달라진다', () => {
    expect(cspRevisionSource()).toContain(CSP_MODE)
    expect(cspRevisionSource().replace(CSP_MODE, 'enforce')).not.toBe(cspRevisionSource())
  })
  it('nonce 는 호출마다 다르다', () => {
    expect(createCspNonce()).not.toBe(createCspNonce())
  })
})
