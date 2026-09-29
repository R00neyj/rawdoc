// 위키링크 미리보기 (specs/features/F-2044.md 10.2)
import { test, expect } from '@playwright/test'
import { openApp, currentDocId, setViewMode, fakeImeCompose, fakeImeCommit } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const NOT_OPEN_WAIT_MS = 1000 // 열기 지연(500ms)의 두 배 — 부정 확인(안 뜬다)에 쓴다

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

async function openDoc(page, id) {
  await page.evaluate((docId) => {
    location.hash = `#/d/${docId}`
  }, id)
  await expect.poll(() => currentDocId(page)).toBe(id)
  await expect(page.locator('.cm-content')).toBeVisible()
}

// 편집기 포커스를 링크가 아닌 안전한 자리(문서 끝)에 둔다 — 커서가 링크에 닿으면 md-wikilink 표시가 사라진다(c1)
async function focusEditorSafely(page) {
  await page.locator('.cm-line').last().click()
  await page.keyboard.press('Control+End')
}

function editorLink(page, text) {
  return page.locator('.cm-content .md-wikilink').filter({ hasText: new RegExp(`^${text}$`) })
}

const preview = (page) => page.locator('.wiki-preview')

test.describe('F-2044 위키링크 미리보기', () => {
  // .viewer 의 scroll-behavior: smooth 애니메이션 도중 값을 읽지 않도록 끈다
  test.use({ reducedMotion: 'reduce' })

  test('E1·E2·E3·E4·E17 편집·보기 모드에서 뜨고, 원문 모드·끊긴 링크·자기 링크는 안 뜬다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]]\n\n[[없는 문서]]\n\n[[#둘째]] [[A]]\n\n끝줄' })
    seedDoc(server, { id: 'b', title: 'B', content: 'B 문서 본문 고유글' })
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()
    await expect(preview(page)).toContainText('B 문서 본문 고유글')
    await expect(preview(page).locator('.doc-title-view')).toHaveText('B')
    await expect(preview(page)).toHaveAttribute('aria-label', 'B 미리보기')
    await expect(page.locator('.cm-content')).toBeFocused()
    await expect(editorLink(page, 'B')).not.toHaveAttribute('title')
    await page.mouse.move(2, 2, { steps: 8 })
    await expect(preview(page)).toHaveCount(0)

    const missing = page.locator('.cm-content .md-wikilink--missing')
    await missing.hover()
    await page.locator('.cm-content .md-wikilink').filter({ hasText: '#둘째' }).hover()
    await editorLink(page, 'A').hover()
    await page.waitForTimeout(NOT_OPEN_WAIT_MS)
    await expect(preview(page)).toHaveCount(0)
    await expect(missing).toHaveAttribute('title', '새 문서 만들기: 없는 문서')

    await setViewMode(page, 'view')
    await page.locator('.viewer a.wikilink', { hasText: 'B' }).hover()
    await expect(preview(page)).toBeVisible()
    await expect(preview(page)).toContainText('B 문서 본문 고유글')
    await page.mouse.move(2, 2, { steps: 8 })
    await expect(preview(page)).toHaveCount(0)

    await setViewMode(page, 'raw')
    await page.locator('.cm-line', { hasText: '[[B]]' }).hover()
    await page.waitForTimeout(NOT_OPEN_WAIT_MS)
    await expect(preview(page)).toHaveCount(0)
  })

  test('E5·E6·E7·E8·E9 창 안 스크롤, 벗어나면 닫힘, Esc·편집기 스크롤·입력에 닫힘', async ({ page }) => {
    const server = await fakeServer(page)
    const para = (n, label) => Array.from({ length: n }, (_, i) => `${label} ${i + 1}`).join('\n\n')
    seedDoc(server, { id: 'a', title: 'A', content: `[[B]]\n\n${para(80, '줄')}\n\n끝줄` })
    seedDoc(server, { id: 'b', title: 'B', content: para(80, 'B 문서 문단') })
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)
    const editorScroller = page.locator('.cm-scroller')
    await editorScroller.evaluate((el) => {
      el.scrollTop = 0
    })

    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()
    const box = await preview(page).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 })
    await expect(preview(page)).toBeVisible()
    await page.mouse.wheel(0, 300)
    await expect.poll(() => preview(page).locator('.viewer').evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    expect(await editorScroller.evaluate((el) => el.scrollTop)).toBe(0)

    await page.mouse.move(2, 2, { steps: 8 })
    await expect(preview(page)).toHaveCount(0)

    await page.keyboard.press('Control+f')
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(1)
    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(preview(page)).toHaveCount(0)
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(1)
    await page.waitForTimeout(NOT_OPEN_WAIT_MS)
    await expect(preview(page)).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.mouse.move(2, 2, { steps: 8 })
    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()
    await page.mouse.wheel(0, 300)
    await expect(preview(page)).toHaveCount(0)

    await editorScroller.evaluate((el) => {
      el.scrollTop = 0
    })
    await page.mouse.move(2, 2, { steps: 8 })
    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()
    await page.keyboard.type('x')
    await expect(preview(page)).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('끝줄x')
  })

  test('E10·E11·E12·E16·E18 창 안 링크 해석·중첩 없음·바깥 링크·긴 문서 잘림·제목 스크롤', async ({ page, context }) => {
    test.slow()
    const server = await fakeServer(page)
    const filler = Array.from({ length: 60 }, (_, i) => `줄 ${i + 1}`).join('\n\n')
    const afterHeading = Array.from({ length: 20 }, (_, i) => `뒤 ${i + 1}`).join('\n\n')
    seedFolder(server, { id: 'f1', name: '교안' })
    seedFolder(server, { id: 'f2', name: '과제' })
    seedDoc(server, { id: 'w1', title: '1주차', content: '교안 1주차 본문', folderId: 'f1', age: 100_000 })
    seedDoc(server, { id: 'w2', title: '1주차', content: '과제 1주차 본문', folderId: 'f2', age: 0 })
    seedDoc(server, { id: 'b', title: 'B', content: '[[1주차]]\n\n[바깥](https://example.com/)', folderId: 'f1' })
    seedDoc(server, { id: 'h', title: '헤딩문서', content: `${filler}\n\n## 둘째\n\n둘째 아래 고유글\n\n${afterHeading}` })
    seedDoc(server, { id: 'l', title: '긴문서', content: 'ㄱ'.repeat(30_000) })
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]]\n\n[[헤딩문서#둘째]]\n\n[[긴문서]]\n\n끝줄' })
    await page.route('https://example.com/**', (route) => route.abort())
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()
    await preview(page).getByText('1주차').hover()
    await page.waitForTimeout(NOT_OPEN_WAIT_MS)
    await expect(preview(page)).toHaveCount(1)
    await page.mouse.move(page.viewportSize().width - 4, 4, { steps: 8 })
    await expect(preview(page)).toHaveCount(0)

    await editorLink(page, '헤딩문서#둘째').hover()
    await expect(preview(page)).toContainText('둘째 아래 고유글')
    const viewer = preview(page).locator('.viewer')
    await expect.poll(() => viewer.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    const headingBox = await preview(page).locator('h2', { hasText: '둘째' }).boundingBox()
    const viewerBox = await viewer.boundingBox()
    expect(headingBox.y - viewerBox.y).toBeLessThan(60)
    await page.mouse.move(page.viewportSize().width - 4, 4, { steps: 8 })
    await expect(preview(page)).toHaveCount(0)

    await editorLink(page, '긴문서').hover()
    await expect(preview(page)).toContainText('문서가 길어 앞부분만 보여 줍니다.')
    await preview(page).getByRole('button', { name: '문서 열기' }).click()
    await expect.poll(() => currentDocId(page)).toBe('l')
    await expect(preview(page)).toHaveCount(0)

    await openDoc(page, 'a')
    await focusEditorSafely(page)
    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()
    await preview(page).getByText('1주차').click()
    await expect.poll(() => currentDocId(page)).toBe('w1')
    await expect(preview(page)).toHaveCount(0)

    await openDoc(page, 'a')
    await focusEditorSafely(page)
    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()
    const [newPage] = await Promise.all([context.waitForEvent('page'), preview(page).getByText('바깥').click()])
    await newPage.close()
    await expect(preview(page)).toHaveCount(0)
  })
})

