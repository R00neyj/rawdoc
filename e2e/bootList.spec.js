// 부팅 목록 읽기 — 병렬화와 캐시 먼저 셸 (specs/features/F-2042.md 8장)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, waitSaved } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

function makeGate() {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}

// GET /api/docs 를 붙잡는다 — 풀면 fakeServer 의 원래 응답으로 넘어간다
async function holdApiDocs(page) {
  const gate = makeGate()
  await page.route('**/api/docs', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await gate.promise
    return route.fallback()
  })
  return gate.release
}

async function newDoc(page, name) {
  const id = await importMarkdown(page, { name: `${name}.md`, content: `${name}\n` })
  await waitSaved(page)
  return id
}

function docLink(page, name) {
  return page.locator('.sidebar').getByRole('link', { name, exact: true })
}

async function clearHash(page) {
  await page.evaluate(() => history.replaceState(null, '', '/'))
}

test.describe('F-2042 A1 캐시 먼저 셸 — 목록 붙잡힘', () => {
  test('GET /api/docs 가 붙잡힌 동안 캐시 문서 3개로 셸이 ready, 풀면 서버에만 있던 문서가 나타난다', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    await newDoc(page, 'A')
    await newDoc(page, 'B')
    await newDoc(page, 'C')
    await clearHash(page)

    const now = Date.now()
    server.docs.set('server-only-1', {
      id: 'server-only-1',
      title: '서버에만 있는 문서',
      content: '내용\n',
      lineEnding: 'lf',
      folderId: null,
      pinnedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })

    const release = await holdApiDocs(page)
    await page.reload()

    await expect(page.locator('.app-shell')).not.toHaveAttribute('aria-busy', 'true')
    await expect(docLink(page, 'A')).toBeVisible()
    await expect(docLink(page, 'B')).toBeVisible()
    await expect(docLink(page, 'C')).toBeVisible()
    await expect(docLink(page, '서버에만 있는 문서')).toHaveCount(0)

    release()
    await expect(docLink(page, '서버에만 있는 문서')).toBeVisible()
  })
})

test.describe('F-2042 A2 캐시 먼저 셸 — 뒤 맞추기로 삭제 반영', () => {
  test('서버에서 지운 문서가 새로고침 뒤 사이드바에서 사라진다', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    await newDoc(page, 'A')
    const bId = await newDoc(page, 'B')
    await newDoc(page, 'C')
    await clearHash(page)

    server.docs.delete(bId)

    await page.reload()
    await expect(page.locator('.app-shell')).not.toHaveAttribute('aria-busy', 'true')
    await expect(docLink(page, 'A')).toBeVisible()
    await expect(docLink(page, 'C')).toBeVisible()
    await expect(docLink(page, 'B')).toHaveCount(0)
  })
})

test.describe('F-2042 A3 캐시 먼저 셸 — 열린 문서가 뒤 맞추기로 지워짐', () => {
  test('캐시 본문으로 먼저 열리고, 풀리면 삭제 알림과 읽기 전용', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page) // md.startScreen = 'last'
    const xId = await newDoc(page, 'X')
    await clearHash(page)

    server.docs.delete(xId)

    const release = await holdApiDocs(page)
    await page.reload()

    // get(xId) 는 진행 중인 list() 요약을 최대 GET_WAIT_FOR_LIST_MS(3000ms) 기다린 뒤 캐시로 연다 (F-2042 3.5)
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible({ timeout: 10_000 })
    expect(await currentDocId(page)).toBe(xId)

    release()
    await expect(page.locator('.notice-message')).toContainText(
      '이 문서가 다른 곳에서 삭제되었습니다',
      { timeout: 5000 },
    )
    await expect(page.getByRole('button', { name: '새 문서로 저장' })).toBeVisible()

    await page.locator('.cm-content').click()
    await page.keyboard.type('몰래 입력')
    await expect(page.locator('.cm-content')).not.toContainText('몰래 입력')
  })
})

test.describe('F-2042 A4 해시가 캐시에 없는 문서를 가리킨다', () => {
  test('서버에만 있는 문서를 해시로 열면 찾을 수 없음 알림 없이 열린다', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    await newDoc(page, 'A')
    await clearHash(page)

    const now = Date.now()
    server.docs.set('server-only-y', {
      id: 'server-only-y',
      title: 'Y',
      content: '내용\n',
      lineEnding: 'lf',
      folderId: null,
      pinnedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })

    await page.evaluate(() => {
      history.replaceState(null, '', '#/d/server-only-y')
    })
    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    expect(await currentDocId(page)).toBe('server-only-y')
    await expect(page.locator('.notice-message')).toHaveCount(0)
  })
})

