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

test.describe('F-170 A2 열기 위치', () => {
  test('편집 모드 본문 우클릭 — 메뉴 왼쪽 위가 클릭 지점에 맞춰진다', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await openApp(page)
    await importMarkdown(page, { content: '본문 줄\n' })
    const line = page.locator('.cm-line', { hasText: '본문 줄' })
    const { x, y } = await openEditorMenu(page, line)
    await expect(root(page)).toBeVisible()
    const box = await root(page).boundingBox()
    expect(Math.abs(box.x - x)).toBeLessThanOrEqual(2)
    expect(Math.abs(box.y - y)).toBeLessThanOrEqual(2)
  })

  test('창 오른쪽 아래 구석 우클릭 — 뒤집혀 창 안에 그려진다', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await openApp(page)
    // 화면을 채울 만큼 줄을 채워 마지막 줄이 창 아래쪽 구석 가까이 오게 한다
    await importMarkdown(page, { content: Array.from({ length: 60 }, (_, i) => `줄 ${i}`).join('\n') + '\n' })
    const content = page.locator('.cm-content')
    await content.click()
    await page.keyboard.press('Control+End')
    const cbox = await content.boundingBox()
    const lastLine = page.locator('.cm-line').last()
    const lbox = await lastLine.boundingBox()
    const x = cbox.x + cbox.width - 8
    const y = lbox.y + lbox.height - 2
    await page.mouse.click(x, y, { button: 'right' })
    await expect(root(page)).toBeVisible()
    const box = await root(page).boundingBox()
    expect(box.x + box.width).toBeLessThanOrEqual(1600)
    expect(box.y + box.height).toBeLessThanOrEqual(900)
  })
})

test.describe('F-170 A3 여는 곳', () => {
  test('사이드바 우클릭은 앱 메뉴를 열지 않고 기본 동작을 막지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    const sidebar = page.locator('.sidebar')
    const box = await sidebar.boundingBox()
    const prevented = await rightClickAndCheckDefault(page, box.x + box.width / 2, box.y + 10)
    expect(prevented).toBe(false)
    await expect(root(page)).toHaveCount(0)
  })

  test('상단바 우클릭은 앱 메뉴를 열지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    const topbar = page.locator('.topbar')
    const box = await topbar.boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    await expect(root(page)).toHaveCount(0)
  })

  test('본문 Shift+우클릭은 앱 메뉴 대신 기본 메뉴, 기본 동작을 막지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    const line = page.locator('.cm-line', { hasText: '본문' })
    const box = await line.boundingBox()
    const prevented = await rightClickAndCheckDefault(page, box.x + 5, box.y + 5, { shift: true })
    expect(prevented).toBe(false)
    await expect(root(page)).toHaveCount(0)
  })
})

test.describe('F-170 A4 커서 이동', () => {
  test('선택 안 우클릭은 선택을 유지, 선택 밖 우클릭은 커서를 그 지점으로 옮긴다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: 'AAAAA BBBBB\n' })
    const line = page.locator('.cm-line').first()
    await line.click()
    await page.keyboard.press('Home')
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
    // 이 코드베이스는 drawSelection() 을 쓰지 않아 네이티브 Selection 으로 선택을 그린다
    expect(await page.evaluate(() => !window.getSelection().isCollapsed)).toBe(true)

    const box = await line.boundingBox()
    // 선택 안(앞부분 AAAAA) 우클릭 — 선택 유지
    await page.mouse.click(box.x + 5, box.y + box.height / 2, { button: 'right' })
    await expect(root(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(root(page)).toHaveCount(0)
    expect(await page.evaluate(() => !window.getSelection().isCollapsed)).toBe(true)

    // 선택 밖(뒷부분 BBBBB) 우클릭 — 커서 이동, 선택 해제
    await page.mouse.click(box.x + box.width - 10, box.y + box.height / 2, { button: 'right' })
    await expect(root(page)).toBeVisible()
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => window.getSelection().isCollapsed)).toBe(true)
  })
})

test.describe('F-170 A5 서식 실행', () => {
  test('선택 → 서식 ▸ 볼드체 — **로 감싸고 Ctrl+Z 한 번에 되돌린다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: 'abc\n' })
    const line = page.locator('.cm-line').first()
    await line.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')

    await openEditorMenu(page, line)
    await root(page).getByRole('menuitem', { name: '서식', exact: true }).click()
    await page.getByRole('menuitem', { name: /^볼드체/ }).click()

    await expect(line).toHaveText('**abc**')
    await page.keyboard.press('Control+z')
    await expect(line).toHaveText('abc')
  })
})

