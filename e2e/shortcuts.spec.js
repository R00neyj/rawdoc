// 단축키 판 — 여는 진입점 셋, 사용 감지, 자리, 열린 화면 (specs/features/F-2052.md)
import { test, expect } from '@playwright/test'
import { openApp, openAppHome, importMarkdown, rectOf } from './helpers.js'
import { longDoc } from './fixtures/docs.js'

const LEAD = '표\n\n'
const TABLE_DOC = `${LEAD}| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n`

const panel = (page) => page.locator('#shortcut-panel')
const shortcutsButton = (page) => page.locator('.statusbar').getByRole('button', { name: '단축키' })

test.describe('F-2052 A1 상태바 버튼으로 여닫기', () => {
  test('마지막 버튼이 단축키, 누르면 열리고 포커스가 버튼, 다시 누르면 닫힌다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })

    const lastButton = page.locator('.statusbar').getByRole('button').last()
    await expect(lastButton).toHaveAccessibleName('단축키')
    await expect(shortcutsButton(page)).toHaveAttribute('aria-expanded', 'false')

    await shortcutsButton(page).click()
    await expect(panel(page)).toBeVisible()
    await expect(shortcutsButton(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(shortcutsButton(page)).toBeFocused()

    await shortcutsButton(page).click()
    await expect(panel(page)).toBeHidden()
  })
})

test.describe('F-2052 A2 Ctrl+Shift+/ 로 여닫기', () => {
  test('본문 포커스를 유지한 채 열고 닫는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content').click()

    await page.keyboard.press('Control+Shift+Slash')
    await expect(panel(page)).toBeVisible()
    await expect(page.locator('.cm-content')).toBeFocused()
    await page.keyboard.type('X')
    await expect(page.locator('.cm-content')).toContainText('X')

    await page.keyboard.press('Control+Shift+Slash')
    await expect(panel(page)).toBeHidden()
  })
})

test.describe('F-2052 A3 팔레트로 열기', () => {
  test('Ctrl+P → 단축키 → Enter — 판이 열리고 팔레트가 닫힌다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content').click()

    await page.keyboard.press('Control+p')
    await page.locator('.command-palette-input').fill('단축키')
    await page.keyboard.press('Enter')

    await expect(panel(page)).toBeVisible()
    await expect(page.locator('dialog[open] .command-palette')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toBeFocused()
  })
})

test.describe('F-2052 A4 사용 표시', () => {
  test('연 직후 사용함 0, 본문에서 Ctrl+B — 판을 닫지 않고 굵게 항목에 사용함이 붙는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })

    await shortcutsButton(page).click()
    const rowCount = await page.locator('.shortcut-row').count()
    await expect(page.locator('.shortcut-panel-count')).toHaveText(`사용함 0 / ${rowCount}`)

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+b')

    await expect(panel(page)).toBeVisible()
    await expect(page.locator('[data-shortcut-id="format.bold"]')).toHaveAttribute('data-used', 'true')
    await expect(page.locator('.shortcut-panel-count')).toHaveText(`사용함 1 / ${rowCount}`)
  })
})

test.describe('F-2052 A5 새로고침 뒤에도 남는다', () => {
  test('사용 기록이 localStorage 에 남고, 판은 닫힌 채 시작한다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+b')

    const raw = await page.evaluate(() => window.localStorage.getItem('md.shortcutsUsed'))
    expect(raw).toContain('format.bold')

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(panel(page)).toBeHidden()

    await shortcutsButton(page).click()
    await expect(page.locator('[data-shortcut-id="format.bold"]')).toHaveAttribute('data-used', 'true')
  })
})

test.describe('F-2052 A6 표 칸과 본문에서 갈리는 Tab', () => {
  test('칸에서 Tab 은 다음 칸, 본문에서 Esc 다음 Tab 은 편집기 빠져나가기 — 둘 다 들여쓰기는 아니다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: TABLE_DOC })
    await shortcutsButton(page).click()

    const cell = page.locator('.md-table-widget td, .md-table-widget th').first()
    await cell.click()
    await page.keyboard.press('Tab')
    await expect(page.locator('[data-shortcut-id="table.nextCell"]')).toHaveAttribute('data-used', 'true')
    await expect(page.locator('[data-shortcut-id="edit.indent"]')).not.toHaveAttribute('data-used', 'true')

    await page.locator('.cm-content').getByText('표', { exact: true }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Tab')
    await expect(page.locator('[data-shortcut-id="nav.leaveEditor"]')).toHaveAttribute('data-used', 'true')
    await expect(page.locator('[data-shortcut-id="edit.indent"]')).not.toHaveAttribute('data-used', 'true')
  })
})

test.describe('F-2052 A7 Esc 는 포커스가 판 안일 때만 닫는다', () => {
  test('본문 Esc 는 판을 그대로 두고, 닫기 버튼 Esc 는 닫으며 포커스를 ? 버튼으로', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await shortcutsButton(page).click()

    await page.locator('.cm-content').click()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeVisible()

    await page.locator('.shortcut-panel-close').focus()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
    await expect(shortcutsButton(page)).toBeFocused()
  })
})

