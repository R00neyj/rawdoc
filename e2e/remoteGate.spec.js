// IME × 원격 업데이트 게이트 — 테스트가 두 페이지 사이를 직접 중계한다 (specs/features/F-303.md 13.2)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, fakeImeCompose, fakeImeCommit } from './helpers.js'
import { joinPages, newLinkedPage, portHolding, portSharedText, relay, waitPortFor } from './fixtures/yLinkHook.js'

// 표가 첫 줄이면 가져온 직후 커서(0)가 표 안이라 위젯이 아닌 원문으로 보인다 — table.spec.js 의 LEAD 와 같은 이유
const LEAD = '표\n\n'
const TABLE = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'

// 두 컨텍스트에 같은 본문을 가져오고 B 가 A 를 입양한다
async function openLinked(browser, baseURL, content) {
  const sides = []
  for (let i = 0; i < 2; i++) {
    const side = await newLinkedPage(browser, baseURL)
    await openApp(side.page)
    side.docId = await importMarkdown(side.page, { name: '연결.md', content })
    await waitPortFor(side.page, side.docId)
    sides.push(side)
  }
  const [a, b] = sides
  expect(await joinPages(a.page, b.page)).toBe(true)
  return {
    a,
    b,
    async close() {
      await a.context.close()
      await b.context.close()
    },
  }
}

async function clickLineEnd(page, text) {
  await page.locator('.cm-content .cm-line', { hasText: text }).first().click()
  await page.keyboard.press('End')
}

async function savedContent(side) {
  return (await readSavedContent(side.page, side.docId))?.content ?? null
}

async function expectSavedFirstLine(side, expected) {
  await expect.poll(async () => (await savedContent(side))?.split('\n')[0], { timeout: 10_000 }).toBe(expected)
}

async function expectSameSaved(a, b) {
  await expect
    .poll(async () => {
      const [x, y] = [await savedContent(a), await savedContent(b)]
      return x === y ? 'same' : `A=${JSON.stringify(x)} B=${JSON.stringify(y)}`
    }, { timeout: 10_000 })
    .toBe('same')
}

// 표 칸 하위 에디터도 .cm-content 를 가진다 — 문서 순서상 첫 번째가 주 에디터다
function mainContent(page) {
  return page.locator('.cm-content').first()
}

function cell(page, row, col) {
  return page.locator(`.md-table-widget td[data-row="${row}"][data-col="${col}"]`)
}

