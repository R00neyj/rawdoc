// F-2021 U12 (specs/features/F-2021.md 13.1, 5.4). 측정 (k) — wrangler login 과 같은 방식
import { describe, expect, it } from 'vitest'
import { browserCommandFor } from './openBrowser'

function decodeUtf16leBase64(encoded: string): string {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  let text = ''
  for (let i = 0; i < bytes.length; i += 2) text += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8))
  return text
}

describe('F-2021 U12 browserCommandFor', () => {
  it('darwin → open', () => {
    expect(browserCommandFor('darwin', 'http://127.0.0.1:1/x')).toEqual({ command: 'open', args: ['http://127.0.0.1:1/x'] })
  })

  it('linux(그 밖) → xdg-open', () => {
    expect(browserCommandFor('linux', 'http://127.0.0.1:1/x')).toEqual({ command: 'xdg-open', args: ['http://127.0.0.1:1/x'] })
  })

  it('win32 → powershell.exe + -EncodedCommand, 풀면 Start {url}', () => {
    const url = 'https://rawdoc.app/?app=1#/cli-login/1/2/3/4'
    const result = browserCommandFor('win32', url)
    expect(result.command).toBe('powershell.exe')
    expect(result.args[0]).toBe('-NoProfile')
    expect(result.args[1]).toBe('-NonInteractive')
    expect(result.args[2]).toBe('-EncodedCommand')
    const decoded = decodeUtf16leBase64(result.args[3])
    expect(decoded).toBe(`Start '${url}'`)
  })
})
