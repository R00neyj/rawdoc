// 본문 너비 설정 (specs/features/F-2043.md) — A2·A5·A6·A7·A9
import { test, expect } from '@playwright/test'
import { openApp, openAppHome, importMarkdown, resizeWindow, setPrefBeforeLoad, setViewMode, waitTransitionEnd } from './helpers.js'
import { longDoc } from './fixtures/docs.js'

const DIALOG_SELECTOR = 'dialog[aria-labelledby="settings-title"]'

// 좁은 창에서는 사이드바가 겹침(overlay)이라 먼저 펴야 설정 버튼이 보인다 (e2e/settingsTabs.spec.js 와 같은 방식)
async function ensureSidebarOpen(page) {
  const sidebar = page.locator('.sidebar')
  const isOverlay = await sidebar.evaluate((el) => el.classList.contains('sidebar--overlay'))
  if (!isOverlay) return
  if ((await sidebar.getAttribute('data-state')) === 'open') return
  await page.locator('.sidebar-toggle').first().click()
  await expect(sidebar).toHaveAttribute('data-state', 'open')
  await waitTransitionEnd(sidebar)
}

async function openSettingsEditorTab(page) {
  await ensureSidebarOpen(page)
  await page.getByRole('button', { name: '설정', exact: true }).first().click()
  const dialog = page.locator(DIALOG_SELECTOR)
  await dialog.getByRole('tab', { name: '편집기' }).click()
  return dialog
}

async function closeSettings(page) {
  await page.getByRole('button', { name: '닫기', exact: true }).click()
}

function slider(page) {
  return page.getByRole('slider', { name: '본문 너비' })
}

function spinbutton(page) {
  return page.getByRole('spinbutton', { name: '본문 너비' })
}

async function getContentMax(page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--content-max').trim())
}

async function getSavedContentWidth(page) {
  return page.evaluate(() => localStorage.getItem('md.contentWidth'))
}

// 숫자 입력에 값을 넣고 Enter 로 확정, 설정을 닫는다
async function setContentWidthViaSettings(page, px) {
  await openSettingsEditorTab(page)
  const input = spinbutton(page)
  await input.fill(String(px))
  await input.press('Enter')
  await closeSettings(page)
}

// 본문 칸이 몇 px 늘었는지는 시각 값이라 --content-max 가 편집·보기 모드 본문 칸까지 닿는지만 본다
test.describe('F-2043 A2·A5·A6 슬라이더 키보드·Esc·화면 반영', () => {
  test('F-2043 A2·A5·A6 슬라이더 키로 값·--content-max·저장값이 같이 바뀌고, Esc 는 되돌리고, 편집·보기 본문 칸에 닿는다', async ({ page }) => {
    await resizeWindow(page, 1920, 1080)
    await openApp(page)
    await importMarkdown(page, { content: longDoc(30) })

    await openSettingsEditorTab(page)
    await slider(page).focus()
    await page.keyboard.press('ArrowRight')
    await expect(slider(page)).toHaveValue('820')
    await expect(spinbutton(page)).toHaveValue('820')
    expect(await getContentMax(page)).toBe('820px')
    expect(await getSavedContentWidth(page)).toBe('820')

    await page.keyboard.press('End')
    await expect(slider(page)).toHaveValue('1600')
    await expect(spinbutton(page)).toHaveValue('1600')
    expect(await getContentMax(page)).toBe('1600px')
    expect(await getSavedContentWidth(page)).toBe('1600')
    await closeSettings(page)

    await setContentWidthViaSettings(page, 1200)
    const dialog = await openSettingsEditorTab(page)
    await spinbutton(page).fill('1210')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    expect(await getContentMax(page)).toBe('1200px')
    expect(await getSavedContentWidth(page)).toBe('1200')
    await openSettingsEditorTab(page)
    await expect(spinbutton(page)).toHaveValue('1200')
    await closeSettings(page)

    const contentMaxOf = (locator) => locator.evaluate((el) => getComputedStyle(el).getPropertyValue('--content-max').trim())
    expect(await contentMaxOf(page.locator('.cm-content'))).toBe('1200px')
    await setViewMode(page, 'view')
    expect(await contentMaxOf(page.locator('.viewer:not(.print-root)'))).toBe('1200px')
  })
})

test.describe('F-2043 A7 저장값으로 열기 — 인라인 값·홈 화면·설정 칸, 새로고침 뒤도', () => {
  test('저장값 1400', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.contentWidth', '1400')
    await openAppHome(page)

    async function checkAll() {
      const inline = await page.evaluate(() => document.documentElement.style.getPropertyValue('--content-width').trim())
      expect(inline).toBe('1400px')
      expect(await getContentMax(page)).toBe('1400px')

      await openSettingsEditorTab(page)
      await expect(slider(page)).toHaveValue('1400')
      await expect(spinbutton(page)).toHaveValue('1400')
      await closeSettings(page)
    }

    await checkAll()
    await page.reload()
    await expect(page.locator('.empty-state')).toBeVisible()
    await checkAll()
  })
})

test.describe('F-2043 A9 목차 여백 다시 판정', () => {
  test('창 크기는 그대로, 값만 바꿔도 선 목차 ↔ 목차 버튼 전환', async ({ page }) => {
    await resizeWindow(page, 1600, 900)
    await openApp(page)
    await importMarkdown(page, { content: '# 제목\n' })
    await expect(page.locator('.outline-rail')).toHaveCount(1)

    await openSettingsEditorTab(page)
    await slider(page).focus()
    await page.keyboard.press('End')
    await expect(page.locator('.outline-rail')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '목차' })).toBeVisible()

    await page.keyboard.press('Home')
    await expect(page.locator('.outline-rail')).toHaveCount(1)
    await expect(page.getByRole('button', { name: '목차' })).toHaveCount(0)
  })
})
