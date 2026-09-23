// 위키링크 해석·헤딩 이동 (specs/features/F-2018.md 15.2)
import { test, expect } from '@playwright/test'
import { openApp, currentDocId, setViewMode } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const LONG_BODY = Array.from({ length: 120 }, (_, i) => `본문 줄 ${i + 1}`).join('\n\n')

function seedFolder(server, { id, name, parentId = null }) {
  const now = Date.now()
  server.folders.set(id, { id, name, parentId, createdAt: now, updatedAt: now })
}

function seedDoc(server, { id, title, content = '', folderId = null, age = 0 }) {
  const at = Date.now() - age
  server.docs.set(id, {
    id,
    title,
    content,
    lineEnding: 'lf',
    folderId,
    pinnedAt: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
  })
}

// 15.2 준비 — 폴더 교안(f1)·과제(f2), 1주차 둘(f1 쪽이 오래됨), 목차(f1)
function seedCourse(server, tocContent) {
  seedFolder(server, { id: 'f1', name: '교안' })
  seedFolder(server, { id: 'f2', name: '과제' })
  seedDoc(server, { id: 'w1', title: '1주차', content: '교안 1주차\n', folderId: 'f1', age: 100_000 })
  seedDoc(server, { id: 'w2', title: '1주차', content: '과제 1주차\n', folderId: 'f2', age: 0 })
  seedDoc(server, { id: 'toc', title: '목차', content: tocContent, folderId: 'f1', age: 50_000 })
}

async function openDoc(page, id) {
  await page.evaluate((docId) => {
    location.hash = `#/d/${docId}`
  }, id)
  await expect.poll(() => currentDocId(page)).toBe(id)
  await expect(page.locator('.cm-content')).toBeVisible()
}

function editorLink(page, text) {
  return page.locator('.cm-content .md-wikilink').filter({ hasText: new RegExp(`^${text}$`) })
}

test.describe('F-2018 B1 같은 폴더 우선(편집 모드)', () => {
  test('[[1주차]] 는 더 최근인 과제 쪽이 아니라 같은 폴더 교안 쪽, [[과제/1주차]] 는 과제 쪽', async ({ page }) => {
    const server = await fakeServer(page)
    seedCourse(server, '목차 문서\n\n[[1주차]]\n\n[[과제/1주차]]\n')
    await openApp(page)
    await openDoc(page, 'toc')

    await editorLink(page, '1주차').click()
    await expect.poll(() => currentDocId(page)).toBe('w1')

    await page.goBack()
    await expect.poll(() => currentDocId(page)).toBe('toc')
    await editorLink(page, '과제/1주차').click()
    await expect.poll(() => currentDocId(page)).toBe('w2')
  })
})

test.describe('F-2018 B2 보기 모드', () => {
  test('a.wikilink href 가 각각 f1·f2 문서, 누르면 그 문서', async ({ page }) => {
    const server = await fakeServer(page)
    seedCourse(server, '목차 문서\n\n[[1주차]]\n\n[[과제/1주차]]\n')
    await openApp(page)
    await openDoc(page, 'toc')
    await setViewMode(page, 'view')

    const links = page.locator('.viewer a.wikilink')
    await expect(links).toHaveCount(2)
    await expect(links.nth(0)).toHaveAttribute('href', '#/d/w1')
    await expect(links.nth(1)).toHaveAttribute('href', '#/d/w2')

    await links.nth(1).click()
    await expect.poll(() => currentDocId(page)).toBe('w2')
  })
})

test.describe('F-2018 B3 다른 문서 헤딩(편집)', () => {
  test('[[회의록#결정]] → 그 문서가 열리고 주소는 정확히 #/d/{id}, 결정 줄이 화면 안', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'm1', title: '회의록', content: `회의 첫 줄\n\n${LONG_BODY}\n\n## 결정\n\n결정 내용\n`, age: 10_000 })
    seedDoc(server, { id: 'src', title: '출발', content: '출발 문서\n\n[[회의록#결정]]\n' })
    await openApp(page)
    await openDoc(page, 'src')

    await editorLink(page, '회의록#결정').click()
    await expect.poll(() => currentDocId(page)).toBe('m1')
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/d/m1')
    await expect(page.locator('.cm-line').filter({ hasText: /^(## )?결정$/ })).toBeInViewport()
    await expect(page.locator('.cm-line').filter({ hasText: '회의 첫 줄' })).not.toBeInViewport()
  })
})

test.describe('F-2018 B4 지금 문서 헤딩(보기)', () => {
  test('[[#결정]] → h2 결정이 화면 안, 주소 그대로', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'm1', title: '회의록', content: `[[#결정]]\n\n${LONG_BODY}\n\n## 결정\n\n결정 내용\n` })
    await openApp(page)
    await openDoc(page, 'm1')
    await setViewMode(page, 'view')

    const heading = page.locator('.viewer h2', { hasText: '결정' })
    await expect(heading).not.toBeInViewport()
    await page.locator('.viewer a.wikilink', { hasText: '#결정' }).click()
    await expect(heading).toBeInViewport()
    expect(await page.evaluate(() => location.hash)).toBe('#/d/m1')
  })
})

