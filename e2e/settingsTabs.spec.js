// 설정 대화상자 왼쪽 탭 (specs/features/F-290.md) — A3~A11
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, resizeWindow, waitTransitionEnd } from './helpers.js'

const DIALOG_SELECTOR = 'dialog[aria-labelledby="settings-title"]'

async function openSettings(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  return page.locator(DIALOG_SELECTOR)
}

// 좁은 창에서는 사이드바가 겹침(overlay)이라 먼저 펴야 설정 버튼이 보인다 (e2e/dialogLayout.spec.js 와 같은 방식)
async function ensureSidebarOpen(page) {
  const sidebar = page.locator('.sidebar')
  const isOverlay = await sidebar.evaluate((el) => el.classList.contains('sidebar--overlay'))
  if (!isOverlay) return
  if ((await sidebar.getAttribute('data-state')) === 'open') return
  await page.locator('.sidebar-toggle').first().click()
  await expect(sidebar).toHaveAttribute('data-state', 'open')
  await waitTransitionEnd(sidebar)
}

test.describe('F-290 A3 탭 목록과 기본 탭', () => {
  test('탭 4개, 화면이 기본 선택 (F-404 9장)', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)
    await expect(dialog.locator('[role="tablist"]')).toHaveCount(1)

    const tabs = dialog.locator('[role="tab"]')
    await expect(tabs).toHaveCount(4)
    await expect(tabs.nth(0)).toHaveText('화면')
    await expect(tabs.nth(1)).toHaveText('편집기')
    await expect(tabs.nth(2)).toHaveText('데이터')
    await expect(tabs.nth(3)).toHaveText('금고')
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false')
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'false')
    await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'false')
  })
})

test.describe('F-290 A4 탭별 항목', () => {
  test('화면 → 편집기 → 데이터, 다른 탭 라벨은 DOM 에 없다', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)
    const panel = dialog.locator('.settings-panel')

    await expect(panel.locator('.dialog-field > span')).toHaveText(['테마', '제목 서체', '본문 서체', '글자 크기', '시작 화면'])
    await expect(dialog.locator('#indent-label')).toHaveCount(0)

    await dialog.getByRole('tab', { name: '편집기' }).click()
    await expect(panel.locator('.dialog-field > span')).toHaveText(['탭바', '들여쓰기', '줄 번호', '새 문서 템플릿'])
    await expect(dialog.locator('#theme-label')).toHaveCount(0)

    await dialog.getByRole('tab', { name: '데이터' }).click()
    await expect(panel.locator('.dialog-field > span')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '전체 내보내기' })).toBeVisible()
    await expect(dialog.locator('#toolbar-label')).toHaveCount(0)
  })
})

test.describe('F-290 A5 자동 활성화', () => {
  test('방향키로 Enter 없이 바로 전환, 순환, Home/End (F-404 9장 — 금고 포함 4탭)', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)
    const tabs = dialog.locator('[role="tab"]')
    await expect(tabs.nth(0)).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(1)).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(2)).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(3)).toBeFocused()

    await page.keyboard.press('ArrowDown') // 순환
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(0)).toBeFocused()

    await page.keyboard.press('End')
    await expect(tabs.nth(3)).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Home')
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('ArrowRight')
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('ArrowLeft')
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('F-290 A6 ARIA 연결과 로빙 tabindex', () => {
  test('aria-controls·aria-labelledby, 활성 탭만 tabindex 0 (F-404 9장 — 금고 포함 4탭)', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)
    const tabs = dialog.locator('[role="tab"]')

    await expect(tabs.nth(0)).toHaveAttribute('aria-controls', 'settings-panel-screen')
    await expect(tabs.nth(1)).toHaveAttribute('aria-controls', 'settings-panel-editor')
    await expect(tabs.nth(2)).toHaveAttribute('aria-controls', 'settings-panel-data')
    await expect(tabs.nth(3)).toHaveAttribute('aria-controls', 'settings-panel-e2ee')
    await expect(tabs.nth(0)).toHaveAttribute('tabindex', '0')
    await expect(tabs.nth(1)).toHaveAttribute('tabindex', '-1')
    await expect(tabs.nth(2)).toHaveAttribute('tabindex', '-1')
    await expect(tabs.nth(3)).toHaveAttribute('tabindex', '-1')

    const panel = dialog.locator('[role="tabpanel"]')
    await expect(panel).toHaveAttribute('id', 'settings-panel-screen')
    await expect(panel).toHaveAttribute('aria-labelledby', 'settings-tab-screen')
    await expect(panel).not.toHaveAttribute('tabindex')
  })
})

