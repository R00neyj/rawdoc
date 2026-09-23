// CLI 로그인 화면 — S-9 (specs/features/F-2021.md 6장, 13.2 F-2021 E*)
import { test, expect } from '@playwright/test'
import { webcrypto, randomBytes } from 'node:crypto'
import { fakeServer } from './fixtures/fakeServer.js'

const HASH_PREFIX = '#/cli-login/'

function toBase64Url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return Buffer.from(padded + pad, 'base64')
}

function randomState() {
  return toBase64Url(randomBytes(16))
}

async function generateKeyPair() {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    false,
    ['encrypt', 'decrypt'],
  )
  const spki = await webcrypto.subtle.exportKey('spki', keyPair.publicKey)
  return { publicKeyB64: toBase64Url(spki), privateKey: keyPair.privateKey }
}

async function openSealed(privateKey, sealed) {
  const plain = await webcrypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromBase64Url(sealed))
  return Buffer.from(plain).toString('utf-8')
}

function buildHash({ port, state, publicKey, host }) {
  return `${HASH_PREFIX}${port}/${state}/${publicKey}/${host}`
}

test.describe('F-2021 E1 로그인 상태 — 승인', () => {
  test('이메일·CLI · test-host 가 보이고 콜백에 봉인 토큰이 실린다', async ({ page }) => {
    const server = await fakeServer(page)
    const { publicKeyB64, privateKey } = await generateKeyPair()
    const state = randomState()
    const port = 45678
    const hash = buildHash({ port, state, publicKey: publicKeyB64, host: 'test-host' })

    let postCount = 0
    await page.route('**/api/tokens', async (route) => {
      if (route.request().method() === 'POST') postCount += 1
      return route.fallback()
    })

    let callbackUrl = null
    await page.route(`http://127.0.0.1:${port}/**`, async (route) => {
      callbackUrl = route.request().url()
      return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
    })

    await page.goto(`/?app=1${hash}`)
    await expect(page.getByText(/a@b\.com 계정으로 이 컴퓨터의 명령줄 도구가/)).toBeVisible()
    await expect(page.locator('.cli-login-name')).toHaveText('CLI · test-host')

    await page.getByRole('button', { name: '승인' }).click()

    await expect.poll(() => callbackUrl).not.toBeNull()
    expect(postCount).toBe(1)

    const url = new URL(callbackUrl)
    expect(url.pathname).toBe('/callback')
    expect(url.searchParams.get('state')).toBe(state)
    const sealed = url.searchParams.get('sealed')
    expect(sealed).toBeTruthy()

    const opened = await openSealed(privateKey, sealed)
    expect(opened).toMatch(/^rd_/)

    const newToken = [...server.apiTokens.values()].find((t) => t.name === 'CLI · test-host')
    expect(newToken).toBeTruthy()
    expect(opened.slice(0, 11)).toBe(newToken.prefix)

    // 342자 base64url 안에 46자 원문이 우연히 나올 수 있어 rd_ 세 글자로는 찾지 않는다 — 풀어서 직접 비교한다
    expect(callbackUrl).not.toContain(opened)
  })
})

test.describe('F-2021 E2 취소', () => {
  test('콜백에 error=denied, 토큰을 만들지 않는다', async ({ page }) => {
    await fakeServer(page)
    const { publicKeyB64 } = await generateKeyPair()
    const state = randomState()
    const port = 45679
    const hash = buildHash({ port, state, publicKey: publicKeyB64, host: 'test-host' })

    let postCount = 0
    await page.route('**/api/tokens', async (route) => {
      if (route.request().method() === 'POST') postCount += 1
      return route.fallback()
    })
    let callbackUrl = null
    await page.route(`http://127.0.0.1:${port}/**`, async (route) => {
      callbackUrl = route.request().url()
      return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
    })

    await page.goto(`/?app=1${hash}`)
    await page.getByRole('button', { name: '취소' }).click()

    await expect.poll(() => callbackUrl).not.toBeNull()
    const url = new URL(callbackUrl)
    expect(url.searchParams.get('state')).toBe(state)
    expect(url.searchParams.get('error')).toBe('denied')
    expect(postCount).toBe(0)
  })
})

test.describe('F-2021 E3 로그아웃 상태', () => {
  test('안내 문구 + 로그인 링크, 승인 버튼 없음', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }),
    )
    const { publicKeyB64 } = await generateKeyPair()
    const state = randomState()
    const hash = buildHash({ port: 45680, state, publicKey: publicKeyB64, host: 'test-host' })

    await page.goto(`/?app=1${hash}`)
    await expect(page.getByText('로그인한 뒤 승인할 수 있습니다.')).toBeVisible()
    const link = page.getByRole('link', { name: '로그인' })
    await expect(link).toHaveAttribute('href', `/api/login?return=${encodeURIComponent(hash)}`)
    await expect(page.getByRole('button', { name: '승인' })).toHaveCount(0)
  })
})

