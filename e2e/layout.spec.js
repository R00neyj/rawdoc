// 사이드바 접기·레일, 너비 조절, 문서 끝 커서 (F-150.md 3.3)
// 행 여백·바탕색·아이콘 크기·가이드 선 x 같은 시각 값은 e2e 로 고정하지 않는다 (CLAUDE.md "How we work", 2026-09-25 e2e 경량화)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow, rectOf, waitTransitionEnd } from './helpers.js'

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

  // -200px(최소 200)·+600px(최대 480) 끌기는 src/app/sidebarWidth.test.ts clampSidebarWidth 가 같은 입력·기대값으로 본다 (2026-09-25 e2e 경량화)

  test('F-159 A7 창 줄이기 — 저장값 480 유지, 화면만 464 로 줄고 1600px 에서 되돌아온다', async ({ page }) => {
    await openApp(page)
    await dragHandleBy(page, 600) // 480 으로 저장
    await waitTransitionEnd(page.locator('.sidebar'))
    expect(await page.evaluate(() => window.localStorage.getItem('md.sidebarWidth'))).toBe('480')

    await resizeWindow(page, 1024)
    await waitTransitionEnd(page.locator('.sidebar'))
    const narrowWidth = (await rectOf(page.locator('.sidebar'))).width
    expect(Math.abs(narrowWidth - 464)).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => window.localStorage.getItem('md.sidebarWidth'))).toBe('480')

    await resizeWindow(page, 1600)
    await waitTransitionEnd(page.locator('.sidebar'))
    const backWidth = (await rectOf(page.locator('.sidebar'))).width
    expect(Math.abs(backWidth - 480)).toBeLessThanOrEqual(1)
  })

  test('F-159 A8 좁은 창 — 손잡이 없음, 겹쳐 열린 폭 = 저장 너비(창 폭-48 이하)', async ({ page }) => {
    await openApp(page)
    await dragHandleBy(page, 100) // 400 으로 저장
    await waitTransitionEnd(page.locator('.sidebar'))

    await resizeWindow(page, 900)
    await page.locator('.sidebar-toggle').click() // 겹쳐 열기
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.sidebar-resize-handle')).toHaveCount(0)
    const overlayWidth = (await rectOf(page.locator('.sidebar'))).width
    expect(Math.abs(overlayWidth - 400)).toBeLessThanOrEqual(2)
  })
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