test.describe('F-2018 B5 못 찾는 헤딩', () => {
  test('[[회의록#없음]] → 알림, 문서 첫 줄이 화면 안', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'm1', title: '회의록', content: `회의 첫 줄\n\n${LONG_BODY}\n\n## 결정\n`, age: 10_000 })
    seedDoc(server, { id: 'src', title: '출발', content: '출발 문서\n\n[[회의록#없음]]\n' })
    await openApp(page)
    await openDoc(page, 'src')

    await editorLink(page, '회의록#없음').click()
    await expect.poll(() => currentDocId(page)).toBe('m1')
    await expect(page.locator('.notice-message')).toHaveText('"없음" 제목을 찾지 못해 문서 처음을 엽니다.')
    await expect(page.locator('.cm-line').filter({ hasText: '회의 첫 줄' })).toBeInViewport()
  })
})

test.describe('F-2018 B6 경로식 새 문서', () => {
  test('[[교안/새 글]] 은 교안 안 새 글, [[과제/새 과제]] 는 과제 안, [[없는폴더/새 글]] 은 대상 전체 제목으로 목차 폴더에', async ({ page }) => {
    const server = await fakeServer(page)
    seedCourse(server, '목차 문서\n\n[[교안/새 글]]\n\n[[과제/새 과제]]\n\n[[없는폴더/새 글]]\n')
    await openApp(page)
    const created = (title) => [...server.docs.values()].find((d) => d.title === title)

    await openDoc(page, 'toc')
    await editorLink(page, '교안/새 글').click()
    await expect.poll(() => created('새 글')?.folderId).toBe('f1')

    await openDoc(page, 'toc')
    await editorLink(page, '과제/새 과제').click()
    await expect.poll(() => created('새 과제')?.folderId).toBe('f2')

    await openDoc(page, 'toc')
    await editorLink(page, '없는폴더/새 글').click()
    await expect.poll(() => created('없는폴더/새 글')?.folderId).toBe('f1')
  })
})

test.describe('F-2018 B7 자동완성', () => {
  test('[[1주 → 후보 둘에 교안·과제, 과제 쪽은 [[과제/1주차]], 교안 쪽은 [[1주차]]', async ({ page }) => {
    const server = await fakeServer(page)
    seedCourse(server, '목차 문서\n')
    await openApp(page)
    await openDoc(page, 'toc')

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n[[1주')
    const options = page.locator('.cm-tooltip-autocomplete li')
    await expect(options).toHaveCount(2)
    await expect(page.locator('.cm-tooltip-autocomplete .cm-completionDetail')).toHaveText(['과제', '교안'])
    await options.filter({ hasText: '과제' }).click()
    await expect.poll(() => server.docs.get('toc').content, { timeout: 10_000 }).toContain('[[과제/1주차]]')

    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n[[1주')
    await expect(options).toHaveCount(2)
    await options.filter({ hasText: '교안' }).click()
    await expect.poll(() => server.docs.get('toc').content, { timeout: 10_000 }).toMatch(/\n\[\[1주차\]\]\s*$/)
  })
})

// 공개 묶음 모의 — e2e/publicView.spec.js 의 mockPublicSet 과 같은 모양
async function mockPublicSet(page, token, { start, list, others = {} }) {
  await page.route(`**/pub/docs/${token}/set`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) }),
  )
  await page.route(`**/pub/docs/${token}/docs/*`, (route) => {
    const docId = new URL(route.request().url()).pathname.split('/').pop()
    const doc = others[docId]
    if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
  })
  await page.route(`**/pub/docs/${token}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(start) }),
  )
}

const SET_TOKEN = 'tokResolve1'

async function openPublicSet(page) {
  await mockPublicSet(page, SET_TOKEN, {
    start: { title: '목차', content: '[[1주차]]\n\n[[1주차#결정]]\n\n[[1주차#없음]]\n', lineEnding: 'lf', updatedAt: 3 },
    list: {
      docs: [
        { id: 'a1', title: '목차', links: { '1주차': 'b2' } },
        { id: 'b1', title: '1주차', links: {} },
        { id: 'b2', title: '1주차', links: {} },
      ],
    },
    others: {
      b1: { title: '1주차', content: '첫째 1주차\n', lineEnding: 'lf', updatedAt: 2 },
      b2: { title: '1주차', content: `둘째 1주차\n\n${LONG_BODY}\n\n## 결정\n\n결정 내용\n`, lineEnding: 'lf', updatedAt: 1 },
    },
  })
  await page.goto(`/#/p/${SET_TOKEN}`)
  await expect(page.locator('.public-view-title')).toHaveText('목차')
}

