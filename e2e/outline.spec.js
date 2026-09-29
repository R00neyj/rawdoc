// 오른쪽 목차 F-144 A4·A6·A8, F-229 좁은 화면 버튼 (F-150.md 3.3)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow, setViewMode, rectOf } from './helpers.js'

function longDoc() {
  const parts = []
  for (let i = 0; i < 20; i++) {
    parts.push(`# 제목 ${i}`)
    parts.push('본문 '.repeat(20))
    parts.push(`## 부제 ${i}`)
    parts.push('본문 '.repeat(20))
    parts.push(`### 소제목 ${i}`)
    parts.push('본문 '.repeat(30))
  }
  return parts.join('\n\n')
}

// 보기 모드 목차 클릭 이동은 e2e/viewScroll.spec.js F-295 A9 가 본다
test.describe('F-144 A4 이동', () => {
  for (const mode of ['live', 'raw']) {
    test(`${mode} 모드에서 목차 클릭 시 스크롤만 하고 커서는 그대로`, async ({ page }) => {
      await resizeWindow(page, 1600, 900)
      await openApp(page)
      await importMarkdown(page, { content: longDoc() })
      await setViewMode(page, mode)

      // 선택 불변(F-152 A8) — 문서 맨 앞에 커서를 두고 확인한다
      await page.locator('.cm-content').click()
      await page.keyboard.press('Control+Home')

      const nav = page.locator('nav.outline')
      await nav.hover()
      const targetItem = page.locator('.outline-item', { hasText: /^제목 2$/ })
      await targetItem.click()

      // 포커스가 목차 버튼으로 옮겨가도 contenteditable 의 네이티브 선택 Range 는
      // 곧바로는 그대로 남는다 — 스크롤이 완전히 정착해 화면 밖 줄의 DOM 이 CM6
      // 가상화로 재활용되면 이 값이 더는 믿을 수 없어(테스트 한계), 정착을 기다리기
      // 전에 바로 잰다. 문서 맨 앞은 숨긴 "#" 마커의 빈 폭 자리 때문에 텍스트
      // 노드(offset 0) 또는 그 줄 DIV(offset ≤ 1) 두 가지로 나타날 수 있다
      const atStart = await page.evaluate(() => {
        const s = document.getSelection()
        if (!s.isCollapsed || s.rangeCount === 0) return false
        const { anchorNode, anchorOffset } = s
        if (anchorNode.nodeType === Node.TEXT_NODE) return anchorOffset === 0 && anchorNode.textContent.startsWith('#')
        return anchorNode.classList?.contains('cm-line') && anchorOffset <= 1
      })
      expect(atStart).toBe(true)

      const scroller = page.locator('.cm-scroller')
      const heading =
        mode === 'live'
          ? page.locator('.cm-content .md-heading', { hasText: /^제목 2$/ })
          : page.locator('.cm-line', { hasText: /^# 제목 2$/ })
      await expect
        .poll(async () => {
          const scrollerTop = (await rectOf(scroller)).top
          const headingTop = (await rectOf(heading)).top
          return Math.abs(headingTop - scrollerTop - 16)
        })
        .toBeLessThanOrEqual(4)
    })
  }
})

test.describe('F-144 A6 갱신', () => {
  test('현재 위치 선·항목이 하나, 제목 추가 후 입력이 멈추면 목록이 반영된다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '# 하나\n' })
    await expect(page.locator('.outline-rail-item')).toHaveCount(1)
    await expect(page.locator('.outline-rail-item[data-current="true"]')).toHaveCount(1)
    await page.locator('nav.outline').hover()
    await expect(page.locator('.outline-item[aria-current="location"]')).toHaveCount(1)

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n## 둘')
    await expect(page.locator('.outline-rail-item')).toHaveCount(2, { timeout: 2000 })
  })
})

test.describe('F-144 A8 키보드', () => {
  test('Tab 진입 → 펼침, Enter 이동, Esc 로 접고 편집 영역으로 포커스', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: longDoc() })

    const items = page.locator('.outline-item')
    await items.first().focus()
    const nav = page.locator('nav.outline')
    await expect(nav).toHaveClass(/outline--expanded/)

    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    await expect(nav).not.toHaveClass(/outline--expanded/)
    await expect(page.locator('.cm-content')).toBeFocused()
  })
})

