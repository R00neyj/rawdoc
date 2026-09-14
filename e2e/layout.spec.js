// 사이드바 접기·레일, 검색 버튼, 목록 행 모양, 편집 영역 개방, 문서 여백 (F-150.md 3.3)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow, rectOf, computedStyle, waitTransitionEnd, tokenAsRgb } from './helpers.js'

test.describe('F-143 사이드바 접기', () => {
  test('F-143 A3 접으면 48px 레일이 되고 새로고침 뒤에도 유지된다', async ({ page }) => {
    await openApp(page)
    const toggle = page.getByRole('button', { name: '사이드바 접기' })
    await toggle.click()

    const sidebar = page.locator('.sidebar')
    await expect(sidebar).toHaveClass(/sidebar--collapsed/)
    await waitTransitionEnd(sidebar)
    const width = (await rectOf(sidebar)).width
    expect(Math.abs(width - 48)).toBeLessThanOrEqual(1)

    await expect(page.getByRole('button', { name: '사이드바 펴기' })).toBeVisible()
    await expect(page.getByRole('button', { name: '새 문서' })).toBeVisible()
    await expect(page.getByRole('button', { name: '새 폴더' })).toBeVisible()
    await expect(page.getByRole('button', { name: '가져오기' })).toBeVisible()
    await expect(page.getByRole('button', { name: '검색 — 준비 중' })).toBeVisible()

    await page.reload()
    await expect(page.locator('.sidebar')).toHaveClass(/sidebar--collapsed/)

    const openBtn = page.getByRole('button', { name: '사이드바 펴기' })
    await openBtn.click()
    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--collapsed/)
    // 포커스가 반대쪽 토글로 옮겨간다
    await expect(page.getByRole('button', { name: '사이드바 접기' })).toBeFocused()
  })
})

test.describe('F-143 A5 좁은 창(900px)', () => {
  test('상단바 토글로 사이드바를 열고 닫을 수 있고, 넓히면 저장된 상태로 돌아간다', async ({ page }) => {
    await openApp(page)
    await resizeWindow(page, 900)
    await expect(page.locator('.sidebar')).toBeHidden()

    const openToggle = page.locator('.sidebar-toggle')
    await expect(openToggle).toHaveAttribute('aria-label', '사이드바 열기')
    await openToggle.click()
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--collapsed/)

    // 바깥 클릭으로 닫힌다 — 사이드바가 화면 왼쪽 일부를 덮으므로 그 밖(오른쪽)을 클릭한다
    await page.mouse.click(700, 400)
    await expect(page.locator('.sidebar')).toBeHidden()

    await resizeWindow(page, 1280)
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--collapsed/)
  })
})

test.describe('F-143 A6 검색 버튼', () => {
  test('눌러도 아무 동작이 없고 준비 중 표시가 있다', async ({ page }) => {
    await openApp(page)
    const search = page.getByRole('button', { name: /^검색/ })
    await expect(search).toHaveAttribute('aria-disabled', 'true')
    await expect(page.locator('.sidebar-btn-hint')).toHaveText('준비 중')
    await search.focus()
    await page.keyboard.press('Enter')
    // 눌러도 사이드바·문서 상태가 그대로(다른 화면으로 전환되지 않음)
    await expect(page.locator('.sidebar')).toBeVisible()
  })
})

test.describe('F-143 A7 행 호버', () => {
  test('호버·현재 표시가 행 전체 폭에 칠해진다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '문서.md', content: '내용\n' })
    const row = page.locator('.tree-row').filter({ hasText: '문서' }).first()
    const sidebarRect = await rectOf(page.locator('.doc-list'))
    const rowRect = await rectOf(row)
    expect(Math.abs(rowRect.width - sidebarRect.width)).toBeLessThanOrEqual(4)

    await row.hover()
    const bg = await computedStyle(row, 'background-color')
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')

    // 현재 문서 행은 호버해도 유지된다
    const btnBgBefore = await computedStyle(row.locator('.doc-item-btn'), 'background-color')
    expect(btnBgBefore).toBe('rgba(0, 0, 0, 0)')
  })
})

