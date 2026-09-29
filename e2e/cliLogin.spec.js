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

// F-2023 6.2 — v2 봉인 형식을 src/lib/cliSeal.ts 와 독립적으로 한 번 더 구현한다(형식 검증 목적)
const HKDF_INFO_PREFIX = Buffer.from('cli-seal-v2', 'ascii')

function buildHashV2({ port, host, publicKey }) {
  return `${HASH_PREFIX}${port}/${host}/${publicKey}`
}

async function generateX25519KeyPair() {
  const keyPair = await webcrypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])
  const publicRaw = Buffer.from(await webcrypto.subtle.exportKey('raw', keyPair.publicKey))
  return { privateKey: keyPair.privateKey, publicKeyRaw: publicRaw, publicKeyB64: toBase64Url(publicRaw) }
}

async function deriveAesKeyV2(sharedBits, screenPublicRaw, cliPublicRaw, usage) {
  const ikm = await webcrypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey'])
  const info = Buffer.concat([HKDF_INFO_PREFIX, screenPublicRaw, cliPublicRaw])
  return webcrypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: Buffer.alloc(0), info },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

async function openSealedV2(privateKey, cliPublicRaw, sealed) {
  const bytes = fromBase64Url(sealed)
  const screenPublicRaw = bytes.subarray(0, 32)
  const iv = bytes.subarray(32, 44)
  const cipher = bytes.subarray(44)
  const screenPublicKey = await webcrypto.subtle.importKey('raw', screenPublicRaw, { name: 'X25519' }, false, [])
  const sharedBits = await webcrypto.subtle.deriveBits({ name: 'X25519', public: screenPublicKey }, privateKey, 256)
  const aesKey = await deriveAesKeyV2(sharedBits, screenPublicRaw, cliPublicRaw, 'decrypt')
  const plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipher)
  return Buffer.from(plain).toString('utf-8')
}

const BAD_HASH_TEXT = '로그인 주소가 잘렸거나 올바르지 않습니다. 터미널에 찍힌 주소를 처음부터 끝까지 복사해 브라우저 주소창에 붙여 넣으세요.'

async function gotoLogin(page, hash) {
  await page.goto('about:blank')
  await page.goto(`/?app=1${hash}`)
}

async function routeMe(page, onCall) {
  await page.route('**/api/me', (route) => {
    onCall()
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1","email":"a@b.com"}' })
  })
}

