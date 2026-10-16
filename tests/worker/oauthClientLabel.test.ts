// 앱 이름·돌아갈 호스트 — 동의 화면과 연결된 앱 목록이 같이 쓴다 (specs/features/F-4010.md 2장, A9)
import { describe, expect, it } from 'vitest'
import { clientLabel } from '../../worker/oauthClientLabel'

describe('F-4010 A9 clientLabel', () => {
  it('host 는 redirectUri, 없으면 redirectUris[0] 의 URL.host (포트 포함)', () => {
    const client = { name: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback', 'https://other.example/cb'] }
    expect(clientLabel(client)).toEqual({ name: 'Claude', host: 'claude.ai' })
    expect(clientLabel(client, 'http://127.0.0.1:33418/callback')).toEqual({ name: 'Claude', host: '127.0.0.1:33418' })
    expect(clientLabel({ name: 'Cursor', redirectUris: [] }, 'cursor://anysphere.cursor-retrieval/oauth/callback').host).toBe('anysphere.cursor-retrieval')
  })

  it('주소를 못 읽거나 없으면 host 는 빈 글자', () => {
    expect(clientLabel({ name: 'A', redirectUris: ['not a url'] })).toEqual({ name: 'A', host: '' })
    expect(clientLabel({ name: 'A', redirectUris: [] })).toEqual({ name: 'A', host: '' })
    expect(clientLabel({ name: 'A', redirectUris: ['https://a.example/cb'] }, '::')).toEqual({ name: 'A', host: '' })
  })

  it('제어문자는 공백, 앞뒤 공백은 자르고, 비면 host', () => {
    expect(clientLabel({ name: '  Claude\nCode\u0000 ', redirectUris: ['https://claude.ai/cb'] }).name).toBe('Claude Code')
    expect(clientLabel({ name: '\u0007 \t\u009f', redirectUris: ['https://claude.ai/cb'] }).name).toBe('claude.ai')
    expect(clientLabel({ name: null, redirectUris: ['https://claude.ai/cb'] }).name).toBe('claude.ai')
    expect(clientLabel({ name: '', redirectUris: [] }).name).toBe('')
  })

  it('이름은 앞 64 코드포인트', () => {
    const long = '😀'.repeat(70)
    const { name } = clientLabel({ name: long, redirectUris: [] })
    expect(Array.from(name)).toHaveLength(64)
    expect(name).toBe('😀'.repeat(64))
    expect(clientLabel({ name: 'a'.repeat(64), redirectUris: [] }).name).toBe('a'.repeat(64))
  })
})