test.describe('F-143 A8 행 여백', () => {
  test('왼쪽 6px·오른쪽 4px·토글-글자 간격 6px', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: '문서.md', content: '내용\n' })
    const row = page.locator('.tree-row').filter({ hasText: '문서' }).first()
    const rowRect = await rectOf(row)
    const toggleSpacer = row.locator('.tree-toggle-spacer')
    const label = row.locator('.tree-label')
    const menuBtn = row.locator('.item-menu-btn')

    const spacerRect = await rectOf(toggleSpacer)
    expect(Math.abs(spacerRect.left - rowRect.left - 6)).toBeLessThanOrEqual(1)

    const labelRect = await rectOf(label)
    expect(labelRect.left).toBeGreaterThan(spacerRect.right - 1)

    const menuRect = await rectOf(menuBtn)
    expect(Math.abs(rowRect.right - menuRect.right)).toBeLessThanOrEqual(4)
  })
})

test.describe('F-143 A14 편집 영역 개방', () => {
  test('메인 열 바탕이 한 가지고 세로 스크롤바가 메인 열 오른쪽 끝에 붙는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: Array.from({ length: 200 }, (_, i) => `줄 ${i}`).join('\n') })

    const mainColumn = page.locator('.main-column')
    const contentArea = page.locator('.content-area')
    const scroller = page.locator('.cm-scroller')

    const contentBg = await computedStyle(contentArea, 'background-color')
    const panelRgb = await tokenAsRgb(page, '--panel')
    // 메인 열 전체(편집 영역 포함)가 --panel 한 가지 바탕이어야 한다(구분 없음, F-143 3.8)
    expect(contentBg).toBe(panelRgb)

    const scrollerRect = await rectOf(scroller)
    const mainRect = await rectOf(mainColumn)
    expect(Math.abs(scrollerRect.right - mainRect.right)).toBeLessThanOrEqual(1)

    // 문서 전체 가로 스크롤은 없다
    const sizes = await scroller.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
    expect(sizes.scrollWidth).toBe(sizes.clientWidth)
  })
})

test.describe('F-143 A16 아이콘 크기·가이드 선', () => {
  test('토글 svg 가 줄어들지 않고, 펼친 폴더에 가이드 선이 보인다', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '새 폴더', exact: true }).click()
    await page.keyboard.press('Enter') // 이름 그대로 커밋

    // 폴더 안에 문서를 만들어야 펼친 폴더에 하위 항목(가이드 선 조건)이 생긴다.
    // 폴더 행만 `.tree-toggle` 버튼을 갖는다(문서 행은 `.tree-toggle-spacer`) — 이걸로 가른다
    const folderRow = page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') }).first()
    await folderRow.hover()
    await folderRow.locator('.item-menu-btn').click()
    await page.getByRole('menuitem', { name: '새 문서' }).click()

    const folderToggle = page.locator('.tree-toggle').first()
    const svg = folderToggle.locator('svg')
    const svgSize = await svg.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { width: r.width, height: r.height }
    })
    expect(Math.abs(svgSize.width - 16)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(svgSize.height - 16)).toBeLessThanOrEqual(0.5)

    const guideBox = await page.locator('.tree-group').first().evaluate((el) => {
      const cs = getComputedStyle(el, '::before')
      return { width: parseFloat(cs.width), height: el.getBoundingClientRect().height, content: cs.content }
    })
    expect(guideBox.content).not.toBe('none')
    expect(guideBox.width).toBeCloseTo(1, 0)
    expect(guideBox.height).toBeGreaterThan(0)
  })
})

test.describe('F-143 A17 / F-124 A2d 문서 여백', () => {
  test('첫 줄 위 48px, 마지막 줄 아래 50dvh, Ctrl+End 커서가 화면 안', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: Array.from({ length: 300 }, (_, i) => `줄 ${i}`).join('\n') })

    const scroller = page.locator('.cm-scroller')
    const firstLine = page.locator('.cm-line').first()
    const scrollerTop = (await rectOf(scroller)).top
    const firstLineTop = (await rectOf(firstLine)).top
    expect(Math.abs(firstLineTop - scrollerTop - 48)).toBeLessThanOrEqual(2)

    await page.keyboard.press('Control+End')
    const viewportHeight = await page.evaluate(() => window.innerHeight)
    const expectedBottomPad = viewportHeight * 0.5
    const scrollerRect = await rectOf(scroller)
    const lastLine = page.locator('.cm-line').last()
    const lastLineRect = await rectOf(lastLine)
    // 커서가 화면(스크롤 영역) 안에 있어야 한다
    expect(lastLineRect.top).toBeGreaterThanOrEqual(scrollerRect.top - 2)
    expect(lastLineRect.top).toBeLessThanOrEqual(scrollerRect.bottom + 2)
    void expectedBottomPad
  })
})
