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
      await expect(
        page.getByText('로그인 주소가 잘렸거나 올바르지 않습니다. 터미널에 찍힌 주소를 처음부터 끝까지 복사해 브라우저 주소창에 붙여 넣으세요.'),
      ).toBeVisible()
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

test.describe('F-2023 E1 v2 로그인 상태 — 승인', () => {
  test('CLI · test-host 가 보이고 콜백 state 가 공개키, sealed 를 풀면 서버 토큰과 맞는다', async ({ page }) => {
    const server = await fakeServer(page)
    const { privateKey, publicKeyRaw, publicKeyB64 } = await generateX25519KeyPair()
    const port = 55678
    const hash = buildHashV2({ port, host: 'test-host', publicKey: publicKeyB64 })

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
    await expect(page.locator('.cli-login-name')).toHaveText('CLI · test-host')

    await page.getByRole('button', { name: '승인' }).click()

    await expect.poll(() => callbackUrl).not.toBeNull()
    expect(postCount).toBe(1)

    const url = new URL(callbackUrl)
    expect(url.pathname).toBe('/callback')
    expect(url.searchParams.get('state')).toBe(publicKeyB64)
    const sealed = url.searchParams.get('sealed')
    expect(sealed).toBeTruthy()

    const opened = await openSealedV2(privateKey, publicKeyRaw, sealed)
    expect(opened).toMatch(/^rd_/)

    const newToken = [...server.apiTokens.values()].find((t) => t.name === 'CLI · test-host')
    expect(newToken).toBeTruthy()
    expect(opened.slice(0, 11)).toBe(newToken.prefix)
    expect(callbackUrl).not.toContain(opened)
  })
})

test.describe('F-2023 E2 v2 취소', () => {
  test('콜백에 error=denied, state 가 공개키, 토큰을 만들지 않는다', async ({ page }) => {
    await fakeServer(page)
    const { publicKeyB64 } = await generateX25519KeyPair()
    const port = 55679
    const hash = buildHashV2({ port, host: 'test-host', publicKey: publicKeyB64 })

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
    expect(url.searchParams.get('state')).toBe(publicKeyB64)
    expect(url.searchParams.get('error')).toBe('denied')
    expect(postCount).toBe(0)
  })
})

test.describe('F-2023 E3 잘린 v2 주소', () => {
  test('키 42자·10자·host 뒤 슬래시까지·host 가운데까지 각각 → 잘림 문구, 업데이트 줄 없음, 버튼 없음, /api/me 0회', async ({
    page,
  }) => {
    const { publicKeyB64 } = await generateX25519KeyPair()
    const port = 55680
    const host = 'test-host'
    const fullHash = buildHashV2({ port, host, publicKey: publicKeyB64 })
    const hostSlashIndex = fullHash.indexOf(`${host}/`) + host.length + 1
    const hostMidIndex = fullHash.indexOf(host) + Math.floor(host.length / 2)

    const badHashes = [
      buildHashV2({ port, host, publicKey: publicKeyB64.slice(0, 42) }),
      buildHashV2({ port, host, publicKey: publicKeyB64.slice(0, 10) }),
      fullHash.slice(0, hostSlashIndex),
      fullHash.slice(0, hostMidIndex),
    ]

    let meCount = 0
    await page.route('**/api/me', (route) => {
      meCount += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1","email":"a@b.com"}' })
    })

    for (const hash of badHashes) {
      meCount = 0
      await page.goto(`/?app=1${hash}`)
      await expect(
        page.getByText('로그인 주소가 잘렸거나 올바르지 않습니다. 터미널에 찍힌 주소를 처음부터 끝까지 복사해 브라우저 주소창에 붙여 넣으세요.'),
      ).toBeVisible()
      await expect(page.locator('.cli-login-note')).toHaveCount(0)
      await expect(page.getByRole('button')).toHaveCount(0)
      expect(meCount).toBe(0)
    }
  })
})

test.describe('F-2023 E4 잘린 v1 주소', () => {
  test('RSA 키 200자에서 자름 → 잘림 문구 + 업데이트 줄, 버튼 없음, /api/me 0회', async ({ page }) => {
    const { publicKeyB64 } = await generateKeyPair()
    const state = randomState()
    const fullHash = buildHash({ port: 45678, state, publicKey: publicKeyB64, host: 'test-host' })
    const publicKeyIndex = fullHash.indexOf(publicKeyB64)
    const truncated = fullHash.slice(0, publicKeyIndex + 200)

    let meCount = 0
    await page.route('**/api/me', (route) => {
      meCount += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1","email":"a@b.com"}' })
    })

    await page.goto(`/?app=1${truncated}`)
    await expect(
      page.getByText('로그인 주소가 잘렸거나 올바르지 않습니다. 터미널에 찍힌 주소를 처음부터 끝까지 복사해 브라우저 주소창에 붙여 넣으세요.'),
    ).toBeVisible()
    await expect(page.locator('.cli-login-note')).toContainText('npx -y rawdoc@latest login')
    await expect(page.getByRole('button')).toHaveCount(0)
    expect(meCount).toBe(0)
  })
})

test.describe('F-2023 E5 X25519 를 지원하지 않는 브라우저', () => {
  test('unsupported 문구와 --with-token 안내, 버튼 없음, /api/me 0회', async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.crypto.subtle.importKey.bind(window.crypto.subtle)
      window.crypto.subtle.importKey = (format, keyData, algorithm, ...rest) => {
        const name = typeof algorithm === 'string' ? algorithm : algorithm?.name
        if (name === 'X25519') {
          return Promise.reject(new DOMException('unsupported algorithm', 'NotSupportedError'))
        }
        return original(format, keyData, algorithm, ...rest)
      }
    })

    const { publicKeyB64 } = await generateX25519KeyPair()
    const port = 55681
    const hash = buildHashV2({ port, host: 'test-host', publicKey: publicKeyB64 })

    let meCount = 0
    await page.route('**/api/me', (route) => {
      meCount += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"u1","email":"a@b.com"}' })
    })

    await page.goto(`/?app=1${hash}`)
    await expect(
      page.getByText('이 브라우저는 터미널 로그인에 필요한 암호화 방식(X25519)을 지원하지 않습니다.', { exact: false }),
    ).toBeVisible()
    await expect(page.locator('.cli-login-note')).toContainText('rawdoc login --with-token')
    await expect(page.getByRole('button')).toHaveCount(0)
    expect(meCount).toBe(0)
  })
})

test.describe('F-2023 E6 v2 로그아웃 상태', () => {
  test('로그인 링크 href 길이가 120자 이하', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }),
    )
    const { publicKeyB64 } = await generateX25519KeyPair()
    const hash = buildHashV2({ port: 55682, host: 'test-host', publicKey: publicKeyB64 })

    await page.goto(`/?app=1${hash}`)
    const link = page.getByRole('link', { name: '로그인' })
    const href = `/api/login?return=${encodeURIComponent(hash)}`
    await expect(link).toHaveAttribute('href', href)
    expect(href.length).toBeLessThanOrEqual(120)
  })
})