test.describe('F-290 A7 포커스', () => {
  test('열면 화면 탭, Tab 하면 패널 첫 조작 요소, Esc 로 닫고 포커스 복귀', async ({ page }) => {
    await openApp(page)
    const settingsBtn = page.getByRole('button', { name: '설정', exact: true })
    const dialog = await openSettings(page)
    const tabs = dialog.locator('[role="tab"]')
    await expect(tabs.nth(0)).toBeFocused()

    await page.keyboard.press('Tab')
    const themeFirstRadio = dialog.locator('#theme-label').locator('..').locator('[role="radio"]').first()
    await expect(themeFirstRadio).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(settingsBtn).toBeFocused()
  })
})

test.describe('F-290 A8 데이터 탭 버튼 (스모크)', () => {
  test('전체 내보내기 버튼이 보이고 눌리며 다운로드, 데이터 라벨 없음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    const dialog = await openSettings(page)
    await dialog.getByRole('tab', { name: '데이터' }).click()

    const exportBtn = dialog.getByRole('button', { name: '전체 내보내기' })
    await expect(exportBtn).toBeVisible()
    const [download] = await Promise.all([page.waitForEvent('download'), exportBtn.click()])
    expect(download.suggestedFilename()).toMatch(/\.zip$/)

    await expect(dialog.locator('#data-export-label')).toHaveCount(0)
  })
})

test.describe('F-290 A9 공개 보기', () => {
  test('탭 목록 없이 화면 4항목만', async ({ page }) => {
    await page.route('**/pub/docs/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          title: '공개 문서',
          content: '본문\n',
          lineEnding: 'lf',
          updatedAt: 1_700_000_000_000,
        }),
      }),
    )
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-title')).toHaveText('공개 문서')

    const dialog = await openSettings(page)
    await expect(dialog.locator('[role="tablist"]')).toHaveCount(0)
    await expect(dialog.locator('.dialog-field > span')).toHaveText(['테마', '제목 서체', '본문 서체', '글자 크기'])
  })
})

test.describe('F-290 A10 탭을 기억하지 않는다', () => {
  test('데이터로 옮기고 닫은 뒤 다시 열면 화면', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)
    await dialog.getByRole('tab', { name: '데이터' }).click()
    await expect(dialog.getByRole('tab', { name: '데이터' })).toHaveAttribute('aria-selected', 'true')

    await page.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(dialog).toBeHidden()

    await page.getByRole('button', { name: '설정', exact: true }).click()
    await expect(dialog.getByRole('tab', { name: '화면' })).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('F-290 A11 좁은 창 (스모크)', () => {
  test('400x800 에서 가로 tablist, 1280x800 에서 세로', async ({ page }) => {
    await openApp(page)
    await resizeWindow(page, 400, 800)
    await ensureSidebarOpen(page)

    const dialog = await openSettings(page)
    const tabs = dialog.locator('[role="tab"]')
    await expect(tabs).toHaveCount(4)
    await expect(dialog.locator('[role="tablist"]')).toHaveAttribute('aria-orientation', 'horizontal')

    await dialog.getByRole('tab', { name: '데이터' }).click()
    await expect(dialog.getByRole('button', { name: '전체 내보내기' })).toBeVisible()

    await page.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(dialog).toBeHidden()

    await resizeWindow(page, 1280, 800)
    await page.getByRole('button', { name: '설정', exact: true }).click()
    await expect(dialog.locator('[role="tablist"]')).toHaveAttribute('aria-orientation', 'vertical')
  })
})
