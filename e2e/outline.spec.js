// 오른쪽 목차 F-144 A2~A8, F-229 좁은 화면 버튼 (F-150.md 3.3)
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

test.describe('F-144 A2 접힘 모양', () => {
  test('선 개수 = 제목 수, 수준별 길이, 현재 위치 선 색', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: longDoc() })

    const items = page.locator('.outline-rail-item')
    await expect(items).toHaveCount(60)

    const h1Width = await items.nth(0).locator('span').evaluate((el) => el.getBoundingClientRect().width)
    const h2Width = await items.nth(1).locator('span').evaluate((el) => el.getBoundingClientRect().width)
    const h3Width = await items.nth(2).locator('span').evaluate((el) => el.getBoundingClientRect().width)
    expect(h1Width).toBeGreaterThan(h2Width)
    expect(h2Width).toBeGreaterThan(h3Width)

    const current = page.locator('.outline-rail-item[data-current="true"]')
    await expect(current).toHaveCount(1)
  })
})

test.describe('F-144 A3 펼침', () => {
  test('마우스를 올리면 카드가 뜨고, 떠나면 접힌다', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: longDoc() })

    const nav = page.locator('nav.outline')
    await nav.hover()
    await expect(nav).toHaveClass(/outline--expanded/)
    const card = page.locator('.outline-card')
    await expect(card.locator('li').first()).toBeVisible()

    await page.mouse.move(10, 10)
    await expect(nav).not.toHaveClass(/outline--expanded/, { timeout: 1000 })
  })
})

test.describe('F-144 A4 이동', () => {
  for (const mode of ['live', 'raw', 'view']) {
    test(`${mode} 모드에서 목차 클릭 시 스크롤만 하고 커서는 그대로`, async ({ page }) => {
      await resizeWindow(page, 1600, 900)
      await openApp(page)
      await importMarkdown(page, { content: longDoc() })
      await setViewMode(page, mode)

      if (mode !== 'view') {
        // 선택 불변(F-152 A8) — 문서 맨 앞에 커서를 두고 확인한다
        await page.locator('.cm-content').click()
        await page.keyboard.press('Control+Home')
      }

      const nav = page.locator('nav.outline')
      await nav.hover()
      const targetItem = page.locator('.outline-item', { hasText: /^제목 2$/ })
      await targetItem.click()

      if (mode !== 'view') {
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
      } else {
        const heading = page.locator('[data-source-line]').getByText('제목 2', { exact: true }).first()
        await expect(heading).toBeVisible()
      }
    })
  }
})

test.describe('F-144 A5 현재 위치', () => {
  test('스크롤을 옮기면 aria-current 항목이 바뀐다', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: longDoc() })

    const scroller = page.locator('.cm-scroller')
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight / 2
    })
    await page.locator('nav.outline').hover()
    const current = page.locator('.outline-item[aria-current="location"]')
    await expect(current).toHaveCount(1)
  })
})

test.describe('F-144 A6 갱신', () => {
  test('제목 추가 후 입력이 멈추면 목록이 반영된다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '# 하나\n' })
    await expect(page.locator('.outline-rail-item')).toHaveCount(1)

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n## 둘')
    await expect(page.locator('.outline-rail-item')).toHaveCount(2, { timeout: 2000 })
  })
})

test.describe('F-229 A1 전환', () => {
  test('900: 선 목차 없이 버튼. 1600: 선 목차, 버튼 없음. 제목 없음: 둘 다 없음', async ({ page }) => {
    await resizeWindow(page, 900, 900)
    await openApp(page)
    await importMarkdown(page, { content: '# 제목\n' })
    await expect(page.locator('.outline-rail')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '목차' })).toBeVisible()

    await resizeWindow(page, 1600, 900)
    await expect(page.locator('.outline-rail')).toBeVisible()
    await expect(page.getByRole('button', { name: '목차' })).toHaveCount(0)

    await resizeWindow(page, 900, 900)
    await importMarkdown(page, { content: '제목 없는 본문\n' })
    await expect(page.locator('.outline-rail')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '목차' })).toHaveCount(0)
  })
})

test.describe('F-144 A7 숨김', () => {
  test('제목 없는 문서에는 목차가 없다', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: '제목 없는 본문\n' })
    await expect(page.locator('nav.outline')).toHaveCount(0)
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

test.describe('F-229 좁은 화면 목차 버튼 (412×915, 터치)', () => {
  test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true })

  test('F-229 A2 버튼 위치·크기, 스크롤 전후 위치 같음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: longDoc() })

    const btn = page.getByRole('button', { name: '목차' })
    const before = await rectOf(btn)
    expect(before.width).toBeGreaterThanOrEqual(43)
    expect(before.width).toBeLessThanOrEqual(45)
    expect(before.height).toBeGreaterThanOrEqual(43)
    expect(before.height).toBeLessThanOrEqual(45)

    const contentArea = await rectOf(page.locator('.content-area'))
    expect(Math.abs(before.right - (contentArea.right - 16))).toBeLessThanOrEqual(2)
    expect(Math.abs(before.top - (contentArea.top + 12))).toBeLessThanOrEqual(2)

    await page.locator('.cm-scroller').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    const after = await rectOf(btn)
    expect(after.x).toBeCloseTo(before.x, 0)
    expect(after.y).toBeCloseTo(before.y, 0)
  })

  test('F-229 A3 열기 — 카드가 화면 안에 보이고 현재 위치 항목이 보인다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: longDoc() })

    const btn = page.getByRole('button', { name: '목차' })
    await btn.click()
    await expect(btn).toHaveAttribute('aria-expanded', 'true')

    const card = page.locator('.outline-popup-card')
    await expect(card).toBeVisible()
    await expect(card.locator('li')).toHaveCount(60)

    const cardRect = await rectOf(card)
    expect(cardRect.left).toBeGreaterThanOrEqual(16)
    expect(cardRect.right).toBeLessThanOrEqual(412 - 16)

    const current = page.locator('.outline-popup-card .outline-item[aria-current="location"]')
    await expect(current).toBeVisible()
  })

  for (const mode of ['live', 'raw', 'view']) {
    test(`F-229 A4 이동(${mode}) — 스크롤만 하고 카드는 닫힌다`, async ({ page }) => {
      await openApp(page)
      await importMarkdown(page, { content: longDoc() })
      await setViewMode(page, mode)

      const btn = page.getByRole('button', { name: '목차' })
      await btn.click()
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

  test('F-229 A5 닫기 — 다시 탭 / 본문 탭 / Esc', async ({ page }) => {
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
  })
})

test.describe('F-229 A6 키보드 (900×900)', () => {
  test('Tab 으로 버튼 → Enter → 현재 위치 항목 포커스, Tab 으로 카드 밖에 나가면 닫힘', async ({ page }) => {
    await resizeWindow(page, 900, 900)
    await openApp(page)
    await importMarkdown(page, { content: longDoc() })

    const btn = page.getByRole('button', { name: '목차' })
    await btn.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.outline-popup-card')).toBeVisible()

    const current = page.locator('.outline-popup-card .outline-item[aria-current="location"]')
    await expect(current).toBeFocused()

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
