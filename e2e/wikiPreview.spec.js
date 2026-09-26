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

// 미리보기 창에 가리지 않는, 창 바로 아래 안전한 지점(링크·창 둘 다 아님)
async function pointBelowPreview(page) {
  const box = await preview(page).boundingBox()
  return { x: box.x + 20, y: box.y + box.height + 40 }
}

test.describe('F-2044 E1~E2 편집·보기 모드에서 뜬다', () => {
  test('E1 편집 모드 — 있는 문서 위키링크 hover 로 뜨고, 편집기 포커스를 잃지 않는다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]]\n\n끝줄' })
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
  })

  test('E2 보기 모드 — 같다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]]\n\n끝줄' })
    seedDoc(server, { id: 'b', title: 'B', content: 'B 문서 본문 고유글' })
    await openApp(page)
    await openDoc(page, 'a')
    await setViewMode(page, 'view')

    await page.locator('.viewer a.wikilink').hover()
    await expect(preview(page)).toBeVisible()
    await expect(preview(page)).toContainText('B 문서 본문 고유글')
    await expect(preview(page).locator('.doc-title-view')).toHaveText('B')
  })
})

test.describe('F-2044 E3 원문 모드에는 없다', () => {
  test('원문 모드 위키링크 글자 위로 hover 해도 창이 없다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]]\n\n끝줄' })
    seedDoc(server, { id: 'b', title: 'B', content: 'B 문서 본문' })
    await openApp(page)
    await openDoc(page, 'a')
    await setViewMode(page, 'raw')

    await page.locator('.cm-line', { hasText: '[[B]]' }).hover()
    await page.waitForTimeout(NOT_OPEN_WAIT_MS)
    await expect(preview(page)).toHaveCount(0)
  })
})

test.describe('F-2044 E4 끊긴 링크는 안 뜨고 title 툴팁을 유지한다', () => {
  test('없는 문서 링크는 기존 title, 있는 문서 링크는 title 이 없다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'a', title: 'A', content: '[[없는 문서]]\n\n[[다른 문서]]\n\n끝줄' })
    seedDoc(server, { id: 'c', title: '다른 문서', content: '다른 문서 본문' })
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    const missing = page.locator('.cm-content .md-wikilink--missing')
    await missing.hover()
    await page.waitForTimeout(NOT_OPEN_WAIT_MS)
    await expect(preview(page)).toHaveCount(0)
    await expect(missing).toHaveAttribute('title', '새 문서 만들기: 없는 문서')

    const existing = editorLink(page, '다른 문서')
    await expect(existing).not.toHaveAttribute('title')
  })
})

test.describe('F-2044 E5~E6 미리보기 안 스크롤·바깥으로 나가면 닫힘', () => {
  test('E5 미리보기 안에서 휠 스크롤은 그 안만 움직인다', async ({ page }) => {
    const server = await fakeServer(page)
    const longBody = Array.from({ length: 80 }, (_, i) => `B 문서 문단 ${i + 1}`).join('\n\n')
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]]\n\n끝줄' })
    seedDoc(server, { id: 'b', title: 'B', content: longBody })
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    const link = editorLink(page, 'B')
    await link.hover()
    await expect(preview(page)).toBeVisible()

    const box = await preview(page).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 })
    await expect(preview(page)).toBeVisible()
    await page.mouse.wheel(0, 300)

    await expect
      .poll(() => preview(page).locator('.viewer').evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0)
    await expect(page.locator('.cm-scroller').evaluate((el) => el.scrollTop)).resolves.toBe(0)
  })

  test('E6 링크·미리보기 둘 다 벗어나면 닫힌다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]]\n\n끝줄' })
    seedDoc(server, { id: 'b', title: 'B', content: 'B 문서 본문' })
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()

    const pt = await pointBelowPreview(page)
    await page.mouse.move(pt.x, pt.y, { steps: 8 })
    await expect(preview(page)).toHaveCount(0)
  })
})

test.describe('F-2044 E7 Esc 로 닫고 다시 뜨지 않는다', () => {
  test('Esc 는 미리보기만 닫고, 편집기 찾기 패널은 첫 Esc 에 남는다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]]\n\n끝줄' })
    seedDoc(server, { id: 'b', title: 'B', content: 'B 문서 본문' })
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    await page.keyboard.press('Control+f')
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(1)

    const link = editorLink(page, 'B')
    await link.hover()
    await expect(preview(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(preview(page)).toHaveCount(0)
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(1)

    await page.waitForTimeout(NOT_OPEN_WAIT_MS)
    await expect(preview(page)).toHaveCount(0)
  })
})

test.describe('F-2044 E8~E9 스크롤·입력에 닫힌다', () => {
  test('E8 편집기 스크롤이면 닫힌다', async ({ page }) => {
    const server = await fakeServer(page)
    const longBody = Array.from({ length: 80 }, (_, i) => `줄 ${i + 1}`).join('\n\n')
    seedDoc(server, { id: 'a', title: 'A', content: `[[B]]\n\n${longBody}` })
    seedDoc(server, { id: 'b', title: 'B', content: 'B 문서 본문' })
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)
    // focusEditorSafely 가 Control+End 로 맨 끝까지 스크롤해 [[B]] 가 가상화로 사라진다 — 되돌린다
    await page.locator('.cm-scroller').evaluate((el) => {
      el.scrollTop = 0
    })

    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()

    // 포인터는 링크 위 그대로 — 스크롤 자체가 닫는 이유임을 확인한다(떠나서가 아니라)
    await page.mouse.wheel(0, 300)
    await expect(preview(page)).toHaveCount(0)
  })

  test('E9 편집기 포커스 상태에서 글자를 치면 닫히고, 그 글자는 본문에 들어간다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]]\n\n끝줄' })
    seedDoc(server, { id: 'b', title: 'B', content: 'B 문서 본문' })
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()

    await page.keyboard.type('x')
    await expect(preview(page)).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('끝줄x')
  })
})

