// 명령 팔레트 확장 — 문서 섞기·`>`·초성·최근·고정·만들기·버튼 (specs/features/F-2053.md 11.2)
import { test, expect } from '@playwright/test'
import { openApp } from './helpers.js'

const palette = (page) => page.locator('dialog[open] .command-palette')
const options = (page) => palette(page).getByRole('option')
const sections = (page) => palette(page).locator('.command-palette-section')
const input = (page) => palette(page).locator('.command-palette-input')

async function stubPrint(page) {
  await page.addInitScript(() => {
    window.print = () => {}
  })
}

async function fillTitle(page, text) {
  await page.locator('.doc-title').fill(text)
  await page.locator('.doc-title').blur()
}

async function newTopDoc(page, title) {
  await page.getByRole('button', { name: '새 문서' }).click()
  await expect(page.locator('.doc-title')).toBeVisible()
  await fillTitle(page, title)
}

// A1 준비 — `여행 계획`·`회의록 모음`·`본 문서`(지금 문서)
async function setupDocs(page) {
  await openApp(page)
  await fillTitle(page, '여행 계획')
  await newTopDoc(page, '회의록 모음')
  await newTopDoc(page, '본 문서')
  await page.locator('.cm-content').click()
}

async function openPalette(page) {
  await page.keyboard.press('Control+p')
  await expect(palette(page)).toBeVisible()
}

test.describe('F-2053 명령 팔레트 확장', () => {
  test.beforeEach(async ({ page }) => {
    await stubPrint(page)
  })

  test('F-2053 A1 빈 입력 첫 화면 — 최근 문서 → 명령', async ({ page }) => {
    await setupDocs(page)
    await openPalette(page)
    await expect(sections(page)).toHaveText(['최근 문서', '명령'])
    await expect(palette(page).locator('.command-palette-item--doc')).toHaveText([/회의록 모음/, /여행 계획/])
    await expect(options(page).first()).toHaveAttribute('aria-selected', 'true')
  })

  test('F-2053 A2 최근 명령 — 쓴 명령이 최근 구역으로', async ({ page }) => {
    await setupDocs(page)
    await openPalette(page)
    await input(page).fill('>인쇄')
    await page.keyboard.press('Enter')
    await expect(palette(page)).toHaveCount(0)
    // dialog close 이벤트(포커스 복귀, Dialog.tsx)가 나중 태스크라 한 틱 흘려보낸다(palette.spec.js 와 같은 경합)
    await page.waitForTimeout(50)
    await openPalette(page)
    await expect(sections(page)).toHaveText(['최근', '최근 문서', '명령'])
    expect(await page.evaluate(() => localStorage.getItem('md.paletteRecent'))).toBe('["doc.print"]')
  })

  test('F-2053 A3 고정 — Alt+P 로 고정·해제', async ({ page }) => {
    await setupDocs(page)
    await openPalette(page)
    await input(page).fill('>')
    // 선택을 PDF 줄로 옮긴 뒤 고정
    const idx = await options(page).evaluateAll((els) => els.findIndex((e) => e.textContent.includes('PDF (A4 인쇄)')))
    for (let i = 0; i < idx; i += 1) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Alt+p')
    await expect(sections(page).first()).toHaveText('고정')
    await expect(input(page)).toHaveValue('>')
    expect(await page.evaluate(() => localStorage.getItem('md.palettePinned'))).toBe('["doc.print"]')
    await page.keyboard.press('Alt+p')
    await expect(sections(page).filter({ hasText: '고정' })).toHaveCount(0)
  })

  test('F-2053 A5 문서 섞기와 열기 + A10 새 문서 만들기', async ({ page }) => {
    await setupDocs(page)
    await openPalette(page)
    await input(page).fill('여행')
    await expect(sections(page)).toHaveText(['문서'])
    await expect(options(page).first()).toContainText('여행 계획')
    await expect(options(page).last()).toContainText("'여행' 새 문서 만들기")
    await page.keyboard.press('Enter')
    await expect(palette(page)).toHaveCount(0)
    await expect(page.locator('.doc-title')).toHaveValue('여행 계획')

    await openPalette(page)
    await input(page).fill('장보기 목록')
    await expect(options(page)).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(page.locator('.doc-title')).toHaveValue('장보기 목록')
    await expect(page.locator('.sidebar .doc-item-btn', { hasText: '장보기 목록' })).toBeVisible()
  })

  test('F-2053 A7 > 명령 모드 + A8 초성', async ({ page }) => {
    await setupDocs(page)
    await openPalette(page)
    await input(page).fill('>여행')
    await expect(options(page)).toHaveCount(0)
    await input(page).fill('>ㅌㅍㄹ')
    await expect(options(page).first()).toContainText('템플릿 삽입')
    await input(page).fill('ㅇㅎ ㄱ')
    await expect(options(page).first()).toContainText('여행 계획')
    await input(page).fill('ㅋㅋㅋ')
    await expect(options(page)).toHaveCount(0)
  })

  test('F-2053 A16 버튼 — 넓은 창 사이드바', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openApp(page)
    await page.locator('.sidebar').getByRole('button', { name: '명령 팔레트', exact: true }).click()
    await expect(palette(page)).toBeVisible()
  })
})
