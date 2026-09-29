// 보기 모드 문서 안 찾기 (specs/features/F-2087.md 10.2) — 색·간격은 판정하지 않는다
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode, fakeSoftKeyboard, setPrefBeforeLoad } from './helpers.js'

const DOC = [
  '문단 사과 하나',
  '',
  '| 항목 | 값 |',
  '| --- | --- |',
  '| 표 | 사과 |',
  '',
  '```',
  '코드 사과',
  '```',
  '',
  '**사과**를 먹는다',
  '',
  '바나나도 있다',
  '',
].join('\n')

const card = (page) => page.locator('.view-find')
const field = (page) => page.locator('.view-find input[name="search"]')
const count = (page) => page.locator('.view-find .view-find-count')
const highlightSize = (page, name) => page.evaluate((n) => CSS.highlights.get(n)?.size ?? 0, name)

test.describe('F-2087 보기 모드 찾기', () => {
  test('F-2087 E1 보기 모드 Ctrl+F 로 찾고 다음·닫기, 지도에서는 가로채지 않음', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await openApp(page)
    await importMarkdown(page, { content: DOC })
    await setViewMode(page, 'view')
    await page.locator('.viewer:not(.print-root)').click({ position: { x: 5, y: 5 } })
    await page.evaluate(() => {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'f') document.documentElement.dataset.findPrevented = String(e.defaultPrevented)
      })
    })
    await page.keyboard.press('Control+f')
    expect(await page.evaluate(() => document.documentElement.dataset.findPrevented)).toBe('true')
    await expect(field(page)).toBeFocused()
    await page.keyboard.type('사과')
    await expect(count(page)).toHaveText('1/4')
    await page.keyboard.press('Enter')
    await expect(count(page)).toHaveText('2/4')
    expect(await highlightSize(page, 'view-find-match')).toBe(4)
    expect(await page.evaluate(() => [...CSS.highlights.get('view-find-current')][0].toString())).toBe('사과')

    await page.keyboard.press('Escape')
    await expect(card(page)).toHaveCount(0)
    expect(await page.evaluate(() => CSS.highlights.has('view-find-match') || CSS.highlights.has('view-find-current'))).toBe(false)
    expect(await page.evaluate(() => document.activeElement?.classList.contains('viewer'))).toBe(true)
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(0)

    await page.getByRole('button', { name: '지도' }).first().click()
    await expect(page).toHaveURL(/#\/map/)
    const notPrevented = await page.evaluate(() =>
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true })),
    )
    expect(notPrevented).toBe(true)
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(0)
  })

  test('F-2087 E2 편집·보기 전환 때 검색어 이어받기', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await openApp(page)
    await importMarkdown(page, { content: DOC })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+f')
    await page.keyboard.type('바나나')
    await setViewMode(page, 'view')
    await expect(field(page)).toHaveValue('바나나')
    await expect(count(page)).toContainText('/')
    await setViewMode(page, 'live')
    await expect(page.locator('.cm-panel.cm-search input[name="search"]')).toHaveValue('바나나')
    expect(await page.locator('.cm-searchMatch').count()).toBeGreaterThan(0)

    await setViewMode(page, 'view')
    await page.locator('.viewer:not(.print-root)').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Escape')
    await expect(card(page)).toHaveCount(0)
    await setViewMode(page, 'live')
    await expect(page.locator('.cm-panel.cm-search')).toHaveCount(0)
  })

  test.describe('휴대폰 폭', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('F-2087 E3 휴대폰 폭 알약 찾기 버튼과 매치로 스크롤', async ({ page }) => {
      await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
      await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
      await openApp(page)
      const paragraphs = Array.from({ length: 200 }, (_, i) => `문단 ${i} 입니다`).join('\n\n')
      await importMarkdown(page, { content: `${paragraphs}\n\n끝말 여기\n` })
      await page.evaluate(() => localStorage.setItem('md.viewMode', 'view'))
      await page.reload()
      await expect(page.locator('.viewer .markdown-body')).toContainText('끝말')
      const find = page.getByRole('group', { name: '하단 도구' }).getByRole('button', { name: '이 문서에서 찾기', exact: true })
      await expect(find).toBeEnabled()
      await find.tap()
      await expect(field(page)).toBeFocused()
      await fakeSoftKeyboard(page, true)
      await expect(page.locator('.phone-nav')).toHaveCount(0)
      await page.keyboard.type('끝말')
      await expect(count(page)).toHaveText('1/1')
      const box = await page.evaluate(() => {
        const r = [...CSS.highlights.get('view-find-current')][0].getBoundingClientRect()
        const v = document.querySelector('.viewer:not(.print-root)').getBoundingClientRect()
        const cover = parseFloat(getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--float-cover')) || 0
        return { top: r.top, bottom: r.bottom, viewTop: v.top, viewBottom: v.bottom, cover }
      })
      expect(box.top).toBeGreaterThanOrEqual(box.viewTop + box.cover)
      expect(box.bottom).toBeLessThanOrEqual(box.viewBottom)
    })
  })
})
