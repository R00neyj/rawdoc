// 휴대폰 폭 서식 바를 키보드 위로 (specs/features/F-2084.md 4장)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow, fakeImeCompose } from './helpers.js'

const BODY = '선택\n\n둘째\n\n셋째\n'

async function blurAll(page) {
  await page.evaluate(() => /** @type {HTMLElement | null} */ (document.activeElement)?.blur())
}

async function editorHasFocus(page) {
  return page.evaluate(() => document.activeElement === document.querySelector('.cm-host .cm-content'))
}

test.describe('F-2084 휴대폰 폭 (390×844, 터치)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('F-2084 E1 포커스 때만 보이고 앱 틀 맨 아래에 붙는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: BODY })
    await blurAll(page)
    await expect(page.locator('.editor-toolbar')).toHaveCount(0)

    await page.locator('.cm-content .cm-line', { hasText: '둘째' }).tap()
    const row = page.locator('.editor-toolbar-row.editor-toolbar-row--docked')
    await expect(row).toBeVisible()
    const layout = await page.evaluate(() => {
      const r = document.querySelector('.editor-toolbar-row--docked').getBoundingClientRect()
      const s = document.querySelector('.statusbar').getBoundingClientRect()
      return { rowTop: r.top, rowBottom: r.bottom, statusBottom: s.bottom, innerHeight: window.innerHeight }
    })
    expect(Math.abs(layout.rowBottom - layout.innerHeight)).toBeLessThanOrEqual(1)
    expect(layout.rowTop).toBeGreaterThanOrEqual(layout.statusBottom - 0.5)

    await page.locator('textarea.doc-title').tap()
    await expect(page.locator('.editor-toolbar')).toHaveCount(0)
  })

  test('F-2084 E2 누르면 포커스 유지, 조합 중 탭은 조합을 먼저 끝낸다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: BODY })
    await page.locator('.cm-content .cm-line', { hasText: '선택' }).tap()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')

    await page.evaluate(() => {
      const w = /** @type {any} */ (window)
      w.__f2084Events = []
      const content = document.querySelector('.cm-host .cm-content')
      content.addEventListener('focusout', () => w.__f2084Events.push('focusout'))
      content.addEventListener('compositionend', (e) => w.__f2084Events.push(`compositionend:${e.data}`))
      document.addEventListener('click', (e) => {
        if (/** @type {Element} */ (e.target).closest('.editor-toolbar-row')) w.__f2084Events.push('click')
      }, true)
    })

    // A3 — 버튼을 눌러도 본문이 blur 되지 않는다
    const row = page.locator('.editor-toolbar-row--docked')
    await row.getByRole('button', { name: '볼드체' }).tap()
    await expect(page.locator('.cm-line').first()).toHaveText('**선택**')
    expect(await page.evaluate(() => /** @type {any} */ (window).__f2084Events)).toEqual(['click'])
    await expect(row).toBeVisible()

    // A3 — 줄의 빈 곳(왼쪽 padding)
    await row.tap({ position: { x: 4, y: 20 } })
    expect(await editorHasFocus(page)).toBe(true)
    await expect(row).toBeVisible()

    // A4 — 조합 중 탭
    await page.locator('.cm-content .cm-line', { hasText: '둘째' }).tap()
    await page.keyboard.press('End')
    await page.evaluate(() => {
      const w = /** @type {any} */ (window)
      w.__f2084Events = []
    })
    await fakeImeCompose(page, '한')
    await expect(page.locator('.cm-line', { hasText: '둘째한' })).toHaveCount(1)
    await row.getByRole('button', { name: '볼드체' }).tap()

    await expect(page.locator('.cm-line', { hasText: '둘째' })).toHaveText('둘째한****')
    const events = await page.evaluate(() => /** @type {any} */ (window).__f2084Events)
    const endAt = events.indexOf('compositionend:한')
    expect(endAt).toBeGreaterThanOrEqual(0)
    expect(endAt).toBeLessThan(events.indexOf('click'))
    await expect.poll(() => editorHasFocus(page)).toBe(true)
  })
})

test.describe('F-2084 601px 이상', () => {
  test('F-2084 E3 601 은 상단 바 밑 줄 그대로, 600 은 포커스 없으면 없음', async ({ page }) => {
    await resizeWindow(page, 601, 900)
    await openApp(page)
    await importMarkdown(page, { content: BODY })
    await blurAll(page)

    const row = page.locator('.editor-toolbar-row')
    await expect(row).toBeVisible()
    await expect(row).not.toHaveClass(/editor-toolbar-row--docked/)
    const afterTopbar = await page.evaluate(
      () => document.querySelector('header.topbar')?.nextElementSibling?.classList.contains('editor-toolbar-row') ?? false,
    )
    expect(afterTopbar).toBe(true)

    await resizeWindow(page, 600, 900)
    await expect(page.locator('.editor-toolbar')).toHaveCount(0)
  })
})
