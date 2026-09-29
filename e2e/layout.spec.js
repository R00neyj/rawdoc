// 사이드바 접기·레일, 너비 조절, 문서 끝 커서 (F-150.md 3.3)
// 행 여백·바탕색·아이콘 크기·가이드 선 x 같은 시각 값은 e2e 로 고정하지 않는다 (CLAUDE.md "How we work", 2026-09-25 e2e 경량화)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, rectOf } from './helpers.js'

// F-143 A3·A6 은 토글·검색이 상단바로 옮겨가 (F-151) e2e/topbar.spec.js 의
// F-151 A2·A3·A5·A6 테스트로 옮겼다. 레일 폭·유지만 여기 남긴다
test.describe('F-143 사이드바 접기', () => {
  // 레일 폭 48px 는 시각 값이라 뺐다 (CLAUDE.md "Design does not get TDD")
  test('F-143 A3 접으면 레일이 되고 새로고침 뒤에도 유지된다', async ({ page }) => {
    await openApp(page)
    const toggle = page.getByRole('button', { name: '사이드바 접기' })
    await toggle.click()

    const sidebar = page.locator('.sidebar')
    await expect(sidebar).toHaveClass(/sidebar--collapsed/)

    await expect(page.getByRole('button', { name: '사이드바 펴기' })).toBeVisible()
    await expect(page.getByRole('button', { name: '새 문서' })).toBeVisible()
    await expect(page.getByRole('button', { name: '새 폴더' })).toBeVisible()
    await expect(page.getByRole('button', { name: '가져오기' })).toBeVisible()

    await page.reload()
    await expect(page.locator('.sidebar')).toHaveClass(/sidebar--collapsed/)

    const openBtn = page.getByRole('button', { name: '사이드바 펴기' })
    await openBtn.click()
    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--collapsed/)
    // F-151 2.2 — 버튼이 사라지지 않으므로 누른 뒤 포커스는 그대로 토글 버튼에 남는다
    await expect(page.getByRole('button', { name: '사이드바 접기' })).toBeFocused()
  })
})

// F-143 A5 좁은 창 토글·바깥 클릭·넓히면 복귀는 e2e/topbar.spec.js F-151 A4 로 합쳤다
test.describe('F-159 사이드바 너비 조절', () => {
  async function dragHandleBy(page, dx) {
    const handle = page.locator('.sidebar-resize-handle')
    const box = await handle.boundingBox()
    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + dx, startY, { steps: 5 })
    await page.mouse.up()
  }

  test('F-159 A5 +100px 끌기 → 400px, 저장', async ({ page }) => {
    await openApp(page)
    await dragHandleBy(page, 100)
    const width = (await rectOf(page.locator('.sidebar'))).width
    expect(Math.abs(width - 400)).toBeLessThanOrEqual(2)
    expect(await page.evaluate(() => window.localStorage.getItem('md.sidebarWidth'))).toBe('400')
  })

  // A7·A8 창 폭 규칙은 src/app/sidebarWidth.test.ts 가 본다 (2026-09-29 e2e 정리)
})

test.describe('F-124 A2d 문서 끝', () => {
  test('Ctrl+End 커서가 화면 안, 문서 전체 가로 스크롤 없음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: Array.from({ length: 300 }, (_, i) => `줄 ${i}`).join('\n') })

    const scroller = page.locator('.cm-scroller')
    await page.keyboard.press('Control+End')
    const scrollerRect = await rectOf(scroller)
    const lastLineRect = await rectOf(page.locator('.cm-line').last())
    // 커서가 화면(스크롤 영역) 안에 있어야 한다
    expect(lastLineRect.top).toBeGreaterThanOrEqual(scrollerRect.top - 2)
    expect(lastLineRect.top).toBeLessThanOrEqual(scrollerRect.bottom + 2)

    // 문서 전체 가로 스크롤은 없다 (F-143 A14 에서 옮김)
    const sizes = await scroller.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
    expect(sizes.scrollWidth).toBe(sizes.clientWidth)
  })
})