test.describe('F-229 좁은 화면 목차 버튼 (700×915, 터치)', () => {
  test.use({ viewport: { width: 700, height: 915 }, hasTouch: true, isMobile: true })

  // F-229 A2 버튼 위치·크기(44px, 오른쪽 16·위 12)는 시각 값이라 e2e 에서 뺐다 — specs/human-checks.md (2026-09-25 e2e 경량화)

  for (const mode of ['live', 'raw', 'view']) {
    test(`F-229 A3·A4 열기·이동(${mode}) — 카드에 항목·현재 위치, 스크롤만 하고 카드는 닫힌다`, async ({ page }) => {
      await openApp(page)
      await importMarkdown(page, { content: longDoc() })
      await setViewMode(page, mode)

      const btn = page.getByRole('button', { name: '목차' })
      await btn.click()
      await expect(btn).toHaveAttribute('aria-expanded', 'true')
      await expect(page.locator('.outline-popup-card li')).toHaveCount(60)
      await expect(page.locator('.outline-popup-card .outline-item[aria-current="location"]')).toBeVisible()
      const targetItem = page.locator('.outline-popup-card .outline-item', { hasText: /^제목 2$/ })
      await targetItem.click()

      await expect(page.locator('.outline-popup-card')).toHaveCount(0)

      if (mode !== 'view') {
        const scroller = page.locator('.cm-scroller')
        const heading =
          mode === 'live'
            ? page.locator('.cm-content .md-heading', { hasText: /^제목 2$/ })
            : page.locator('.cm-line', { hasText: /^# 제목 2$/ })
        await expect
          .poll(async () => {
            const scrollerTop = (await rectOf(scroller)).top
            const headingTop = (await rectOf(heading)).top
            return Math.abs(headingTop - scrollerTop - 16)
          })
          .toBeLessThanOrEqual(4)
      } else {
        const heading = page.locator('[data-source-line]').getByText('제목 2', { exact: true }).first()
        await expect(heading).toBeVisible()
      }
    })
  }

  test('F-229 A5·A6 닫기 — 다시 탭 / 본문 탭 / Esc, 키보드로 열고 Tab 으로 나가면 닫힘', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: longDoc() })
    const btn = page.getByRole('button', { name: '목차' })

    await btn.click()
    await expect(page.locator('.outline-popup-card')).toBeVisible()
    await btn.click()
    await expect(page.locator('.outline-popup-card')).toHaveCount(0)

    await btn.click()
    await expect(page.locator('.outline-popup-card')).toBeVisible()
    await page.locator('.cm-content').click({ position: { x: 10, y: 10 } })
    await expect(page.locator('.outline-popup-card')).toHaveCount(0)

    await btn.click()
    await expect(page.locator('.outline-popup-card')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.outline-popup-card')).toHaveCount(0)
    await expect(btn).toBeFocused()

    // A6 — 키보드: 버튼 → Enter → 현재 위치 항목 포커스, Tab 으로 카드 밖에 나가면 닫힘
    await page.keyboard.press('Enter')
    await expect(page.locator('.outline-popup-card')).toBeVisible()
    await expect(page.locator('.outline-popup-card .outline-item[aria-current="location"]')).toBeFocused()
    const itemCount = await page.locator('.outline-popup-card .outline-item').count()
    for (let i = 0; i < itemCount; i++) {
      await page.keyboard.press('Tab')
    }
    await expect(page.locator('.outline-popup-card')).toHaveCount(0)
  })
})

test.describe('F-229 A7 공유 링크 보기', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true })

  test('버튼이 보이고 항목 탭으로 스크롤된다', async ({ page }) => {
    await page.route('**/pub/docs/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          title: '공개 문서',
          content: longDoc(),
          lineEnding: 'lf',
          updatedAt: 1_700_000_000_000,
        }),
      }),
    )
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-title')).toHaveText('공개 문서')

    const btn = page.getByRole('button', { name: '목차' })
    await expect(btn).toBeVisible()
    await btn.click()
    const targetItem = page.locator('.outline-popup-card .outline-item', { hasText: /^제목 2$/ })
    await targetItem.click()
    const heading = page.locator('[data-source-line]').getByText('제목 2', { exact: true }).first()
    await expect(heading).toBeVisible()
  })
})