test.describe('F-170 A6 단락·삽입 실행', () => {
  test('줄에서 단락 ▸ 제목 2', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문줄\n' })
    const line = page.locator('.cm-line').first()
    await line.click()
    await page.keyboard.press('Home')

    await openEditorMenu(page, line)
    await root(page).getByRole('menuitem', { name: '단락', exact: true }).click()
    await page.getByRole('menuitem', { name: '제목 2' }).click()

    await expect(line).toHaveText('## 본문줄')
  })

  test('빈 줄에서 삽입 ▸ 표 — 편집 모드는 머리 첫 칸 편집 중', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '\n' })
    const line = page.locator('.cm-line').first()
    await line.click()

    await openEditorMenu(page, line, { dx: 2, dy: 5 })
    await root(page).getByRole('menuitem', { name: '삽입', exact: true }).click()
    await page.getByRole('menuitem', { name: '표', exact: true }).click()

    await expect(page.locator('.md-table-widget')).toHaveCount(1)
    await expect(page.locator('.md-table-cell-editing[data-row="0"][data-col="0"]')).toHaveCount(1)
  })
})

test.describe('F-170 A7 키보드', () => {
  test('↓↓ → → Enter 로 볼드체 실행, 비활성 항목 건너뜀, Esc 두 번이면 닫히고 에디터 포커스', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: 'abc\n' })
    const line = page.locator('.cm-line').first()
    await line.click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')

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
  })
})

test.describe('F-170 A8 클립보드', () => {
  test('잘라내기 → 다른 곳 붙여넣기, 일반 텍스트로 붙여넣기', async ({ page, context }) => {
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
  })
})

test.describe('F-170 A9 클립보드 거부', () => {
  test('권한 없는 상태에서 붙여넣기 — error 알림, 문서 불변', async ({ page }) => {
    await page.addInitScript(() => {
      const deny = () => Promise.reject(new DOMException('denied', 'NotAllowedError'))
      navigator.clipboard.read = deny
      navigator.clipboard.readText = deny
    })
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    const line = page.locator('.cm-line').first()
    await line.click()

    await openEditorMenu(page, line)
    await root(page).getByRole('menuitem', { name: /^붙여넣기/ }).click()

    await expect(page.locator('.notice--error .notice-message')).toHaveText('클립보드를 읽지 못했습니다. Ctrl+V 로 붙여넣으세요.')
    await expect(line).toHaveText('본문')
  })
})

test.describe('F-170 A10 표 칸', () => {
  test('칸 편집 중 우클릭 — 단락·삽입·서식 지우기 비활성, 취소선 실행은 칸 원문만', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '표\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n' })
    const wrap = page.locator('.md-table-widget')
    const headerCell = wrap.locator('th').first()
    await headerCell.click()
    const cellLine = page.locator('.md-table-cell-editing .cm-line').first()
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')

    await openEditorMenu(page, cellLine)
    await expect(root(page)).toBeVisible()
    await expect(root(page).getByRole('menuitem', { name: '단락', exact: true })).toHaveAttribute('aria-disabled', 'true')
    await expect(root(page).getByRole('menuitem', { name: '삽입', exact: true })).toHaveAttribute('aria-disabled', 'true')
    await root(page).getByRole('menuitem', { name: '서식', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: /^서식 지우기/ })).toHaveAttribute('aria-disabled', 'true')
    await page.getByRole('menuitem', { name: /^취소선/ }).click()

    await expect(page.locator('.md-table-cell-editing .cm-line').first()).toHaveText('~~a~~')
    const otherCell = wrap.locator('td').nth(1)
    await expect(otherCell).toHaveText('2')
  })
})

test.describe('F-170 A11 보기 모드', () => {
  test('항목 2개, 선택 없으면 복사 비활성', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문 글자\n' })
    await setViewMode(page, 'view')
    const body = page.locator('.viewer .markdown-body')
    await expect(body).toBeVisible()

    const box = await body.boundingBox()
    await page.mouse.click(box.x + 5, box.y + 5, { button: 'right' })
    await expect(root(page).locator('[role="menuitem"]')).toHaveCount(2)
    await expect(root(page).getByRole('menuitem', { name: /^복사/ })).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')

    // 문단 전체 선택 후 우클릭 — 복사 활성
    await page.evaluate(() => {
      const el = document.querySelector('.viewer .markdown-body p')
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    })
    await page.mouse.click(box.x + 5, box.y + 5, { button: 'right' })
    await expect(root(page).getByRole('menuitem', { name: /^복사/ })).not.toHaveAttribute('aria-disabled', 'true')
  })
})

test.describe('F-170 A12 조합 중', () => {
  test('한글 조합 중 우클릭은 앱 메뉴를 열지 않는다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '\n' })
    const line = page.locator('.cm-line').first()
    await line.click()
    await fakeImeCompose(page, 'ㄱ')

    const box = await line.boundingBox()
    await page.mouse.click(box.x + 5, box.y + 5, { button: 'right' })
    await expect(root(page)).toHaveCount(0)
  })
})
