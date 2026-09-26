// 본문 너비 설정 (specs/features/F-2043.md) — A1~A10
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

test.describe('F-2043 A1 자리·기본값', () => {
  test('편집기 탭 순서, 슬라이더·숫자 입력 기본 800', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettingsEditorTab(page)
    const panel = dialog.locator('.settings-panel')

    await expect(panel.locator('.dialog-field > span')).toHaveText(['탭바', '들여쓰기', '줄 번호', '본문 너비', '새 문서 템플릿'])
    await expect(slider(page)).toHaveValue('800')
    await expect(spinbutton(page)).toHaveValue('800')
    await expect(slider(page)).toHaveAttribute('aria-valuetext', '800px')
  })
})

test.describe('F-2043 A2 슬라이더 키보드', () => {
  test('ArrowRight +20, End 1600 — 값·--content-max·저장값 모두 같이 바뀐다', async ({ page }) => {
    await openApp(page)
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
  })
})

test.describe('F-2043 A3 숫자 입력 — 확정 전에도 정확한 값은 즉시 반영', () => {
  test('fill(1200), 초점 유지', async ({ page }) => {
    await openApp(page)
    await openSettingsEditorTab(page)
    await spinbutton(page).fill('1200')

    await expect(slider(page)).toHaveValue('1200')
    expect(await getContentMax(page)).toBe('1200px')
    expect(await getSavedContentWidth(page)).toBe('1200')
  })
})

test.describe('F-2043 A4 숫자 입력 확정 — 맞추기·되돌리기', () => {
  test('Enter·Tab 확정, 빈 칸은 되돌아온다', async ({ page }) => {
    await openApp(page)
    await openSettingsEditorTab(page)
    const input = spinbutton(page)

    await input.fill('1210')
    await input.press('Enter')
    await expect(input).toHaveValue('1220')
    await expect(slider(page)).toHaveValue('1220')
    expect(await getContentMax(page)).toBe('1220px')
    expect(await getSavedContentWidth(page)).toBe('1220')

    await input.fill('5000')
    await input.press('Tab')
    await expect(input).toHaveValue('1600')
    expect(await getContentMax(page)).toBe('1600px')
    expect(await getSavedContentWidth(page)).toBe('1600')

    await input.focus()
    await input.fill('100')
    await input.press('Enter')
    await expect(input).toHaveValue('600')
    expect(await getContentMax(page)).toBe('600px')
    expect(await getSavedContentWidth(page)).toBe('600')

    await input.focus()
    await input.fill('')
    await input.press('Tab')
    await expect(input).toHaveValue('600')
    expect(await getSavedContentWidth(page)).toBe('600')
  })
})

test.describe('F-2043 A5 Esc — 되돌리고 대화상자는 평소대로 닫힌다', () => {
  test('1200 인 상태에서 1210 을 쳐 두고 Esc', async ({ page }) => {
    await openApp(page)
    await setContentWidthViaSettings(page, 1200)

    const dialog = await openSettingsEditorTab(page)
    const input = spinbutton(page)
    await input.fill('1210')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    expect(await getContentMax(page)).toBe('1200px')
    expect(await getSavedContentWidth(page)).toBe('1200')

    await openSettingsEditorTab(page)
    await expect(spinbutton(page)).toHaveValue('1200')
  })
})

test.describe('F-2043 A6 화면 반영 — 편집·보기 모드', () => {
  test('800 → 1200, .cm-content·.viewer 본문 칸이 400±2px 늘어난다', async ({ page }) => {
    await resizeWindow(page, 1920, 1080)
    await openApp(page)
    await importMarkdown(page, { content: longDoc(30) })

    const before = await page.locator('.cm-content').evaluate((el) => el.getBoundingClientRect().width)
    await setContentWidthViaSettings(page, 1200)
    const after = await page.locator('.cm-content').evaluate((el) => el.getBoundingClientRect().width)
    expect(after - before).toBeGreaterThan(398)
    expect(after - before).toBeLessThan(402)

    await setContentWidthViaSettings(page, 800)
    await setViewMode(page, 'view')

    function viewerContentWidth() {
      return page.locator('.viewer:not(.print-root)').evaluate((el) => {
        const cs = getComputedStyle(el)
        return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      })
    }

    const viewerBefore = await viewerContentWidth()
    await setContentWidthViaSettings(page, 1200)
    const viewerAfter = await viewerContentWidth()
    expect(viewerAfter - viewerBefore).toBeGreaterThan(398)
    expect(viewerAfter - viewerBefore).toBeLessThan(402)
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
      const emptyMax = await page.locator('.empty-state').evaluate((el) => getComputedStyle(el).maxWidth)
      expect(emptyMax).toBe('1400px')

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

test.describe('F-2043 A8 좁은 창 — 메인 열에 맞춰 줄어든다', () => {
  test('1024×768, 값 1600 — 가로 스크롤 없음, padding-left 0', async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.contentWidth', '1600')
    await resizeWindow(page, 1024, 768)
    await openApp(page)
    await importMarkdown(page, { content: longDoc(10) })

    const sizes = await page.locator('.cm-scroller').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      paddingLeft: getComputedStyle(el).paddingLeft,
    }))
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth)
    expect(sizes.paddingLeft).toBe('0px')
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

test.describe('F-2043 A10 400px 창 — 편집기 탭 가로 넘침 없음', () => {
  test('슬라이더·숫자 입력 둘 다 보인다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await resizeWindow(page, 400, 800)

    const dialog = await openSettingsEditorTab(page)
    await expect(dialog).toBeVisible()

    const sizes = await page.evaluate(() => ({
      scrollWidth: document.scrollingElement.scrollWidth,
      clientWidth: document.scrollingElement.clientWidth,
    }))
    expect(sizes.scrollWidth).toBeLessThanOrEqual(sizes.clientWidth)
    expect(await dialog.evaluate((el) => el.offsetWidth)).toBeLessThanOrEqual(400)
    await expect(slider(page)).toBeVisible()
    await expect(spinbutton(page)).toBeVisible()
  })
})
