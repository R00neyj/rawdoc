// 저장 위치 계산·읽기·쓰기 (specs/features/F-2021.md 5.6)
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type StoredCredentialEntry = { token: string; email: string; savedAt: string }
export type StoredCredentials = { version: 1; servers: Record<string, StoredCredentialEntry> }

export type PathEnv = { platform: string; env: Record<string, string | undefined>; homedir: string }

// 디렉터리 이름은 'md-editor' — 제품명과 무관하게 고정(불변조건, 5.6)
export function credentialsPath(env: PathEnv): string {
  if (env.platform === 'win32') {
    const appData = env.env.APPDATA || join(env.homedir, 'AppData', 'Roaming')
    return join(appData, 'md-editor', 'credentials.json')
  }
  const configHome = env.env.XDG_CONFIG_HOME || join(env.homedir, '.config')
  return join(configHome, 'md-editor', 'credentials.json')
}

function emptyStore(): StoredCredentials {
  return { version: 1, servers: {} }
}

// 모르는 version·깨진 JSON 이면 빈 것으로 본다 — corrupt 가 true 면 호출부가 안내를 낸다
export async function readCredentials(path: string): Promise<{ store: StoredCredentials; corrupt: boolean }> {
  let text: string
  try {
    text = await readFile(path, 'utf-8')
  } catch {
    return { store: emptyStore(), corrupt: false }
  }
  try {
    const parsed = JSON.parse(text) as Partial<StoredCredentials>
    if (parsed && parsed.version === 1 && typeof parsed.servers === 'object' && parsed.servers !== null) {
      return { store: parsed as StoredCredentials, corrupt: false }
    }
    return { store: emptyStore(), corrupt: true }
  } catch {
    return { store: emptyStore(), corrupt: true }
  }
}

// 디렉터리 0o700, 파일 0o600, 같은 디렉터리의 임시 파일에 쓰고 rename 으로 바꾼다 (5.6)
export async function writeCredentials(path: string, store: StoredCredentials): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const tmpPath = `${path}.tmp`
  await writeFile(tmpPath, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 })
  try {
    await chmod(tmpPath, 0o600)
  } catch {
    // Windows 는 모드가 적용되지 않는다 — 사용자 프로필 ACL 에 기댄다 (측정 (h))
  }
  await rename(tmpPath, path)
}

export function withServerToken(
  store: StoredCredentials,
  origin: string,
  entry: StoredCredentialEntry,
): StoredCredentials {
  return { ...store, servers: { ...store.servers, [origin]: entry } }
}

export function withoutServerToken(store: StoredCredentials, origin: string): { store: StoredCredentials; removed: boolean } {
  if (!(origin in store.servers)) return { store, removed: false }
  const servers = { ...store.servers }
  delete servers[origin]
  return { store: { ...store, servers }, removed: true }
}

export function getServerToken(store: StoredCredentials, origin: string): string | null {
  return store.servers[origin]?.token ?? null
}