test.describe('F-2042 A5 캐시 먼저 셸 도중 새 문서', () => {
  test('뒤 맞추기가 끝나도 그 사이 만든 문서가 사라지지 않는다', async ({ page }) => {
    await fakeServer(page)
    await openApp(page)
    await newDoc(page, 'A')
    await clearHash(page)

    const release = await holdApiDocs(page)
    await page.reload()
    await expect(page.locator('.app-shell')).not.toHaveAttribute('aria-busy', 'true')

    await page.getByRole('button', { name: '새 문서' }).click()
    const zId = await currentDocId(page)
    expect(zId).not.toBeNull()

    release()
    await expect(page.locator('.notice-message')).toHaveCount(0)
    expect(await currentDocId(page)).toBe(zId)
    await expect(page.locator(`.sidebar a[href="#/d/${zId}"]`)).toBeVisible()
  })
})

test.describe('F-2042 A6 캐시 먼저 셸 — 공유받은 문서', () => {
  test('뒤 맞추기가 끝나면 공유받은 문서가 사이드바에 보인다', async ({ page }) => {
    await fakeServer(page)
    await openApp(page)
    await newDoc(page, 'A')
    await clearHash(page)

    await page.route('**/api/shared', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'shared-doc-1',
            title: '공유받은 문서',
            lineEnding: 'lf',
            folderId: null,
            pinnedAt: null,
            version: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            role: 'view',
            ownerEmail: 'owner@x.com',
          },
        ]),
      }),
    )

    await page.reload()
    await expect(page.locator('.app-shell')).not.toHaveAttribute('aria-busy', 'true')
    await expect(docLink(page, '공유받은 문서')).toBeVisible()
  })
})

test.describe('F-2042 A9 본문 동시 개수', () => {
  test('첫 부팅에서 GET /api/docs/:id 가 겹치는 최대 개수는 6 이하, 50개 모두 받는다', async ({ page }) => {
    const server = await fakeServer(page)
    const now = Date.now()
    for (let i = 0; i < 50; i++) {
      server.docs.set(`d${i}`, {
        id: `d${i}`,
        title: `문서${i}`,
        content: `내용${i}\n`,
        lineEnding: 'lf',
        folderId: null,
        pinnedAt: null,
        version: 1,
        createdAt: now - i,
        updatedAt: now - i,
      })
    }
    server.setLatency(300)

    await page.goto('/')
    await expect(page.locator('.app-shell')).not.toHaveAttribute('aria-busy', 'true', { timeout: 20_000 })

    const bodyRequests = server.readRequests().filter((r) => /\/api\/docs\/[^/]+$/.test(r.path))
    expect(bodyRequests.length).toBe(50)

    let maxOverlap = 0
    for (const r of bodyRequests) {
      const overlap = bodyRequests.filter((o) => o.startedAt < r.endedAt && o.endedAt > r.startedAt).length
      maxOverlap = Math.max(maxOverlap, overlap)
    }
    expect(maxOverlap).toBeLessThanOrEqual(6)
  })
})

test.describe('F-2042 A10 측정 — 첫 부팅과 캐시 먼저 새로고침', () => {
  test('첫 부팅 ≤ 6000ms, 캐시 먼저 새로고침(바뀐 문서 20개) ≤ 1500ms', async ({ page }) => {
    test.setTimeout(60_000)
    const server = await fakeServer(page)
    const now = Date.now()
    for (let i = 0; i < 50; i++) {
      server.docs.set(`d${i}`, {
        id: `d${i}`,
        title: `문서${i}`,
        content: `내용${i}\n`,
        lineEnding: 'lf',
        folderId: null,
        pinnedAt: null,
        version: 1,
        createdAt: now - i,
        updatedAt: now - i,
      })
    }
    server.setLatency(300)

    const startA = Date.now()
    await page.goto('/')
    await expect(page.locator('.app-shell')).not.toHaveAttribute('aria-busy', 'true', { timeout: 20_000 })
    const durationA = Date.now() - startA
    expect(durationA).toBeLessThanOrEqual(6_000)

    const ids = [...server.docs.keys()].slice(0, 20)
    for (const id of ids) {
      const d = server.docs.get(id)
      d.content += ' 바뀜'
      d.version += 1
      d.updatedAt = Date.now()
    }

    const startB = Date.now()
    await page.reload()
    await expect(page.locator('.app-shell')).not.toHaveAttribute('aria-busy', 'true', { timeout: 10_000 })
    const durationB = Date.now() - startB
    expect(durationB).toBeLessThanOrEqual(1_500)
  })
})
