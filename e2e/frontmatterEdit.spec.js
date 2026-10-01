// 편집 모드 프론트매터 값 칸 편집 (specs/features/F-2113.md 7장)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, fakeImeCompose, fakeImeCommit } from './helpers.js'
import { joinPages, newLinkedPage, portHolding, relay, waitPortFor } from './fixtures/yLinkHook.js'

function valueCell(page, index) {
  return page.locator(`.md-frontmatter-widget .md-frontmatter-value[data-cell="${index}"]`)
}

function editingCells(page) {
  return page.locator('.md-frontmatter-value-editing')
}

function editingText(page) {
  return page.locator('.md-frontmatter-value-editing .cm-content')
}

// 값 칸 하위 에디터는 주 에디터 .cm-content 안에 있다 — 문서 순서상 첫 번째가 주 에디터다
function mainLines(page) {
  return page.locator('.cm-content').first()
}

// remoteGate.spec.js 의 openLinked 와 같다 — 두 컨텍스트에 같은 본문을 가져오고 B 가 A 를 입양한다
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

async function savedContent(side) {
  return (await readSavedContent(side.page, side.docId))?.content ?? null
}

test('F-2113 A5 값 칸 편집 — 바뀐 구간만 쓰고 Enter 로 본문 첫 줄', async ({ page }) => {
  await openApp(page)
  const docId = await importMarkdown(page, { content: '---\n과목: 웹\n차시: "3" # 메모\ntags:\n  - a\n---\n본문\n' })

  await expect(valueCell(page, 1)).toHaveText('"3" # 메모')

  await valueCell(page, 0).click()
  await expect(editingCells(page)).toHaveCount(1)
  await expect(editingText(page)).toHaveText('웹')
  await page.keyboard.type('앱')
  await page.keyboard.press('Enter')
  await expect(editingCells(page)).toHaveCount(0)
  await page.keyboard.type('Z')

  expect((await readSavedContent(page, docId)).content).toBe('---\n과목: 웹앱\n차시: "3" # 메모\ntags:\n  - a\n---\nZ본문\n')

  await valueCell(page, 1).click()
  await expect(editingText(page)).toHaveText('"3" # 메모')
  await page.keyboard.press('Escape')
  await expect(editingCells(page)).toHaveCount(0)
  expect((await readSavedContent(page, docId)).content).toBe('---\n과목: 웹앱\n차시: "3" # 메모\ntags:\n  - a\n---\nZ본문\n')
})

test('F-2113 A6 값 칸 조합 중 원격 보류·같은 칸 원격은 세션 종료', async ({ browser, baseURL }) => {
  test.setTimeout(90000)
  const DOC = '---\n과목: 웹\n---\n본문\n\n끝\n'

  await test.step('F-2113 A6① 값 칸 조합 중 본문 원격 — 보류, 확정 뒤 반영, 편집은 그대로', async () => {
    const { a, b, close } = await openLinked(browser, baseURL, DOC)
    try {
      await valueCell(a.page, 0).click()
      await expect(editingCells(a.page)).toHaveCount(1)
      const cdp = await fakeImeCompose(a.page, '한')
      await expect(editingText(a.page)).toContainText('웹한')

      await b.page.locator('.cm-content .cm-line', { hasText: '끝' }).first().click()
      await b.page.keyboard.press('End')
      await b.page.keyboard.type('OUT')
      await relay(b.page, a.page)
      expect(await portHolding(a.page)).toBe(true)
      expect(await mainLines(a.page).textContent()).not.toContain('OUT')
      await expect(editingCells(a.page)).toHaveCount(1)

      await fakeImeCommit(cdp, '한')
      await expect(mainLines(a.page)).toContainText('OUT')
      await expect(editingCells(a.page)).toHaveCount(1)
      await expect.poll(() => savedContent(a), { timeout: 10_000 }).toContain('과목: 웹한\n')
    } finally {
      await close()
    }
  })

  await test.step('F-2113 A6② 같은 칸을 원격이 고치면 편집 세션이 끝나고 두 편집이 남는다', async () => {
    const { a, b, close } = await openLinked(browser, baseURL, DOC)
    try {
      await valueCell(a.page, 0).click()
      await a.page.keyboard.type('x')
      await relay(a.page, b.page)

      await expect(valueCell(b.page, 0)).toHaveText('웹x')
      await valueCell(b.page, 0).click()
      await b.page.keyboard.type('q')
      await relay(b.page, a.page)

      await expect(editingCells(a.page)).toHaveCount(0)
      await expect.poll(() => savedContent(a), { timeout: 10_000 }).toContain('과목: 웹xq\n')
    } finally {
      await close()
    }
  })
})

test('F-2113 A7 목록 항목 칸·Tab·Shift+Tab·Esc', async ({ page }) => {
  await openApp(page)
  const docId = await importMarkdown(page, { content: '---\ntags:\n  - a\n  - b\nc: 1\n---\n본문\n' })

  await valueCell(page, 1).click()
  await page.keyboard.type('2')
  await page.keyboard.press('Tab')
  await expect(page.locator('.md-frontmatter-value-editing[data-cell="2"]')).toHaveCount(1)
  await page.keyboard.type('9')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(page.locator('.md-frontmatter-value-editing[data-cell="0"]')).toHaveCount(1)
  await page.keyboard.type('0')
  await page.keyboard.press('Escape')
  await expect(editingCells(page)).toHaveCount(0)
  await page.keyboard.type('Y')

  const { content } = await readSavedContent(page, docId)
  expect(content).toContain('  - a0\n  - b2\nc: 19')
  expect(content).toContain('---\nY본문')
})