test.describe('F-2044 E13 설정에서 끄기', () => {
  test('숨김으로 바꾸면 안 뜨고, title 이 돌아오고, 새로고침 뒤에도 유지된다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]]\n\n끝줄' })
    seedDoc(server, { id: 'b', title: 'B', content: 'B 문서 본문' })
    await openApp(page)
    await openDoc(page, 'a')

    await page.getByRole('button', { name: '설정', exact: true }).click()
    await page.getByRole('radio', { name: '숨김' }).last().click()
    await page.getByRole('button', { name: '닫기', exact: true }).click()

    await focusEditorSafely(page)
    await editorLink(page, 'B').hover()
    await page.waitForTimeout(NOT_OPEN_WAIT_MS)
    await expect(preview(page)).toHaveCount(0)
    await expect(editorLink(page, 'B')).toHaveAttribute('title', 'B')

    expect(await page.evaluate(() => localStorage.getItem('md.wikiPreview'))).toBe('off')

    await page.reload()
    await page.getByRole('button', { name: '설정', exact: true }).click()
    await expect(page.getByRole('radio', { name: '숨김' }).last()).toHaveAttribute('aria-checked', 'true')
  })
})

test.describe('F-2044 E14 터치는 띄우지 않고 기존처럼 연다', () => {
  test.use({ hasTouch: true })

  test('탭은 창을 안 띄우고 문서를 연다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]]\n\n끝줄' })
    seedDoc(server, { id: 'b', title: 'B', content: 'B 문서 본문' })
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    await editorLink(page, 'B').tap()
    await expect(preview(page)).toHaveCount(0)
    await expect.poll(() => currentDocId(page)).toBe('b')
  })
})