test.describe('F-2044 E10~E12 미리보기 안에서 누르기', () => {
  async function seedCourse(server) {
    seedFolder(server, { id: 'f1', name: '교안' })
    seedFolder(server, { id: 'f2', name: '과제' })
    seedDoc(server, { id: 'w1', title: '1주차', content: '교안 1주차 본문', folderId: 'f1', age: 100_000 })
    seedDoc(server, { id: 'w2', title: '1주차', content: '과제 1주차 본문', folderId: 'f2', age: 0 })
    seedDoc(server, { id: 'b', title: 'B', content: '[[1주차]]', folderId: 'f1' })
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]]\n\n끝줄', folderId: null })
  }

  test('E10 창 안 링크를 누르면 미리보기 문서 기준으로 해석해 그 문서를 연다', async ({ page }) => {
    const server = await fakeServer(page)
    await seedCourse(server)
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()

    await preview(page).getByText('1주차').click()
    await expect.poll(() => currentDocId(page)).toBe('w1')
    await expect(preview(page)).toHaveCount(0)
  })

  test('E11 창 안 위키링크는 hover 해도 중첩 미리보기가 뜨지 않는다', async ({ page }) => {
    const server = await fakeServer(page)
    await seedCourse(server)
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()

    await preview(page).getByText('1주차').hover()
    await page.waitForTimeout(NOT_OPEN_WAIT_MS)
    await expect(preview(page)).toHaveCount(1)
    await expect(preview(page)).toContainText('1주차')
  })

  test('E12 바깥 링크는 새 탭으로 열리고 창은 닫힌다', async ({ page, context }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]]\n\n끝줄' })
    seedDoc(server, { id: 'b', title: 'B', content: '[바깥](https://example.com/)' })
    await page.route('https://example.com/**', (route) => route.abort())
    await openApp(page)
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

test.describe('F-2044 E16 긴 문서는 잘리고 문서 열기로 이어진다', () => {
  test('잘림 안내와 문서 열기 버튼이 있고, 누르면 그 문서가 열린다', async ({ page }) => {
    const server = await fakeServer(page)
    const longBody = 'ㄱ'.repeat(30_000)
    seedDoc(server, { id: 'a', title: 'A', content: '[[B]]\n\n끝줄' })
    seedDoc(server, { id: 'b', title: 'B', content: longBody })
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    await editorLink(page, 'B').hover()
    await expect(preview(page)).toBeVisible()
    await expect(preview(page)).toContainText('문서가 길어 앞부분만 보여 줍니다.')

    await preview(page).getByRole('button', { name: '문서 열기' }).click()
    await expect.poll(() => currentDocId(page)).toBe('b')
    await expect(preview(page)).toHaveCount(0)
  })
})

test.describe('F-2044 E17 끊긴 링크·자기 자신은 안 뜬다', () => {
  test('[[#헤딩]] 과 자기 자신 제목 링크는 hover 해도 창이 없다', async ({ page }) => {
    const server = await fakeServer(page)
    seedDoc(server, { id: 'a', title: 'A', content: '[[#둘째]] [[A]]\n\n끝줄' })
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    await page.locator('.cm-content .md-wikilink').filter({ hasText: '#둘째' }).hover()
    await page.waitForTimeout(NOT_OPEN_WAIT_MS)
    await expect(preview(page)).toHaveCount(0)

    await editorLink(page, 'A').hover()
    await page.waitForTimeout(NOT_OPEN_WAIT_MS)
    await expect(preview(page)).toHaveCount(0)
  })
})

test.describe('F-2044 E18 [[문서#제목]] 은 그 제목이 창 맨 위로 오도록 스크롤한다', () => {
  // .viewer 의 scroll-behavior: smooth 애니메이션 도중 값을 읽지 않도록 끈다(transition.spec.js·map.spec.js 와 같은 방식)
  test.use({ reducedMotion: 'reduce' })

  test('창 안 스크롤이 그 제목 근처로 맞춰진다', async ({ page }) => {
    const server = await fakeServer(page)
    const filler = Array.from({ length: 60 }, (_, i) => `줄 ${i + 1}`).join('\n\n')
    // 제목 뒤에도 미리보기 창 높이만큼 스크롤할 여지가 있어야 제목이 맨 위까지 올라간다(스크롤 최댓값에 막히지 않게)
    const afterHeading = Array.from({ length: 20 }, (_, i) => `뒤 ${i + 1}`).join('\n\n')
    const bBody = `${filler}\n\n## 둘째\n\n둘째 아래 고유글\n\n${afterHeading}`
    seedDoc(server, { id: 'a', title: 'A', content: '[[B#둘째]]\n\n끝줄' })
    seedDoc(server, { id: 'b', title: 'B', content: bBody })
    await openApp(page)
    await openDoc(page, 'a')
    await focusEditorSafely(page)

    await editorLink(page, 'B#둘째').hover()
    await expect(preview(page)).toBeVisible()
    await expect(preview(page)).toContainText('둘째 아래 고유글')

    const viewerLocator = preview(page).locator('.viewer')
    await expect.poll(() => viewerLocator.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

    const headingBox = await preview(page).locator('h2', { hasText: '둘째' }).boundingBox()
    const viewerBox = await viewerLocator.boundingBox()
    expect(headingBox.y - viewerBox.y).toBeLessThan(60)
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