test.describe('F-303 IME 게이트', () => {
  test('F-303 A17 조합 중 원격은 보류되고 확정하면 한 번에 보인다', async ({ browser, baseURL }) => {
    const { a, b, close } = await openLinked(browser, baseURL, '첫 줄\n')
    try {
      await clickLineEnd(a.page, '첫 줄')
      const cdp = await fakeImeCompose(a.page, '한')
      await expect(mainContent(a.page)).toContainText('첫 줄한')

      await clickLineEnd(b.page, '첫 줄')
      await b.page.keyboard.type('BBB')
      await relay(b.page, a.page)
      expect(await mainContent(a.page).textContent()).not.toContain('BBB')
      expect(await portHolding(a.page)).toBe(true)
      expect(await portSharedText(a.page)).toContain('BBB')

      await fakeImeCommit(cdp, '한')
      await expect(mainContent(a.page)).toContainText('BBB')
      await expect(mainContent(a.page)).toContainText('한')
      expect(await portHolding(a.page)).toBe(false)

      await relay(a.page, b.page)
      await expectSameSaved(a, b)
      expect(await savedContent(a)).toContain('한')
      expect(await savedContent(a)).toContain('BBB')
    } finally {
      await close()
    }
  })

  test('F-303 A18 조합 중 내 커서 앞 원격 — 내 글자는 제자리', async ({ browser, baseURL }) => {
    const { a, b, close } = await openLinked(browser, baseURL, '가나다라\n')
    try {
      await a.page.locator('.cm-content .cm-line', { hasText: '가나다라' }).first().click()
      await a.page.keyboard.press('Home')
      await a.page.keyboard.press('ArrowRight')
      await a.page.keyboard.press('ArrowRight')
      const cdp = await fakeImeCompose(a.page, '마')
      await expect(mainContent(a.page)).toContainText('가나마다라')

      await b.page.locator('.cm-content .cm-line', { hasText: '가나다라' }).first().click()
      await b.page.keyboard.press('Home')
      await b.page.keyboard.type('XY')
      await relay(b.page, a.page)
      expect(await portHolding(a.page)).toBe(true)

      await fakeImeCommit(cdp, '마')
      await expectSavedFirstLine(a, 'XY가나마다라')
    } finally {
      await close()
    }
  })

  test('F-303 A19 조합이 아니면 원격이 곧바로 보인다', async ({ browser, baseURL }) => {
    const { a, b, close } = await openLinked(browser, baseURL, '첫 줄\n')
    try {
      await clickLineEnd(b.page, '첫 줄')
      await b.page.keyboard.type('CCC')
      await relay(b.page, a.page)
      expect(await mainContent(a.page).textContent()).toContain('CCC')
    } finally {
      await close()
    }
  })

  test('F-303 A20 초점을 잃은 조합은 점검 타이머에서 비운다', async ({ browser, baseURL }) => {
    const { a, b, close } = await openLinked(browser, baseURL, '첫 줄\n')
    try {
      await clickLineEnd(a.page, '첫 줄')
      const cdp = await fakeImeCompose(a.page, '하')
      await expect(mainContent(a.page)).toContainText('첫 줄하')

      await b.page.locator('.cm-content').click()
      await b.page.keyboard.press('Control+End')
      await b.page.keyboard.type('DDD')
      await relay(b.page, a.page)
      expect(await portHolding(a.page)).toBe(true)

      await a.page.evaluate(() => {
        document.hasFocus = () => false
      })
      await expect(mainContent(a.page)).toContainText('DDD', { timeout: 5_000 })
      expect(await portHolding(a.page)).toBe(false)
      await fakeImeCommit(cdp, '하')
    } finally {
      await close()
    }
  })

  test('F-303 A21 조합이 아니라는 키 입력이 오면 곧바로 비운다', async ({ browser, baseURL }) => {
    const { a, b, close } = await openLinked(browser, baseURL, '첫 줄\n')
    try {
      await clickLineEnd(a.page, '첫 줄')
      const cdp = await fakeImeCompose(a.page, '하')
      await expect(mainContent(a.page)).toContainText('첫 줄하')

      await b.page.locator('.cm-content').click()
      await b.page.keyboard.press('Control+End')
      await b.page.keyboard.type('EEE')
      await relay(b.page, a.page)
      expect(await portHolding(a.page)).toBe(true)

      await mainContent(a.page).dispatchEvent('keydown', { key: 'Shift' })
      await expect(mainContent(a.page)).toContainText('EEE', { timeout: 1_000 })
      await fakeImeCommit(cdp, '하')
    } finally {
      await close()
    }
  })

  test('F-303 A22 표 칸 편집 중 같은 표 다른 칸 원격 — 편집은 그대로', async ({ browser, baseURL }) => {
    const { a, b, close } = await openLinked(browser, baseURL, `${LEAD}${TABLE}`)
    try {
      await cell(a.page, 1, 0).click()
      await a.page.keyboard.press('End')
      await a.page.keyboard.type('x')

      await cell(b.page, 1, 1).click()
      await b.page.keyboard.press('End')
      await b.page.keyboard.type('y')
      await relay(b.page, a.page)

      await expect(a.page.locator('.md-table-cell-editing[data-row="1"][data-col="0"]')).toHaveCount(1)
      await expect(cell(a.page, 1, 1)).toHaveText('2y')
      await a.page.keyboard.type('z')

      await expect.poll(() => savedContent(a), { timeout: 10_000 }).toContain('| 1xz |')
      expect(await savedContent(a)).toContain('| 2y |')
    } finally {
      await close()
    }
  })

  test('F-303 A23 표 칸 편집 중 그 칸을 원격이 고치면 편집 세션이 끝나고 두 편집이 남는다', async ({
    browser,
    baseURL,
  }) => {
    const { a, b, close } = await openLinked(browser, baseURL, `${LEAD}${TABLE}`)
    try {
      await cell(a.page, 1, 0).click()
      await a.page.keyboard.press('End')
      await a.page.keyboard.type('x')
      await relay(a.page, b.page)

      await expect(cell(b.page, 1, 0)).toHaveText('1x')
      await cell(b.page, 1, 0).click()
      await b.page.keyboard.press('End')
      await b.page.keyboard.type('q')
      await relay(b.page, a.page)

      await expect(a.page.locator('.md-table-cell-editing')).toHaveCount(0)
      await expect.poll(() => savedContent(a), { timeout: 10_000 }).toContain('| 1xq |')
    } finally {
      await close()
    }
  })

  test('F-303 A24 표 칸 조합 중 표 밖 원격 — 보류, 확정 뒤 반영, 편집은 그대로', async ({ browser, baseURL }) => {
    // 빈 줄 없이 붙이면 GFM 이 `끝` 을 표의 행으로 읽는다 — 표 밖이 되게 한 줄 띄운다
    const { a, b, close } = await openLinked(browser, baseURL, `${LEAD}${TABLE}\n끝\n`)
    try {
      await cell(a.page, 1, 0).click()
      await expect(a.page.locator('.md-table-cell-editing[data-row="1"][data-col="0"]')).toHaveCount(1)
      const cdp = await fakeImeCompose(a.page, '한')
      await expect(cell(a.page, 1, 0)).toContainText('한')

      await clickLineEnd(b.page, '끝')
      await b.page.keyboard.type('OUT')
      await relay(b.page, a.page)
      expect(await portHolding(a.page)).toBe(true)
      expect(await mainContent(a.page).textContent()).not.toContain('OUT')
      await expect(a.page.locator('.md-table-cell-editing')).toHaveCount(1)

      await fakeImeCommit(cdp, '한')
      await expect(mainContent(a.page)).toContainText('OUT')
      await expect(a.page.locator('.md-table-cell-editing[data-row="1"][data-col="0"]')).toHaveCount(1)
    } finally {
      await close()
    }
  })

  test('F-303 A25 원격이 섞인 뒤 Ctrl+Z 는 내 편집만 되돌린다', async ({ browser, baseURL }) => {
    const { a, b, close } = await openLinked(browser, baseURL, '본문\n')
    try {
      await clickLineEnd(a.page, '본문')
      await a.page.keyboard.type('abc')
      await relay(a.page, b.page)

      await b.page.locator('.cm-content .cm-line', { hasText: '본문abc' }).first().click()
      await b.page.keyboard.press('Home')
      await b.page.keyboard.type('R')
      await relay(b.page, a.page)

      await a.page.locator('.cm-content .cm-line', { hasText: 'R본문abc' }).first().click()
      await a.page.keyboard.press('Control+z')
      await expectSavedFirstLine(a, 'R본문')
      await relay(a.page, b.page)
      await expectSavedFirstLine(b, 'R본문')
    } finally {
      await close()
    }
  })

  test('F-303 A26 훅이 없으면 연결이 없다', async ({ page }) => {
    await openApp(page)
    expect(await page.evaluate(() => window.__yPort)).toBeUndefined()
  })
})
