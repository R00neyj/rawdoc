// 단축키 판 — 여는 진입점 셋, 사용 감지, 자리, 열린 화면 (specs/features/F-2052.md)
import { test, expect } from '@playwright/test'
import { openApp, openAppHome, importMarkdown, rectOf, openHelpFromSidebar } from './helpers.js'
import { longDoc } from './fixtures/docs.js'

const LEAD = '표\n\n'
const TABLE_DOC = `${LEAD}| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n`

const panel = (page) => page.locator('#shortcut-panel')
const shortcutsButton = (page) => page.locator('.statusbar').getByRole('button', { name: '단축키' })

test.describe('F-2052 A1·A2·A3·A7 여는 진입점과 닫기 포커스', () => {
  test('F-2052 A1·A2·A3·A7 상태바 버튼·Ctrl+Shift+/·팔레트로 열고, Esc 는 포커스가 판 안일 때만 닫는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })

    // A1 상태바 버튼
    const lastButton = page.locator('.statusbar').getByRole('button').last()
    await expect(lastButton).toHaveAccessibleName('단축키')
    await expect(shortcutsButton(page)).toHaveAttribute('aria-expanded', 'false')
    await shortcutsButton(page).click()
    await expect(panel(page)).toBeVisible()
    await expect(shortcutsButton(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(shortcutsButton(page)).toBeFocused()
    await shortcutsButton(page).click()
    await expect(panel(page)).toBeHidden()

    // A2 Ctrl+Shift+/ — 본문 포커스 유지
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+Shift+Slash')
    await expect(panel(page)).toBeVisible()
    await expect(page.locator('.cm-content')).toBeFocused()
    await page.keyboard.type('X')
    await expect(page.locator('.cm-content')).toContainText('X')
    await page.keyboard.press('Control+Shift+Slash')
    await expect(panel(page)).toBeHidden()

    // A3 팔레트
    await page.keyboard.press('Control+p')
    await page.locator('.command-palette-input').fill('단축키')
    await page.keyboard.press('Enter')
    await expect(panel(page)).toBeVisible()
    await expect(page.locator('dialog[open] .command-palette')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toBeFocused()

    // A7 본문 Esc 는 판을 그대로 두고, 닫기 버튼 Esc 는 닫으며 포커스를 버튼으로
    await page.locator('.cm-content').click()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeVisible()
    await page.locator('.shortcut-panel-close').focus()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
    await expect(shortcutsButton(page)).toBeFocused()
  })
})

test.describe('F-2052 A4·A5·A6 사용 표시와 Tab 구분', () => {
  test('F-2052 A4·A5·A6 Ctrl+B 사용 표시, 새로고침 뒤에도 남음, 표 칸·본문의 Tab 구분', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })

    // A4 연 직후 사용함 0, Ctrl+B 뒤 굵게 항목에 사용함
    await shortcutsButton(page).click()
    const rowCount = await page.locator('.shortcut-row').count()
    await expect(page.locator('.shortcut-panel-count')).toHaveText(`사용함 0 / ${rowCount}`)
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+b')
    await expect(panel(page)).toBeVisible()
    await expect(page.locator('[data-shortcut-id="format.bold"]')).toHaveAttribute('data-used', 'true')
    await expect(page.locator('.shortcut-panel-count')).toHaveText(`사용함 1 / ${rowCount}`)

    // A5 새로고침 — 기록은 남고 판은 닫힌 채 시작
    expect(await page.evaluate(() => window.localStorage.getItem('md.shortcutsUsed'))).toContain('format.bold')
    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(panel(page)).toBeHidden()
    await shortcutsButton(page).click()
    await expect(page.locator('[data-shortcut-id="format.bold"]')).toHaveAttribute('data-used', 'true')

    // A6 표 칸의 Tab 은 다음 칸, 본문 Esc 다음 Tab 은 편집기 빠져나가기 — 둘 다 들여쓰기는 아님
    await importMarkdown(page, { content: TABLE_DOC })
    await expect(panel(page)).toBeVisible()
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

test.describe('F-2052 A8·A9·A12·A13 열린 화면', () => {
  test('F-2052 A8·A9·A12·A13 상태바 없는 화면·다른 대화상자 위는 무시, 열 때 커서 줄 보임, 문서·지도를 오가도 유지', async ({ page }) => {
    await openAppHome(page)
    // A8 홈(문서 없음) — 상태바가 없다
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

    await openHelpFromSidebar(page)
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

    // A9 설정 대화상자를 연 채 Ctrl+Shift+/ 는 무시
    await importMarkdown(page, { content: '본문\n' })
    await page.getByRole('button', { name: '설정', exact: true }).click()
    await expect(page.locator('dialog[open]')).toBeVisible()
    await page.keyboard.press('Control+Shift+Slash')
    await expect(panel(page)).toHaveCount(0)
    await page.keyboard.press('Escape')

    // A12 아래쪽 커서 줄이 판을 연 뒤에도 스크롤 영역 안에 남는다
    await importMarkdown(page, { content: longDoc(200) })
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await shortcutsButton(page).click()
    await expect(panel(page)).toBeVisible()
    await expect
      .poll(async () => {
        const line = await rectOf(page.locator('.cm-content > .cm-line').last())
        const scroller = await rectOf(page.locator('.cm-scroller'))
        return line.top >= scroller.top - 1 && line.bottom <= scroller.bottom + 1
      })
      .toBe(true)

    // A13 다른 문서로 옮기고, 지도를 다녀와도 판이 열려 있다
    const idA = await importMarkdown(page, { name: 'a.md', content: '문서 A\n' })
    await importMarkdown(page, { name: 'b.md', content: '문서 B\n' })
    await expect(panel(page)).toBeVisible()
    await page.locator(`a[href="#/d/${idA}"]`).click()
    await expect(panel(page)).toBeVisible()
    await page.getByRole('button', { name: '지도' }).first().click()
    await expect(page.locator('.map-page')).toBeVisible()
    await page.locator('.map-page').getByRole('button', { name: '닫기', exact: true }).click()
    await expect(panel(page)).toBeVisible()
  })
})
