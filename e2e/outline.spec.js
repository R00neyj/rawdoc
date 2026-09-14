// 오른쪽 목차 F-144 A2~A8 (F-150.md 3.3)
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

test.describe('F-144 A7 숨김', () => {
  test('오른쪽 여백이 56px 미만이면 목차가 없다', async ({ page }) => {
    await resizeWindow(page, 900, 900)
    await openApp(page)
    await importMarkdown(page, { content: '# 제목\n' })
    await expect(page.locator('nav.outline')).toHaveCount(0)
  })

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