test.describe('F-2021 E4 잘못된 로그인 주소', () => {
  test('포트 80 · 조각 없음 각각 → 안내 문구, 버튼 없음, /api/me 요청 0회', async ({ page }) => {
    const { publicKeyB64 } = await generateKeyPair()
    const state = randomState()
    const badHashes = [
      `${HASH_PREFIX}80/${state}/${publicKeyB64}/test-host`, // 포트 범위 밖
      `${HASH_PREFIX}45678/${publicKeyB64}/test-host`, // state 조각 없음
      `${HASH_PREFIX}45678/${state}/test-host`, // publicKey 조각 없음
      `${HASH_PREFIX}45678/${state}/${publicKeyB64}`, // host 조각 없음
    ]

    let meCount = 0
    await page.route('**/api/me', (route) => {
      meCount += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1","email":"a@b.com"}' })
    })

    for (const hash of badHashes) {
      meCount = 0
      await page.goto(`/?app=1${hash}`)
      await expect(page.getByText('잘못된 로그인 주소입니다. 터미널에서 로그인 명령을 다시 실행하세요.')).toBeVisible()
      await expect(page.getByRole('button')).toHaveCount(0)
      expect(meCount).toBe(0)
    }
  })
})

test.describe('F-2021 E5 다른 페이지의 iframe 안', () => {
  test('틀 안이면 잘못된 주소로 취급하고 /api/me 를 부르지 않는다', async ({ page }) => {
    let meCount = 0
    await page.route('**/api/me', (route) => {
      meCount += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1","email":"a@b.com"}' })
    })

    await page.goto('/')
    const origin = new URL(page.url()).origin
    const { publicKeyB64 } = await generateKeyPair()
    const state = randomState()
    const hash = buildHash({ port: 45681, state, publicKey: publicKeyB64, host: 'test-host' })
    const src = `${origin}/?app=1${hash}`

    meCount = 0
    await page.setContent(`<iframe src="${src}" style="width:600px;height:400px"></iframe>`)
    const frame = page.frameLocator('iframe')
    await expect(frame.getByText('잘못된 로그인 주소입니다. 터미널에서 로그인 명령을 다시 실행하세요.')).toBeVisible()
    await expect(frame.getByRole('button')).toHaveCount(0)
    expect(meCount).toBe(0)
  })
})

test.describe('F-2021 E6 토큰 10개', () => {
  test('too_many 오류 문구, 콜백 이동 없음, 승인 다시 활성', async ({ page }) => {
    const server = await fakeServer(page)
    for (let i = 0; i < 10; i++) {
      const id = `t${i}`
      server.apiTokens.set(id, {
        id,
        name: `t${i}`,
        prefix: 'rd_' + 'a'.repeat(8),
        createdAt: Date.now(),
        lastUsedAt: null,
        revokedAt: null,
      })
    }
    const { publicKeyB64 } = await generateKeyPair()
    const state = randomState()
    const port = 45682
    const hash = buildHash({ port, state, publicKey: publicKeyB64, host: 'test-host' })

    let callbackHit = false
    await page.route(`http://127.0.0.1:${port}/**`, async (route) => {
      callbackHit = true
      return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
    })

    await page.goto(`/?app=1${hash}`)
    await page.getByRole('button', { name: '승인' }).click()

    await expect(page.getByText('토큰은 10개까지 만들 수 있습니다. 쓰지 않는 토큰을 폐기하세요.')).toBeVisible()
    expect(callbackHit).toBe(false)
    await expect(page.getByRole('button', { name: '승인' })).toBeEnabled()
  })
})

test.describe('F-2021 E7 App 을 띄우지 않음', () => {
  test('사이드바·편집기·IndexedDB(md-docs)·부팅 스켈레톤이 없다', async ({ page }) => {
    await fakeServer(page)
    const { publicKeyB64 } = await generateKeyPair()
    const state = randomState()
    const hash = buildHash({ port: 45683, state, publicKey: publicKeyB64, host: 'test-host' })

    await page.goto(`/?app=1${hash}`)
    await expect(page.getByText(/계정으로 이 컴퓨터의 명령줄 도구가/)).toBeVisible()

    await expect(page.locator('.sidebar')).toHaveCount(0)
    await expect(page.locator('.cm-editor')).toHaveCount(0)
    await expect(page.locator('#boot-skeleton')).toHaveCount(0)

    const dbNames = await page.evaluate(async () => {
      const dbs = await indexedDB.databases()
      return dbs.map((d) => d.name)
    })
    expect(dbNames).not.toContain('md-docs')
  })
})

test.describe('F-2021 E8 승인 빠르게 두 번', () => {
  test('POST /api/tokens 는 1회만 간다', async ({ page }) => {
    await fakeServer(page)
    const { publicKeyB64 } = await generateKeyPair()
    const state = randomState()
    const port = 45684
    const hash = buildHash({ port, state, publicKey: publicKeyB64, host: 'test-host' })

    let postCount = 0
    await page.route('**/api/tokens', async (route) => {
      if (route.request().method() === 'POST') postCount += 1
      return route.fallback()
    })
    await page.route(`http://127.0.0.1:${port}/**`, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' }))

    await page.goto(`/?app=1${hash}`)
    const approve = page.getByRole('button', { name: '승인' })
    await Promise.all([approve.click(), approve.click({ timeout: 2000 }).catch(() => {})])

    await expect.poll(() => postCount, { timeout: 3000 }).toBeGreaterThanOrEqual(1)
    await page.waitForTimeout(200)
    expect(postCount).toBe(1)
  })
})