test.describe('CLI 로그인 화면', () => {
  test('F-2021 E1·E2·E7·E8, F-2023 E1·E2 승인(더블 클릭 POST 1회)·취소, v1·v2 콜백과 봉인 토큰', async ({ page }) => {
    const server = await fakeServer(page)
    let postCount = 0
    let callbackUrl = null
    await page.route('**/api/tokens', async (route) => {
      if (route.request().method() === 'POST') postCount += 1
      return route.fallback()
    })
    await page.route(/^http:\/\/127\.0\.0\.1:\d+\//, async (route) => {
      callbackUrl = route.request().url()
      return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
    })
    const reset = () => {
      postCount = 0
      callbackUrl = null
    }
    const approveTwice = async () => {
      const approve = page.getByRole('button', { name: '승인' })
      await Promise.all([approve.click(), approve.click({ timeout: 2000 }).catch(() => {})])
      await expect.poll(() => callbackUrl).not.toBeNull()
      await page.waitForTimeout(200)
      expect(postCount).toBe(1)
      return new URL(callbackUrl)
    }
    const cancel = async () => {
      await page.getByRole('button', { name: '취소' }).click()
      await expect.poll(() => callbackUrl).not.toBeNull()
      expect(postCount).toBe(0)
      return new URL(callbackUrl)
    }

    // v1 승인 — E7 App 을 띄우지 않음 포함
    const v1 = await generateKeyPair()
    const state = randomState()
    await gotoLogin(page, buildHash({ port: 45678, state, publicKey: v1.publicKeyB64, host: 'test-host' }))
    await expect(page.getByText(/a@b\.com 계정으로 이 컴퓨터의 명령줄 도구가/)).toBeVisible()
    await expect(page.locator('.cli-login-name')).toHaveText('CLI · test-host')
    await expect(page.locator('.sidebar')).toHaveCount(0)
    await expect(page.locator('.cm-editor')).toHaveCount(0)
    await expect(page.locator('#boot-skeleton')).toHaveCount(0)
    expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).not.toContain('md-docs')
    let url = await approveTwice()
    expect(url.pathname).toBe('/callback')
    expect(url.searchParams.get('state')).toBe(state)
    let opened = await openSealed(v1.privateKey, url.searchParams.get('sealed'))
    expect(opened).toMatch(/^rd_/)
    let newToken = [...server.apiTokens.values()].find((t) => t.name === 'CLI · test-host')
    expect(newToken).toBeTruthy()
    expect(opened.slice(0, 11)).toBe(newToken.prefix)
    expect(callbackUrl).not.toContain(opened)

    // v1 취소
    reset()
    await gotoLogin(page, buildHash({ port: 45679, state, publicKey: v1.publicKeyB64, host: 'test-host' }))
    url = await cancel()
    expect(url.searchParams.get('state')).toBe(state)
    expect(url.searchParams.get('error')).toBe('denied')

    // v2 승인
    reset()
    const v2 = await generateX25519KeyPair()
    server.apiTokens.clear()
    await gotoLogin(page, buildHashV2({ port: 55678, host: 'test-host', publicKey: v2.publicKeyB64 }))
    await expect(page.locator('.cli-login-name')).toHaveText('CLI · test-host')
    url = await approveTwice()
    expect(url.searchParams.get('state')).toBe(v2.publicKeyB64)
    opened = await openSealedV2(v2.privateKey, v2.publicKeyRaw, url.searchParams.get('sealed'))
    expect(opened).toMatch(/^rd_/)
    newToken = [...server.apiTokens.values()].find((t) => t.name === 'CLI · test-host')
    expect(newToken).toBeTruthy()
    expect(opened.slice(0, 11)).toBe(newToken.prefix)
    expect(callbackUrl).not.toContain(opened)

    // v2 취소
    reset()
    await gotoLogin(page, buildHashV2({ port: 55679, host: 'test-host', publicKey: v2.publicKeyB64 }))
    url = await cancel()
    expect(url.searchParams.get('state')).toBe(v2.publicKeyB64)
    expect(url.searchParams.get('error')).toBe('denied')
  })

  test('F-2021 E3, F-2023 E6 로그아웃 상태 — 안내 문구·로그인 링크(v2 는 120자 이하), 승인 버튼 없음', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }),
    )
    const v1 = await generateKeyPair()
    const v1Hash = buildHash({ port: 45680, state: randomState(), publicKey: v1.publicKeyB64, host: 'test-host' })
    await gotoLogin(page, v1Hash)
    await expect(page.getByText('로그인한 뒤 승인할 수 있습니다.')).toBeVisible()
    await expect(page.getByRole('link', { name: '로그인' })).toHaveAttribute('href', `/api/login?return=${encodeURIComponent(v1Hash)}`)
    await expect(page.getByRole('button', { name: '승인' })).toHaveCount(0)

    const v2 = await generateX25519KeyPair()
    const v2Hash = buildHashV2({ port: 55682, host: 'test-host', publicKey: v2.publicKeyB64 })
    await gotoLogin(page, v2Hash)
    const href = `/api/login?return=${encodeURIComponent(v2Hash)}`
    await expect(page.getByRole('link', { name: '로그인' })).toHaveAttribute('href', href)
    expect(href.length).toBeLessThanOrEqual(120)
  })

  test('F-2021 E4·E5, F-2023 E3·E4·E5 잘못된 주소·iframe·미지원 브라우저 — 안내 문구, 버튼 없음, /api/me 0회', async ({ page }) => {
    let meCount = 0
    await routeMe(page, () => {
      meCount += 1
    })
    const expectRejected = async (hash, { text = BAD_HASH_TEXT, note } = {}) => {
      meCount = 0
      await gotoLogin(page, hash)
      await expect(page.getByText(text, { exact: false })).toBeVisible()
      if (note === null) await expect(page.locator('.cli-login-note')).toHaveCount(0)
      else if (note) await expect(page.locator('.cli-login-note')).toContainText(note)
      await expect(page.getByRole('button')).toHaveCount(0)
      expect(meCount).toBe(0)
    }

    const v1 = await generateKeyPair()
    const state = randomState()
    for (const hash of [
      `${HASH_PREFIX}80/${state}/${v1.publicKeyB64}/test-host`,
      `${HASH_PREFIX}45678/${v1.publicKeyB64}/test-host`,
      `${HASH_PREFIX}45678/${state}/test-host`,
      `${HASH_PREFIX}45678/${state}/${v1.publicKeyB64}`,
    ]) {
      await expectRejected(hash)
    }

    const fullV1 = buildHash({ port: 45678, state, publicKey: v1.publicKeyB64, host: 'test-host' })
    await expectRejected(fullV1.slice(0, fullV1.indexOf(v1.publicKeyB64) + 200), { note: 'npx -y rawdoc@latest login' })

    const v2 = await generateX25519KeyPair()
    const host = 'test-host'
    const fullV2 = buildHashV2({ port: 55680, host, publicKey: v2.publicKeyB64 })
    for (const hash of [
      buildHashV2({ port: 55680, host, publicKey: v2.publicKeyB64.slice(0, 42) }),
      buildHashV2({ port: 55680, host, publicKey: v2.publicKeyB64.slice(0, 10) }),
      fullV2.slice(0, fullV2.indexOf(`${host}/`) + host.length + 1),
      fullV2.slice(0, fullV2.indexOf(host) + Math.floor(host.length / 2)),
    ]) {
      await expectRejected(hash, { note: null })
    }

    meCount = 0
    await page.goto('/')
    const origin = new URL(page.url()).origin
    meCount = 0
    await page.setContent(`<iframe src="${origin}/?app=1${fullV1}" style="width:600px;height:400px"></iframe>`)
    const frame = page.frameLocator('iframe')
    await expect(frame.getByText('잘못된 로그인 주소입니다. 터미널에서 로그인 명령을 다시 실행하세요.')).toBeVisible()
    await expect(frame.getByRole('button')).toHaveCount(0)
    expect(meCount).toBe(0)

    await page.addInitScript(() => {
      const original = window.crypto.subtle.importKey.bind(window.crypto.subtle)
      window.crypto.subtle.importKey = (format, keyData, algorithm, ...rest) => {
        const name = typeof algorithm === 'string' ? algorithm : algorithm?.name
        if (name === 'X25519') return Promise.reject(new DOMException('unsupported algorithm', 'NotSupportedError'))
        return original(format, keyData, algorithm, ...rest)
      }
    })
    await expectRejected(fullV2, {
      text: '이 브라우저는 터미널 로그인에 필요한 암호화 방식(X25519)을 지원하지 않습니다.',
      note: 'rawdoc login --with-token',
    })
  })

  test('F-2021 E6 토큰 10개 — too_many 오류 문구, 콜백 이동 없음, 승인 다시 활성', async ({ page }) => {
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
