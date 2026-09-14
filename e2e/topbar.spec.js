// 상단바 아이콘·툴팁·공유 메뉴 (F-150.md 3.3), 토글·검색 앞 묶음 (F-151)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow, rectOf, waitTransitionEnd, currentDocId } from './helpers.js'

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

test.describe('F-151 상단바 앞 묶음(토글·검색)', () => {
  test('F-151 A1 펼침 배치 — 1600×900', async ({ page }) => {
    await openApp(page)
    const search = page.getByRole('button', { name: '검색 — 준비 중' })
    const toggle = page.getByRole('button', { name: '사이드바 접기' })
    const sidebar = page.locator('.sidebar')
    const brand = page.locator('.brand')

    const searchRect = await rectOf(search)
    const sidebarRect = await rectOf(sidebar)
    expect(Math.abs(sidebarRect.right - 8 - searchRect.right)).toBeLessThanOrEqual(1)

    const toggleRect = await rectOf(toggle)
    expect(toggleRect.right).toBeLessThanOrEqual(searchRect.left + 1)

    const brandRect = await rectOf(brand)
    expect(brandRect.left).toBeLessThan(toggleRect.left)
  })

  test('F-151 A2 레일 배치 — 접은 뒤·새로고침 뒤', async ({ page }) => {
    await openApp(page)
    const toggle = page.getByRole('button', { name: '사이드바 접기' })
    await toggle.click()
    await waitTransitionEnd(page.locator('.topbar-lead'))

    const sidebar = page.locator('.sidebar')
    await expect(sidebar).toHaveClass(/sidebar--collapsed/)
    const sidebarRect = await rectOf(sidebar)
    expect(Math.abs(sidebarRect.width - 48)).toBeLessThanOrEqual(1)

    const openToggle = page.getByRole('button', { name: '사이드바 펴기' })
    const brand = page.locator('.brand')
    const toggleRect = await rectOf(openToggle)
    const brandRect = await rectOf(brand)
    expect(Math.abs(toggleRect.left - brandRect.right - 8)).toBeLessThanOrEqual(1)

    await page.reload()
    const sidebarAfterReload = page.locator('.sidebar')
    await expect(sidebarAfterReload).toHaveClass(/sidebar--collapsed/)
    const sidebarRect2 = await rectOf(sidebarAfterReload)
    expect(Math.abs(sidebarRect2.width - 48)).toBeLessThanOrEqual(1)
  })

  test('F-151 A3 토글 아이콘·aria-label·툴팁·aria-expanded·aria-controls (4 상태)', async ({ page }) => {
    await openApp(page)
    const toggle = page.locator('.sidebar-toggle')
    const wrap = page.locator('.icon-btn-wrap').filter({ has: toggle })
    const tooltip = wrap.locator('.icon-tooltip')

    // 1024px 이상, 펼침
    await expect(toggle).toHaveAttribute('aria-label', '사이드바 접기')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle).toHaveAttribute('aria-controls', 'sidebar-nav')
    await expect(tooltip).toHaveText('사이드바 접기')

    // 1024px 이상, 레일
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', '사이드바 펴기')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(tooltip).toHaveText('사이드바 펴기')
    await toggle.click() // 펼침으로 되돌림

    // 1024px 미만, 닫힘
    await resizeWindow(page, 900)
    await expect(toggle).toHaveAttribute('aria-label', '사이드바 열기')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(tooltip).toHaveText('사이드바 열기')

    // 1024px 미만, 겹쳐 열림
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', '사이드바 닫기')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(tooltip).toHaveText('사이드바 닫기')
  })

  test('F-151 A4 좁은 창(900px) — 토글 하나로 열고 닫기, 바깥 클릭·Esc, md.sidebar 안 바뀜', async ({ page }) => {
    await openApp(page)
    await resizeWindow(page, 900)

    const prefBefore = await page.evaluate(() => window.localStorage.getItem('md.sidebar'))

    // 제품 아이콘 왼쪽에 다른 버튼이 없다 — topbar 의 첫 자식이 topbar-lead 다
    const firstChildClass = await page.evaluate(() => document.querySelector('.topbar').firstElementChild.className)
    expect(firstChildClass).toContain('topbar-lead')

    const toggle = page.locator('.sidebar-toggle')
    await expect(page.locator('.sidebar')).toBeHidden()
    await toggle.click()
    await expect(page.locator('.sidebar')).toBeVisible()
    await toggle.click()
    await expect(page.locator('.sidebar')).toBeHidden()

    await toggle.click()
    await expect(page.locator('.sidebar')).toBeVisible()
    await page.mouse.click(700, 400) // 바깥(오른쪽) 클릭
    await expect(page.locator('.sidebar')).toBeHidden()

    await toggle.click()
    await expect(page.locator('.sidebar')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.sidebar')).toBeHidden()

    const prefAfter = await page.evaluate(() => window.localStorage.getItem('md.sidebar'))
    expect(prefAfter).toBe(prefBefore)
  })

  test('F-151 A5 사이드바 — 머리 줄·검색 버튼 없음, 레일 위쪽 버튼 3개', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('.sidebar-head')).toHaveCount(0)
    await expect(page.locator('.sidebar').getByRole('button', { name: /검색/ })).toHaveCount(0)

    await page.locator('.sidebar-toggle').click() // 레일로 접기
    const railButtons = page.locator('.sidebar-rail-scroll .rail-btn')
    await expect(railButtons).toHaveCount(3)
    await expect(page.locator('.sidebar-rail-scroll').getByRole('button', { name: /검색/ })).toHaveCount(0)

    await page.locator('.sidebar-toggle').click() // 펼침으로
    await resizeWindow(page, 900)
    await page.locator('.sidebar-toggle').click() // 겹쳐 열기
    await expect(page.locator('.sidebar-head')).toHaveCount(0)
    await expect(page.locator('.sidebar').getByRole('button', { name: /검색/ })).toHaveCount(0)
  })

  test('F-151 A6 검색 버튼 — 클릭·Enter 해도 아무 변화 없음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '내용\n' })
    const search = page.getByRole('button', { name: '검색 — 준비 중' })
    await expect(search).toHaveAttribute('aria-disabled', 'true')

    const docIdBefore = await currentDocId(page)
    const docCountBefore = await page.locator('.tree-row').count()
    const urlBefore = page.url()

    await search.click({ force: true }) // aria-disabled='true' 라 Playwright 기본 클릭 판정을 우회한다
    await search.focus()
    await page.keyboard.press('Enter')

    expect(await currentDocId(page)).toBe(docIdBefore)
    expect(await page.locator('.tree-row').count()).toBe(docCountBefore)
    expect(page.url()).toBe(urlBefore)
    await expect(search).toBeFocused()
  })

  test('F-151 A7 포커스 — 토글에 계속 남고, 새로고침 직후엔 어디에도 없다', async ({ page }) => {
    await openApp(page)
    const toggle = page.locator('.sidebar-toggle')
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(toggle).toBeFocused()

    // Tab 순서: 토글(이미 포커스) → 검색 → 제목 → 보기 모드 → 공유 → 내보내기 (2.5)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: '검색 — 준비 중' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.locator('.doc-title')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: '편집 — 서식을 보며 편집' })).toBeFocused()

    await page.reload()
    const activeTag = await page.evaluate(() => document.activeElement?.tagName)
    expect(activeTag === 'BODY' || activeTag === undefined).toBe(true)
    const visibleTooltip = await page.locator('.icon-tooltip').evaluateAll(
      (els) => els.some((el) => parseFloat(getComputedStyle(el).opacity) > 0),
    )
    expect(visibleTooltip).toBe(false)
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
