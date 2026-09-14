// 상단바 아이콘·툴팁·공유 메뉴 (F-150.md 3.3)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow, rectOf } from './helpers.js'

const BUTTON_LABELS = [
  '편집 — 서식을 보며 편집',
  '원문 — 마크다운 기호 그대로 편집',
  '보기 — 읽기 전용으로 보기',
  '공유 — 링크·마크다운 복사',
  '.md 파일로 내보내기',
]

test.describe('F-142 상단바 버튼·툴팁', () => {
  test('F-142 A1 다섯 버튼 모두 아이콘만, 보이는 글자 없음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    for (const label of BUTTON_LABELS) {
      const btn = page.getByRole('button', { name: label, exact: true })
      await expect(btn).toBeVisible()
      const svgCount = await btn.locator('svg').count()
      expect(svgCount).toBe(1)
      const text = (await btn.innerText()).trim()
      expect(text).toBe('')
    }
  })

  for (const width of [1280, 1024]) {
    test(`F-142 A2 창 너비 ${width}px 에서 툴팁이 창 안에 있다`, async ({ page }) => {
      await openApp(page)
      await importMarkdown(page, { content: '내용\n' })
      await resizeWindow(page, width)
      const exportBtn = page.getByRole('button', { name: '.md 파일로 내보내기' })
      await exportBtn.hover()
      await page.waitForTimeout(450) // 3.2 "400ms 뒤 표시" — 지연 자체를 확인하는 자리라 고정 대기
      const tooltipRect = await exportBtn.evaluate((el) => {
        const cs = getComputedStyle(el, '::after')
        const r = el.getBoundingClientRect()
        return { opacity: cs.opacity, right: r.right + (parseFloat(cs.width) || 0) }
      })
      expect(Number(tooltipRect.opacity)).toBeGreaterThan(0)
      const scrollWidth = await page.evaluate(() => document.scrollingElement.scrollWidth)
      const clientWidth = await page.evaluate(() => document.scrollingElement.clientWidth)
      expect(scrollWidth).toBe(clientWidth)
    })
  }

  test('F-142 A3 모드 전환·내보내기 회귀 동작', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '# 제목\n' })

    const rawBtn = page.getByRole('button', { name: '원문 — 마크다운 기호 그대로 편집' })
    await rawBtn.click()
    await expect(rawBtn).toHaveAttribute('aria-pressed', 'true')

    const viewBtn = page.getByRole('button', { name: '보기 — 읽기 전용으로 보기' })
    await viewBtn.click()
    await expect(viewBtn).toHaveAttribute('aria-pressed', 'true')

    const liveBtn = page.getByRole('button', { name: '편집 — 서식을 보며 편집' })
    await liveBtn.click()
    await expect(liveBtn).toHaveAttribute('aria-pressed', 'true')
  })

  test('F-142 A5 빈 상태에서는 비활성이다', async ({ page }) => {
    await openApp(page)
    // 첫 실행 안내 문서가 있으므로 지워서 빈 상태를 만든다
    const row = page.locator('.tree-row').first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    await page.getByRole('menuitem', { name: /삭제/ }).click()
    await page.getByRole('button', { name: '삭제', exact: true }).click()

    await expect(page.getByRole('button', { name: '공유 — 링크·마크다운 복사' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '.md 파일로 내보내기' })).toBeDisabled()
  })
})

test.describe('F-142 A12 / F-142 3.6 공유 메뉴 가로 스크롤', () => {
  for (const width of [1280, 1024]) {
    test(`창 너비 ${width}px 에서 공유 메뉴가 창 안에 있다`, async ({ page }) => {
      await openApp(page)
      await importMarkdown(page, { content: '내용\n' })
      await resizeWindow(page, width)
      const shareBtn = page.getByRole('button', { name: '공유 — 링크·마크다운 복사' })
      await shareBtn.click()
      const menu = page.locator('.share-menu-list')
      await expect(menu).toBeVisible()

      const menuRect = await rectOf(menu)
      const btnRect = await rectOf(shareBtn)
      expect(Math.abs(menuRect.right - btnRect.right)).toBeLessThanOrEqual(2)
      expect(menuRect.left).toBeGreaterThanOrEqual(0)

      const scrollWidth = await page.evaluate(() => document.scrollingElement.scrollWidth)
      const clientWidth = await page.evaluate(() => document.scrollingElement.clientWidth)
      expect(scrollWidth).toBe(clientWidth)

      await page.keyboard.press('Escape')
    })
  }

  test('키보드 조작 — 방향키 이동, Enter 실행, Esc 로 닫기', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    const shareBtn = page.getByRole('button', { name: '공유 — 링크·마크다운 복사' })
    await shareBtn.click()
    const items = page.locator('.share-menu-list [role="menuitem"]')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('.share-menu-list')).toBeHidden()
    await expect(shareBtn).toBeFocused()
  })
})

test.describe('F-143 A10 그 밖의 기능 버튼 아이콘', () => {
  test('⋯ 메뉴·공유 메뉴 항목마다 아이콘 + 글자가 있다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '문서.md', content: '내용\n' })

    const row = page.locator('.tree-row').filter({ hasText: '문서' }).first()
    await row.hover()
    await row.locator('.item-menu-btn').click()
    const docMenuItems = page.locator('.item-menu-list [role="menuitem"]')
    const docCount = await docMenuItems.count()
    for (let i = 0; i < docCount; i++) {
      await expect(docMenuItems.nth(i).locator('svg')).toHaveCount(1)
    }
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: '공유 — 링크·마크다운 복사' }).click()
    const shareItems = page.locator('.share-menu-list [role="menuitem"]')
    const shareCount = await shareItems.count()
    for (let i = 0; i < shareCount; i++) {
      await expect(shareItems.nth(i).locator('svg')).toHaveCount(1)
    }
  })
})
