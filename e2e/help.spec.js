// 마크다운 문법 도움말 대화상자 (specs/features/F-235.md)
import { test, expect } from '@playwright/test'
import { openApp, resizeWindow, waitTransitionEnd } from './helpers.js'

// 그룹 순서 — F-235.md 0장 표 그대로
const EXPECTED_GROUP_ORDER = [
  '제목',
  '강조',
  '목록',
  '인용',
  '링크',
  '위키링크',
  '표',
  '코드블록',
  '이미지',
  '콜아웃',
  '구분선',
  '프론트매터',
]

async function openHelpDialog(page) {
  await page.getByRole('button', { name: '도움말' }).first().click()
  const dialog = page.locator('.dialog[open]')
  await waitTransitionEnd(dialog)
  return dialog
}

test.describe('F-235 A1 진입점', () => {
  test('펼친 사이드바에서 도움말 버튼을 누르면 대화상자가 열린다', async ({ page }) => {
    await openApp(page)
    const dialog = await openHelpDialog(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('#help-title')).toHaveText('도움말')
  })

  test('레일(접힘) 사이드바에서도 도움말 버튼을 누르면 대화상자가 열린다', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '사이드바 접기' }).click()
    await expect(page.locator('.sidebar')).toHaveClass(/sidebar--collapsed/)
    const dialog = await openHelpDialog(page)
    await expect(dialog).toBeVisible()
  })
})

test.describe('F-235 A2 그룹 순서', () => {
  test('그룹 제목이 명세 순서와 일치한다', async ({ page }) => {
    await openApp(page)
    const dialog = await openHelpDialog(page)
    const titles = await dialog.locator('.help-group-title').allTextContents()
    expect(titles).toEqual(EXPECTED_GROUP_ORDER)
  })
})

test.describe('F-235 A3 카드 구성', () => {
  test('굵게·표·이미지 카드에 원문과 렌더링 결과가 있다', async ({ page }) => {
    await openApp(page)
    const dialog = await openHelpDialog(page)

    const boldCard = dialog.locator('.help-card', { hasText: '굵게' }).first()
    await expect(boldCard.locator('pre code')).toHaveText('**굵게**')
    await expect(boldCard.locator('.viewer strong')).toHaveText('굵게')

    const tableCard = dialog.locator('.help-card', { hasText: '표' }).first()
    await expect(tableCard.locator('pre code')).toContainText('머리1')
    await expect(tableCard.locator('.viewer table')).toBeVisible()

    const imageCard = dialog.locator('.help-card', { hasText: '이미지' }).first()
    await expect(imageCard.locator('pre code')).toContainText('attachments/0000000000000000.png')
    await expect(imageCard.locator('.viewer .md-image-missing')).toBeVisible()
  })
})

test.describe('F-235 A4 범위 제외', () => {
  test('카드 이름에 하이라이트·주석·수식·각주가 없다', async ({ page }) => {
    await openApp(page)
    const dialog = await openHelpDialog(page)
    const text = await dialog.locator('.help-card-name').allTextContents()
    const joined = text.join(' ')
    for (const word of ['하이라이트', '주석', '수식', '각주']) {
      expect(joined).not.toContain(word)
    }
  })
})

test.describe('F-235 A5 닫기', () => {
  test('Esc·바깥 클릭·닫기 버튼 모두 닫히고 포커스가 도움말 버튼으로 돌아온다', async ({ page }) => {
    await openApp(page)
    const helpBtn = page.getByRole('button', { name: '도움말' }).first()

    await openHelpDialog(page)
    await page.keyboard.press('Escape')
    await expect(page.locator('.dialog[open]')).toHaveCount(0)
    await expect(helpBtn).toBeFocused()

    await openHelpDialog(page)
    await page.mouse.click(5, 5) // 다이얼로그 바깥(::backdrop) — 이벤트 target 이 dialog 자체가 된다
    await expect(page.locator('.dialog[open]')).toHaveCount(0)
    await expect(helpBtn).toBeFocused()

    const dialog3 = await openHelpDialog(page)
    await dialog3.getByRole('button', { name: '닫기' }).click()
    await expect(page.locator('.dialog[open]')).toHaveCount(0)
    await expect(helpBtn).toBeFocused()
  })
})

test.describe('F-235 A6 좁은 창', () => {
  test('400x800 에서 카드가 가로 스크롤 없이 세로로 쌓인다', async ({ page }) => {
    await openApp(page)
    await resizeWindow(page, 400, 800)
    await page.locator('.sidebar-toggle').first().click()
    await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'open')
    const dialog = await openHelpDialog(page)
    await expect(dialog).toBeVisible()

    const hasHorizontalOverflow = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(hasHorizontalOverflow).toBe(false)

    const cards = dialog.locator('.help-card')
    const first = await cards.first().evaluate((el) => el.getBoundingClientRect())
    const second = await cards.nth(1).evaluate((el) => el.getBoundingClientRect())
    expect(second.top).toBeGreaterThanOrEqual(first.bottom - 1)
  })
})
