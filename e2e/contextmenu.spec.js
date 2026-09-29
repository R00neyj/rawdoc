// 우클릭 메뉴와 클립보드 (specs/features/F-170.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setViewMode, fakeImeCompose } from './helpers.js'

const root = (page) => page.locator('.context-menu-root')

async function openEditorMenu(page, locator, opts = {}) {
  const box = await locator.boundingBox()
  const x = box.x + (opts.dx ?? 5)
  const y = box.y + (opts.dy ?? box.height / 2)
  await page.mouse.click(x, y, { button: 'right' })
  return { x, y }
}

// 우클릭에서 브라우저 기본 contextmenu 가 막혔는지 — 리스너를 먼저 붙인 뒤 클릭해야 경쟁이 없다
async function rightClickAndCheckDefault(page, x, y, { shift = false } = {}) {
  await page.evaluate(() => {
    window.pwContextMenuPrevented = new Promise((resolve) => {
      window.addEventListener('contextmenu', (e) => resolve(e.defaultPrevented), { capture: true, once: true })
    })
  })
  if (shift) await page.keyboard.down('Shift')
  await page.mouse.click(x, y, { button: 'right' })
  if (shift) await page.keyboard.up('Shift')
  return page.evaluate(() => window.pwContextMenuPrevented)
}

// 안드로이드 길게 누르기는 contextmenu(pointerType touch) 로 온다 — 막으면 글자 선택과 OS 복사·붙여넣기 도구상자가 사라진다 (2026-09-27 버그)
async function touchContextMenu(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    const r = el.getBoundingClientRect()
    const ev = new PointerEvent('contextmenu', {
      pointerType: 'touch', bubbles: true, cancelable: true, clientX: r.x + 5, clientY: r.y + 5, button: 2,
    })
    el.dispatchEvent(ev)
    return ev.defaultPrevented
  }, selector)
}

test.describe('F-170 A3·A12 앱 메뉴를 열지 않는 곳', () => {
  test('F-170 A3·A12 사이드바·상단바·Shift+우클릭·터치 길게 누르기·한글 조합 중에는 앱 메뉴를 열지 않고 기본 동작을 막지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })

    // A3 사이드바 우클릭 — 기본 동작을 막지 않는다
    const sidebarBox = await page.locator('.sidebar').boundingBox()
    expect(await rightClickAndCheckDefault(page, sidebarBox.x + sidebarBox.width / 2, sidebarBox.y + 10)).toBe(false)
    await expect(root(page)).toHaveCount(0)

    // A3 상단바 우클릭
    const topbarBox = await page.locator('.topbar').boundingBox()
    await page.mouse.click(topbarBox.x + topbarBox.width / 2, topbarBox.y + topbarBox.height / 2, { button: 'right' })
    await expect(root(page)).toHaveCount(0)

    // A3 본문 Shift+우클릭은 앱 메뉴 대신 기본 메뉴
    const lineBox = await page.locator('.cm-line', { hasText: '본문' }).boundingBox()
    expect(await rightClickAndCheckDefault(page, lineBox.x + 5, lineBox.y + 5, { shift: true })).toBe(false)
    await expect(root(page)).toHaveCount(0)

    // 터치 길게 누르기 — 편집기·보기 모드
    await page.locator('.cm-line').first().click()
    expect(await touchContextMenu(page, '.cm-content .cm-line')).toBe(false)
    await expect(root(page)).toHaveCount(0)
    await setViewMode(page, 'view')
    await expect(page.locator('.viewer .markdown-body')).toBeVisible()
    expect(await touchContextMenu(page, '.viewer .markdown-body p')).toBe(false)
    await expect(root(page)).toHaveCount(0)

    // A12 한글 조합 중 우클릭
    await setViewMode(page, 'live')
    await importMarkdown(page, { content: '\n' })
    const line = page.locator('.cm-line').first()
    await line.click()
    await fakeImeCompose(page, 'ㄱ')
    const box = await line.boundingBox()
    await page.mouse.click(box.x + 5, box.y + 5, { button: 'right' })
    await expect(root(page)).toHaveCount(0)
  })
})

test.describe('F-170 A4·A5·A6 커서 이동과 서식·단락·삽입 실행', () => {
  test('F-170 A4·A5·A6 선택 안·밖 우클릭, 서식 ▸ 볼드체(Ctrl+Z 한 번), 단락 ▸ 제목 2, 삽입 ▸ 표', async ({ page }) => {
    await openApp(page)

    // A4 선택 안 우클릭은 선택을 유지, 선택 밖 우클릭은 커서를 그 지점으로 옮긴다
    await importMarkdown(page, { content: 'AAAAA BBBBB\n' })
    let line = page.locator('.cm-line').first()
    await line.click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
    // 이 코드베이스는 drawSelection() 을 쓰지 않아 네이티브 Selection 으로 선택을 그린다
    expect(await page.evaluate(() => !window.getSelection().isCollapsed)).toBe(true)

    const box = await line.boundingBox()
    await page.mouse.click(box.x + 5, box.y + box.height / 2, { button: 'right' })
    await expect(root(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(root(page)).toHaveCount(0)
    expect(await page.evaluate(() => !window.getSelection().isCollapsed)).toBe(true)

    await page.mouse.click(box.x + box.width - 10, box.y + box.height / 2, { button: 'right' })
    await expect(root(page)).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => window.getSelection().isCollapsed)).toBe(true)

    // A5 선택 → 서식 ▸ 볼드체 — **로 감싸고 Ctrl+Z 한 번에 되돌린다
    await importMarkdown(page, { content: 'abc\n' })
    line = page.locator('.cm-line').first()
    await line.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    await openEditorMenu(page, line)
    await root(page).getByRole('menuitem', { name: '서식', exact: true }).click()
    await page.getByRole('menuitem', { name: /^볼드체/ }).click()
    await expect(line).toHaveText('**abc**')
    await page.keyboard.press('Control+z')
    await expect(line).toHaveText('abc')

    // A6 줄에서 단락 ▸ 제목 2
    await importMarkdown(page, { content: '본문줄\n' })
    line = page.locator('.cm-line').first()
    await line.click()
    await page.keyboard.press('Home')
    await openEditorMenu(page, line)
    await root(page).getByRole('menuitem', { name: '단락', exact: true }).click()
    await page.getByRole('menuitem', { name: '제목 2' }).click()
    await expect(line).toHaveText('## 본문줄')

    // A6 빈 줄에서 삽입 ▸ 표 — 편집 모드는 머리 첫 칸 편집 중
    await importMarkdown(page, { content: '\n' })
    line = page.locator('.cm-line').first()
    await line.click()
    await openEditorMenu(page, line, { dx: 2, dy: 5 })
    await root(page).getByRole('menuitem', { name: '삽입', exact: true }).click()
    await page.getByRole('menuitem', { name: '표', exact: true }).click()
    await expect(page.locator('.md-table-widget')).toHaveCount(1)
    await expect(page.locator('.md-table-cell-editing[data-row="0"][data-col="0"]')).toHaveCount(1)
  })
})

