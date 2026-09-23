// F-2021 U3 (specs/features/F-2021.md 13.1, 5.6)
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  credentialsPath,
  getServerToken,
  readCredentials,
  withoutServerToken,
  withServerToken,
  writeCredentials,
} from './credentials'

describe('F-2021 U3 credentialsPath', () => {
  it('win32 + APPDATA', () => {
    const path = credentialsPath({ platform: 'win32', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, homedir: 'C:\\Users\\a' })
    expect(path).toBe(join('C:\\Users\\a\\AppData\\Roaming', 'md-editor', 'credentials.json'))
  })

  it('win32, APPDATA 없음', () => {
    const path = credentialsPath({ platform: 'win32', env: {}, homedir: 'C:\\Users\\a' })
    expect(path).toBe(join('C:\\Users\\a', 'AppData', 'Roaming', 'md-editor', 'credentials.json'))
  })

  it('linux + XDG_CONFIG_HOME', () => {
    const path = credentialsPath({ platform: 'linux', env: { XDG_CONFIG_HOME: '/home/a/.config-x' }, homedir: '/home/a' })
    expect(path).toBe(join('/home/a/.config-x', 'md-editor', 'credentials.json'))
  })

  it('darwin, XDG_CONFIG_HOME 없음', () => {
    const path = credentialsPath({ platform: 'darwin', env: {}, homedir: '/Users/a' })
    expect(path).toBe(join('/Users/a', '.config', 'md-editor', 'credentials.json'))
  })
})

describe('F-2021 U3 읽기·쓰기', () => {
  let dir: string

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('쓰기 → 읽기 왕복, 서버 두 개 공존', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rawdoc-cli-'))
    const path = join(dir, 'sub', 'credentials.json')
    let store = { version: 1 as const, servers: {} }
    store = withServerToken(store, 'https://rawdoc.app', { token: 'rd_a', email: 'a@b.com', savedAt: '2026-01-01T00:00:00.000Z' })
    store = withServerToken(store, 'http://localhost:8790', { token: 'rd_b', email: 'a@b.com', savedAt: '2026-01-01T00:00:00.000Z' })
    await writeCredentials(path, store)

    const { store: read, corrupt } = await readCredentials(path)
    expect(corrupt).toBe(false)
    expect(getServerToken(read, 'https://rawdoc.app')).toBe('rd_a')
    expect(getServerToken(read, 'http://localhost:8790')).toBe('rd_b')
  })

  it('없는 파일이면 빈 것, 안내 없이', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rawdoc-cli-'))
    const { store, corrupt } = await readCredentials(join(dir, 'nope.json'))
    expect(store.servers).toEqual({})
    expect(corrupt).toBe(false)
  })

  it('깨진 JSON 이면 빈 것 + corrupt', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rawdoc-cli-'))
    const path = join(dir, 'credentials.json')
    await writeFile(path, '{not json', 'utf-8')
    const { store, corrupt } = await readCredentials(path)
    expect(store.servers).toEqual({})
    expect(corrupt).toBe(true)
  })

  it('모르는 version 도 corrupt', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rawdoc-cli-'))
    const path = join(dir, 'credentials.json')
    await writeFile(path, JSON.stringify({ version: 2, servers: {} }), 'utf-8')
    const { corrupt } = await readCredentials(path)
    expect(corrupt).toBe(true)
  })

  it('withoutServerToken — 지우기, 없으면 removed:false', () => {
    const store = withServerToken({ version: 1, servers: {} }, 'https://rawdoc.app', {
      token: 'rd_a',
      email: 'a@b.com',
      savedAt: '2026-01-01T00:00:00.000Z',
    })
    const removed = withoutServerToken(store, 'https://rawdoc.app')
    expect(removed.removed).toBe(true)
    expect(removed.store.servers['https://rawdoc.app']).toBeUndefined()
    const nothing = withoutServerToken(store, 'https://other.app')
    expect(nothing.removed).toBe(false)
  })

  it.runIf(process.platform !== 'win32')('POSIX 에서 파일 모드 600·디렉터리 700', async () => {
    dir = await mkdtemp(join(tmpdir(), 'rawdoc-cli-'))
    const path = join(dir, 'sub', 'credentials.json')
    await writeCredentials(path, { version: 1, servers: {} })
    const fileStat = await stat(path)
    const dirStat = await stat(join(dir, 'sub'))
    expect(fileStat.mode & 0o777).toBe(0o600)
    expect(dirStat.mode & 0o777).toBe(0o700)
  })
})