test.describe('F-2044 E15 공유받은 문서는 안내만, 본문을 읽지 않는다', () => {
  test('hover 동안 GET /api/docs/S 요청이 없다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'a', title: 'A', content: '[[공유문서]]\n\n끝줄' })
    const now = Date.now()
    let getCount = 0
    await page.route(/\/api\/docs\/shared-1$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      getCount += 1
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'shared-1',
          title: '공유문서',
          content: '공유 본문',
          lineEnding: 'lf',
          folderId: null,
          pinnedAt: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        }),
      })
    })
    await page.route('**/api/shared', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'shared-1', title: '공유문서', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now, role: 'view', ownerEmail: 'owner@x.com' },
        ]),
      }),
    )
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    await editorLink(page, '공유문서').hover()
    await expect(preview(page)).toBeVisible()
    await expect(preview(page)).toContainText('공유받은 문서는 열어야 볼 수 있습니다.')
    expect(getCount).toBe(0)
  })
})

test.describe('F-2044 E19 IME 조합과 부딪히지 않는다', () => {
  test('조합 시작에 닫히고, 조합 중에는 다시 안 뜨고, 커밋 뒤 글자가 들어간다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]] [[C]]\n\n끝줄' })
    seedDoc(server, { id: 'b', title: 'B', content: 'B 문서 본문' })
    seedDoc(server, { id: 'c', title: 'C', content: 'C 문서 본문' })
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()

    const cdp = await fakeImeCompose(page, 'ㅎ')
    await expect(preview(page)).toHaveCount(0)

    await editorLink(page, 'C').hover()
    await page.waitForTimeout(NOT_OPEN_WAIT_MS)
    await expect(preview(page)).toHaveCount(0)

    await fakeImeCommit(cdp, 'ㅎ')
    await expect(page.locator('.cm-content')).toContainText('ㅎ')
  })
})