test.describe('F-2018 B8 공개 묶음 링크 표', () => {
  test('links 가 가리키는 둘째 문서로 간다', async ({ page }) => {
    await openPublicSet(page)
    const link = page.locator('a.wikilink').filter({ hasText: /^1주차$/ })
    await expect(link).toHaveAttribute('href', `#/p/${SET_TOKEN}/b2`)
    await link.click()
    await expect(page).toHaveURL(new RegExp(`#/p/${SET_TOKEN}/b2$`))
    await expect(page.locator('.viewer')).toContainText('둘째 1주차')
  })
})

test.describe('F-2018 B9 공개 묶음 헤딩', () => {
  test('[[1주차#결정]] → 그 문서가 열리고 결정 제목이 화면 안', async ({ page }) => {
    await openPublicSet(page)
    await page.locator('a.wikilink').filter({ hasText: /^1주차#결정$/ }).click()
    await expect(page).toHaveURL(new RegExp(`#/p/${SET_TOKEN}/b2$`))
    await expect(page.locator('.viewer h2', { hasText: '결정' })).toBeInViewport()
  })

  test('없는 헤딩이면 알림 문구가 공개 화면에 보인다', async ({ page }) => {
    await openPublicSet(page)
    await page.locator('a.wikilink').filter({ hasText: /^1주차#없음$/ }).click()
    await expect(page).toHaveURL(new RegExp(`#/p/${SET_TOKEN}/b2$`))
    await expect(page.locator('.notice-message')).toHaveText('"없음" 제목을 찾지 못해 문서 처음을 엽니다.')
  })
})

test.describe('F-2018 B10 공개 폴더 가까운 폴더', () => {
  test('하위 폴더 A 문서의 [[색인]] 은 A 쪽 색인', async ({ page }) => {
    const folder = {
      name: '공유 폴더',
      folders: [
        { id: 'A', name: 'A', parentId: 'root' },
        { id: 'B', name: 'B', parentId: 'root' },
      ],
      docs: [
        { id: 'ib', title: '색인', folderId: 'B', updatedAt: 300 },
        { id: 'ia', title: '색인', folderId: 'A', updatedAt: 100 },
        { id: 'pa', title: '페이지', folderId: 'A', updatedAt: 50 },
      ],
    }
    const docs = {
      ia: { title: '색인', content: 'A 색인\n', lineEnding: 'lf', updatedAt: 100 },
      ib: { title: '색인', content: 'B 색인\n', lineEnding: 'lf', updatedAt: 300 },
      pa: { title: '페이지', content: '[[색인]]\n', lineEnding: 'lf', updatedAt: 50 },
    }
    await page.route('**/pub/folders/*', (route) => {
      if (/\/pub\/folders\/[^/]+$/.test(route.request().url())) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(folder) })
      }
      return route.continue()
    })
    await page.route('**/pub/folders/*/docs/*', (route) => {
      const doc = docs[new URL(route.request().url()).pathname.split('/').pop()]
      if (!doc) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
    })

    await page.goto('/#/p/f/tokR/pa')
    await expect(page.locator('.public-view-title')).toHaveText('페이지')
    await expect(page.locator('a.wikilink', { hasText: '색인' })).toHaveAttribute('href', '#/p/f/tokR/ia')
  })
})

test.describe('F-2018 B11 공유 메뉴', () => {
  test('본문이 [[교안/1주차]] 뿐이어도 읽기 전용 링크 복사…', async ({ page }) => {
    const server = await fakeServer(page)
    seedCourse(server, '[[교안/1주차]]\n')
    await openApp(page)
    await openDoc(page, 'toc')

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    await expect(page.getByRole('menuitem', { name: '읽기 전용 링크 복사…' })).toBeVisible()
  })
})