test.describe('F-170 A7·A10 키보드와 표 칸', () => {
  test('F-170 A7·A10 키보드로 볼드체 실행·비활성 항목 건너뜀·Esc 두 번이면 에디터 포커스, 표 칸 편집 중 취소선은 칸 원문만', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: 'abc\n' })
    const line = page.locator('.cm-line').first()
    await line.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')

    // A7 ↓↓ → → Enter 로 볼드체 실행
    await openEditorMenu(page, line)
    await expect(root(page)).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(root(page).getByRole('menuitem', { name: '서식', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(line).toHaveText('**abc**')

    // 비활성 항목(선택 없음 → 잘라내기·복사) 건너뜀 — 삽입 다음 화살표 아래는 붙여넣기로 곧장 간다
    await page.keyboard.press('Home')
    await openEditorMenu(page, line)
    await root(page).getByRole('menuitem', { name: '삽입', exact: true }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(root(page).getByRole('menuitem', { name: /^붙여넣기/ })).toBeFocused()

    await page.keyboard.press('ArrowUp') // 삽입으로
    await page.keyboard.press('ArrowRight') // 삽입 ▸ 2차 메뉴 열기
    await expect(root(page).locator('.context-menu-submenu [role="menuitem"]').first()).toBeFocused()
    await page.keyboard.press('Escape') // 2차 메뉴만 닫힘
    await expect(root(page)).toBeVisible()
    await page.keyboard.press('Escape') // 1차 메뉴 닫힘 + 에디터 포커스
    await expect(root(page)).toHaveCount(0)
    const focused = await page.evaluate(() => document.activeElement?.closest('.cm-content') != null)
    expect(focused).toBe(true)

    // A10 칸 편집 중 우클릭 — 단락·삽입 비활성, 취소선 실행은 칸 원문만
    await importMarkdown(page, { content: '표\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n' })
    const wrap = page.locator('.md-table-widget')
    await wrap.locator('th').first().click()
    const cellLine = page.locator('.md-table-cell-editing .cm-line').first()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')

    await openEditorMenu(page, cellLine)
    await expect(root(page)).toBeVisible()
    await root(page).getByRole('menuitem', { name: '서식', exact: true }).click()
    await page.getByRole('menuitem', { name: /^취소선/ }).click()
    await expect(page.locator('.md-table-cell-editing .cm-line').first()).toHaveText('~~a~~')
    await expect(wrap.locator('td').nth(1)).toHaveText('2')
  })
})

test.describe('F-170 A8·A9 클립보드', () => {
  test('F-170 A8·A9 잘라내기 → 다른 곳 붙여넣기, 일반 텍스트로 붙여넣기, 클립보드 거부는 error 알림에 문서 불변', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openApp(page)
    await importMarkdown(page, { content: 'hello world\n' })
    const line = page.locator('.cm-line').first()
    await line.click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight') // 'hello' 선택

    await openEditorMenu(page, line)
    await root(page).getByRole('menuitem', { name: /^잘라내기/ }).click()
    await expect(line).toHaveText(' world')

    await page.keyboard.press('End')
    await openEditorMenu(page, line, { dx: 50 })
    await root(page).getByRole('menuitem', { name: /^붙여넣기/ }).click()
    await expect(line).toHaveText(' worldhello')

    await page.evaluate(() => navigator.clipboard.writeText('PLAIN'))
    await page.keyboard.press('Home')
    await openEditorMenu(page, line, { dx: 2 })
    await root(page).getByRole('menuitem', { name: /^일반 텍스트로 붙여넣기/ }).click()
    await expect(line).toHaveText('PLAIN worldhello')

    // A9 권한 없는 상태에서 붙여넣기 — error 알림, 문서 불변
    await page.evaluate(() => {
      const deny = () => Promise.reject(new DOMException('denied', 'NotAllowedError'))
      navigator.clipboard.read = deny
      navigator.clipboard.readText = deny
    })
    await openEditorMenu(page, line, { dx: 2 })
    await root(page).getByRole('menuitem', { name: /^붙여넣기/ }).click()
    await expect(page.locator('.notice--error .notice-message')).toHaveText('클립보드를 읽지 못했습니다. Ctrl+V 로 붙여넣으세요.')
    await expect(line).toHaveText('PLAIN worldhello')
  })
})
