// 본문 맨 위 제목 (specs/features/F-217.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, resizeWindow, rectOf, setViewMode } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

async function fillTitle(page, text) {
  await page.locator('.doc-title').fill(text)
}

test.describe('F-217 A1 원문 불변', () => {
  test('제목은 .md 내보내기·저장된 content 에 없다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'doc.md', content: '본문 첫 줄\n둘째 줄\n' })
    await fillTitle(page, '내 제목')
    await page.locator('.doc-title').blur()

    const saved = await readSavedContent(page)
    expect(saved.content).toBe('본문 첫 줄\n둘째 줄\n')
    expect(saved.content).not.toContain('내 제목')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '.md 파일로 내보내기' }).click(),
    ])
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf-8')
    expect(text).toBe('본문 첫 줄\n둘째 줄\n')
    expect(download.suggestedFilename()).toBe('내 제목.md')
  })
})

test.describe('F-217 A2 자리', () => {
  test('상단바에 문서 제목 입력이 없고, 본문 맨 위에 제목이 있다 — 편집·원문·보기', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await fillTitle(page, '자리 확인')

    await expect(page.locator('.topbar .doc-title')).toHaveCount(0)
    await expect(page.locator('.cm-content .doc-title')).toHaveValue('자리 확인')

    const titleRect = await rectOf(page.locator('.doc-title'))
    const lineRect = await rectOf(page.locator('.cm-line').first())
    const linePadding = await page.locator('.cm-line').first().evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))
    // 제목 글자 시작 = 본문 첫 글자 시작 (.cm-line 패딩 안쪽, H77)
    expect(Math.abs(titleRect.left - (lineRect.left + linePadding))).toBeLessThanOrEqual(2)

    await setViewMode(page, 'raw')
    await expect(page.locator('.cm-content .doc-title')).toHaveValue('자리 확인')

    await setViewMode(page, 'view')
    await expect(page.locator('.doc-title-view')).toHaveText('자리 확인')
    await expect(page.locator('.topbar .doc-title')).toHaveCount(0)
  })
})

test.describe('F-217 A3 입력·저장', () => {
  test('입력하는 동안 사이드바가 함께 바뀌고, 새로고침 후 유지, 비우고 blur 하면 되돌아간다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await fillTitle(page, '수정된 제목')

    await expect(page.locator('.tree-row').filter({ hasText: '수정된 제목' })).toHaveCount(1)

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(page.locator('.doc-title')).toHaveValue('수정된 제목')

    await fillTitle(page, '   ')
    await page.locator('.doc-title').blur()
    await expect(page.locator('.doc-title')).toHaveValue('제목 없는 문서')
  })
})

test.describe('F-217 A4 키보드', () => {
  test('제목에서 Enter → 본문 맨 앞, 본문 첫 줄에서 ↑ → 제목', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문 내용\n' })

    await page.locator('.doc-title').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('맨앞')
    await expect(page.locator('.cm-content')).toContainText('맨앞본문 내용')

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('ArrowUp')
    await expect(page.locator('.doc-title')).toBeFocused()
  })
})

test.describe('F-217 A5 새 문서', () => {
  test('새 문서 를 누르면 본문 제목에 포커스 + 전체 선택된다', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '새 문서' }).click()
    await expect(page.locator('.doc-title')).toBeFocused()
    const selection = await page.locator('.doc-title').evaluate((el) => ({
      start: el.selectionStart,
      end: el.selectionEnd,
      value: el.value,
    }))
    expect(selection.start).toBe(0)
    expect(selection.end).toBe(selection.value.length)
    expect(selection.value.length).toBeGreaterThan(0)
  })
})

test.describe('F-217 A6 읽기 전용', () => {
  test('보기 권한만 있는 문서는 제목 입력이 막힌다', async ({ page }) => {
    await fakeServer(page)
    const now = Date.now()
    const shared = new Map([
      ['view-doc', { id: 'view-doc', title: '보기 전용 문서', content: '원본 내용', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now }],
    ])

    await page.route(/\/api\/docs\/view-doc$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shared.get('view-doc')) })
    })

    await page.route('**/api/shared', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'view-doc', title: '보기 전용 문서', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now, role: 'view', ownerEmail: 'owner@x.com' },
        ]),
      }),
    )

    await openApp(page)
    await page.getByText('보기 전용 문서').click()
    await expect(page.locator('.doc-title')).toHaveValue('보기 전용 문서')
    await expect(page.locator('.doc-title')).not.toBeEditable()
  })
})

test.describe('F-217 A7 긴 제목', () => {
  test('좁은 창에서 긴 제목은 가로 스크롤 없이 여러 줄로 보인다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await resizeWindow(page, 400)
    const longTitle = '아주 아주 아주 아주 아주 아주 아주 아주 긴 제목이 줄바꿈 되는지 확인합니다'
    await fillTitle(page, longTitle)

    const scrollWidth = await page.evaluate(() => document.scrollingElement.scrollWidth)
    const clientWidth = await page.evaluate(() => document.scrollingElement.clientWidth)
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)

    const box = await page.locator('.doc-title').evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    }))
    expect(box.scrollHeight).toBeGreaterThan(box.lineHeight * 1.5)
  })
})
