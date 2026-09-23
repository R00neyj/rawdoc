// OS 별 브라우저 열기 명령 (specs/features/F-2021.md 5.4)
import { spawn } from 'node:child_process'

export type BrowserCommand = { command: string; args: string[] }

// Buffer 를 쓰지 않고 직접 UTF-16LE → base64 로 인코딩한다(ASCII 만 쓰는 주소라 서로게이트 쌍이 없다)
function utf16leBase64(text: string): string {
  const bytes = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes[i * 2] = code & 0xff
    bytes[i * 2 + 1] = (code >> 8) & 0xff
  }
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

// 인증 화면 주소는 [A-Za-z0-9._~:/?#=-] 문자만 쓴다(6.1) — 셸 해석이 끼어들 문자가 없다
export function browserCommandFor(platform: string, url: string): BrowserCommand {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') {
    const encoded = utf16leBase64(`Start '${url}'`)
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded] }
  }
  return { command: 'xdg-open', args: [url] }
}

// 실행 실패(ENOENT·0 아닌 종료)는 무시한다 — 주소는 이미 안내에 찍혔다 (5.4)
export function openBrowser(platform: string, url: string): void {
  const { command, args } = browserCommandFor(platform, url)
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => {
      // 무시 — 안내 문구에 이미 주소가 찍혔다
    })
    child.unref()
  } catch {
    // 무시
  }
}
