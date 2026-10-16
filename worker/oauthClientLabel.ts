// 앱 이름·돌아갈 호스트 — 동의 화면과 연결된 앱 목록이 같이 쓴다 (specs/features/F-4010.md 2장)
const NAME_MAX_CODE_POINTS = 64

export function clientLabel(client: { name: string | null; redirectUris: string[] }, redirectUri?: string): { name: string; host: string } {
  let host = ''
  try {
    host = new URL(redirectUri ?? client.redirectUris[0] ?? '').host
  } catch {
    host = ''
  }
  const cleaned = (client.name ?? '').replace(/\p{Cc}/gu, ' ').trim()
  const name = Array.from(cleaned).slice(0, NAME_MAX_CODE_POINTS).join('')
  return { name: name || host, host }
}