test.describe('F-2052 A8 상태바가 없는 화면', () => {
  test('지도·홈·도움말에서 단축키 버튼이 0개이고 Ctrl+Shift+/ 로도 판이 안 뜬다', async ({ page }) => {
    await openAppHome(page)
    // 홈(문서 없음) — 상태바가 없다
    await expect(shortcutsButton(page)).toHaveCount(0)
    await page.keyboard.press('Control+Shift+Slash')
    await expect(panel(page)).toHaveCount(0)

    await importMarkdown(page, { content: '본문\n' })

    await page.getByRole('button', { name: '지도' }).first().click()
    await expect(page.locator('.map-page')).toBeVisible()
    await expect(shortcutsButton(page)).toHaveCount(0)
    await page.keyboard.press('Control+Shift+Slash')
    await expect(panel(page)).toHaveCount(0)
    await page.locator('.map-page').getByRole('button', { name: '닫기', exact: true }).click()

    await page.getByRole('button', { name: '도움말' }).first().click()
    await expect(page.locator('.help-page')).toBeVisible()
    await expect(shortcutsButton(page)).toHaveCount(0)
    await page.keyboard.press('Control+Shift+Slash')
    await expect(panel(page)).toHaveCount(0)

    // 도움말 닫기 → 홈으로 되돌아가도 여전히 없다(goHome, useDocNavigation.ts)
    await page.locator('.help-page').getByRole('button', { name: '닫기', exact: true }).click()
    await expect(page.locator('.empty-state')).toBeVisible()
    await expect(shortcutsButton(page)).toHaveCount(0)
    await page.keyboard.press('Control+Shift+Slash')
    await expect(panel(page)).toHaveCount(0)
  })
})

test.describe('F-2052 A9 다른 대화상자 위에서는 무시', () => {
  test('설정 대화상자를 연 채 Ctrl+Shift+/ 를 눌러도 판이 열리지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await page.getByRole('button', { name: '설정', exact: true }).click()
    await expect(page.locator('dialog[open]')).toBeVisible()

    await page.keyboard.press('Control+Shift+Slash')
    await expect(panel(page)).toHaveCount(0)
  })
})

test.describe('F-2052 A10 터치 전용 기기', () => {
  test.use({ hasTouch: true })

  test('단축키 버튼이 숨어 있다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    await expect(shortcutsButton(page)).toBeHidden()
  })
})

test.describe('F-2052 A11 메인 열을 밀어올린다', () => {
  test('판이 편집 영역을 줄이고 상태바 위에 자리를 잡는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })

    const contentArea = page.locator('.content-area')
    const before = await rectOf(contentArea)

    await shortcutsButton(page).click()
    await expect(panel(page)).toBeVisible()

    const after = await rectOf(contentArea)
    const panelRect = await rectOf(panel(page))
    const statusbarRect = await rectOf(page.locator('.statusbar'))

    expect(after.bottom).toBeLessThanOrEqual(panelRect.top + 2)
    expect(panelRect.bottom).toBeLessThanOrEqual(statusbarRect.top + 2)
    expect(after.height).toBeLessThan(before.height)
  })
})

test.describe('F-2052 A12 열 때 커서 줄 보이기', () => {
  test('아래쪽 커서 줄이 판을 연 뒤에도 스크롤 영역 안에 남는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: longDoc(200) })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')

    await shortcutsButton(page).click()
    await expect(panel(page)).toBeVisible()

    // 커서가 있는 문서 마지막 줄 — 포커스가 버튼으로 옮겨가 cm-cursor 블링크 레이어가 없어질 수 있어 렌더된 마지막 .cm-line 으로 잰다
    await expect
      .poll(async () => {
        const line = await rectOf(page.locator('.cm-content > .cm-line').last())
        const scroller = await rectOf(page.locator('.cm-scroller'))
        return line.top >= scroller.top - 1 && line.bottom <= scroller.bottom + 1
      })
      .toBe(true)
  })
})

test.describe('F-2052 A13 문서·지도를 오가도 열림이 유지된다', () => {
  test('다른 문서로 옮기고, 지도를 다녀와도 판이 열려 있다', async ({ page }) => {
    await openApp(page)
    const idA = await importMarkdown(page, { name: 'a.md', content: '문서 A\n' })
    const idB = await importMarkdown(page, { name: 'b.md', content: '문서 B\n' })
    expect(idA).not.toBe(idB)

    await shortcutsButton(page).click()
    await expect(panel(page)).toBeVisible()

    await page.locator(`a[href="#/d/${idA}"]`).click()
    await expect(panel(page)).toBeVisible()

    await page.getByRole('button', { name: '지도' }).first().click()
    await expect(page.locator('.map-page')).toBeVisible()
    await page.locator('.map-page').getByRole('button', { name: '닫기', exact: true }).click()

    await expect(panel(page)).toBeVisible()
  })
})
