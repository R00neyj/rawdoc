// 사이드바 여러 항목 선택·우클릭 메뉴 (specs/features/F-255.md)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown } from './helpers.js'

async function newDoc(page, name) {
  await importMarkdown(page, { name: `${name}.md`, content: `${name}\n` })
}

// 사이드바 안 정확한 이름의 항목 라벨 하나 — 폴더는 button, 문서는 link 다 (F-296.md 11장)
function itemButton(page, name) {
  const sidebar = page.locator('.sidebar')
  return sidebar.getByRole('button', { name, exact: true }).or(sidebar.getByRole('link', { name, exact: true }))
}

function treeRowOf(locator) {
  return locator.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " tree-row ")]')
}

function folderItem(page, name) {
  return page.locator('.tree-item[data-folder-id]').filter({ has: page.getByRole('button', { name, exact: true }) })
}

async function newFolder(page, name) {
  await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
  const input = page.locator('.tree-rename-input')
  await input.fill(name)
  await input.press('Enter')
}

async function moveDocToFolder(page, title, folderName) {
  await page.locator('.sidebar').getByRole('button', { name: `${title} 메뉴` }).click()
  await page.getByRole('menuitem', { name: '폴더로 이동…' }).click()
  await page.getByRole('radio', { name: folderName }).click()
  await page.getByRole('button', { name: '이동', exact: true }).click()
}

// Playwright 공식 수동 드래그 패턴 — 각 이벤트를 따로 보내 그 사이 React 가 state(dragged)를 반영할 시간을 준다
async function dragRowTo(page, sourceLocator, targetLocator) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await sourceLocator.dispatchEvent('dragstart', { dataTransfer })
  await targetLocator.dispatchEvent('dragover', { dataTransfer })
  await targetLocator.dispatchEvent('drop', { dataTransfer })
  await sourceLocator.dispatchEvent('dragend', { dataTransfer })
}

test.describe('F-255 사이드바 여러 항목 선택·우클릭 메뉴', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('F-255 D1 문서 우클릭 — ⋯ 메뉴와 같은 메뉴가 열리고 브라우저 기본 메뉴는 막힌다', async ({ page }) => {
    await openApp(page)
    await newDoc(page, 'A')
    // 버블 단계(capture 아님)에서 읽어야 한다 — 행의 preventDefault 는 버블 중에 실행된다
    await page.evaluate(() => {
      window.pwContextMenuPrevented = new Promise((resolve) => {
        window.addEventListener('contextmenu', (e) => resolve(e.defaultPrevented), { once: true })
      })
    })
    await treeRowOf(itemButton(page, 'A')).click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: '삭제' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '폴더로 이동…' })).toBeVisible()
    expect(await page.evaluate(() => window.pwContextMenuPrevented)).toBe(true)
  })

  test('F-255 D2 폴더 우클릭 — 폴더 메뉴(새 문서·이름 변경·삭제)가 열린다', async ({ page }) => {
    await openApp(page)
    await newFolder(page, '폴더1')
    await folderItem(page, '폴더1').locator(':scope > .tree-row').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: '새 문서' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '이름 변경' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '삭제' })).toBeVisible()
  })

  test('F-255 D3 메뉴 위치 — 창 아래쪽 행에서 우클릭해도 메뉴가 화면 밖으로 안 나간다', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 480 }) // 1024 미만이면 겹침 사이드바(narrow)로 바뀐다
    await openApp(page)
    for (let i = 0; i < 20; i++) await newDoc(page, `문서${i}`)
    const last = treeRowOf(itemButton(page, '문서0')) // updatedAt 내림차순이라 가장 먼저 만든 게 맨 아래
    await last.scrollIntoViewIfNeeded()
    await last.click({ button: 'right' })
    const menu = page.locator('.item-menu-list[data-state="open"]')
    await expect(menu).toBeVisible()
    const box = await menu.boundingBox()
    expect(box.x + box.width).toBeLessThanOrEqual(500)
    expect(box.y + box.height).toBeLessThanOrEqual(480)
  })

  test('F-255 D4·D5 Ctrl+클릭으로 더하고 뺀다 — 열린 문서는 그대로', async ({ page }) => {
    await openApp(page)
    await newDoc(page, 'A')
    await newDoc(page, 'B')
    await itemButton(page, 'A').click()
    const openBefore = await page.evaluate(() => location.hash)
    await itemButton(page, 'B').click({ modifiers: ['Control'] })
    await expect(treeRowOf(itemButton(page, 'A'))).toHaveClass(/tree-row--selected/)
    await expect(treeRowOf(itemButton(page, 'B'))).toHaveClass(/tree-row--selected/)
    expect(await page.evaluate(() => location.hash)).toBe(openBefore) // D4 — B 는 열리지 않는다

    await itemButton(page, 'B').click({ modifiers: ['Control'] }) // D5 — 다시 Ctrl+B 로 뺀다
    await expect(treeRowOf(itemButton(page, 'B'))).not.toHaveClass(/tree-row--selected/)
    await expect(treeRowOf(itemButton(page, 'A'))).toHaveClass(/tree-row--selected/)
  })

  test('F-255 D6 Shift+클릭 범위 선택 — 접힌 폴더 안 문서는 범위에 안 들어간다', async ({ page }) => {
    await openApp(page)
    await newFolder(page, '폴더1')
    await newDoc(page, 'IN')
    await moveDocToFolder(page, 'IN', '폴더1')
    await page.getByRole('button', { name: '폴더1 접기' }).click() // 접는다
    await newDoc(page, 'B')

    // 화면 순서: 폴더1(폴더), B(문서) — IN 은 접혀서 안 보인다
    await itemButton(page, '폴더1').click({ modifiers: ['Control'] }) // 열지 않고 anchor 만 세운다
    await itemButton(page, 'B').click({ modifiers: ['Shift'] })

    await expect(treeRowOf(itemButton(page, '폴더1'))).toHaveClass(/tree-row--selected/)
    await expect(treeRowOf(itemButton(page, 'B'))).toHaveClass(/tree-row--selected/)
    expect(await page.locator('.tree-row--selected').count()).toBe(2) // IN 은 세지 않는다
  })

  test('F-255 D7 빈 곳 클릭·Esc 로 선택 해제', async ({ page }) => {
    await openApp(page)
    await newDoc(page, 'A')
    await itemButton(page, 'A').click({ modifiers: ['Control'] })
    await expect(treeRowOf(itemButton(page, 'A'))).toHaveClass(/tree-row--selected/)

    await page.locator('.tree-root-drop').click()
    await expect(page.locator('.tree-row--selected')).toHaveCount(0)

    await itemButton(page, 'A').click({ modifiers: ['Control'] })
    await expect(treeRowOf(itemButton(page, 'A'))).toHaveClass(/tree-row--selected/)
    await page.keyboard.press('Escape')
    await expect(page.locator('.tree-row--selected')).toHaveCount(0)
  })

  test('F-255 D8·D9 여러 항목 우클릭은 여러 항목 메뉴, 선택 밖 우클릭은 그 행만 단일 메뉴', async ({ page }) => {
    await openApp(page)
    await newDoc(page, 'A')
    await newDoc(page, 'B')
    await newDoc(page, 'C')
    await itemButton(page, 'A').click()
    await itemButton(page, 'B').click({ modifiers: ['Control'] })

    await treeRowOf(itemButton(page, 'A')).click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: '새 폴더로 넣기' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '최상위로 옮기기' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '삭제' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '폴더로 이동…' })).not.toBeVisible() // 단일 전용은 숨긴다
    await page.keyboard.press('Escape')
    // 완전히 닫혀 DOM 에서 사라질 때까지 기다린다 — inert 만으로는 접근성 트리 반영에 몇 프레임 지연이 있어 자리끼리 겹칠 수 있다
    await expect(page.locator('.item-menu-list')).toHaveCount(0)

    // D9 — 선택 밖(C) 우클릭 → C 만 선택되고 단일 메뉴
    await treeRowOf(itemButton(page, 'C')).click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: '폴더로 이동…' })).toBeVisible()
    await expect(treeRowOf(itemButton(page, 'C'))).toHaveClass(/tree-row--selected/)
    await expect(treeRowOf(itemButton(page, 'A'))).not.toHaveClass(/tree-row--selected/)
    expect(await page.locator('.tree-row--selected').count()).toBe(1)
  })

  test('F-255 D10 여러 삭제 — 확인 문구에 개수, 둘 다 사라진다', async ({ page }) => {
    await openApp(page)
    await newDoc(page, 'A')
    await newDoc(page, 'B')
    await itemButton(page, 'A').click()
    await itemButton(page, 'B').click({ modifiers: ['Control'] })
    await treeRowOf(itemButton(page, 'A')).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '삭제' }).click()

    const dialog = page.locator('dialog[aria-labelledby="confirm-bulk-delete-title"]')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('2개')
    await dialog.getByRole('button', { name: '삭제', exact: true }).click()

    await expect(itemButton(page, 'A')).toHaveCount(0)
    await expect(itemButton(page, 'B')).toHaveCount(0)
  })

  test('F-255 D11 폴더로 드래그 — 문서 2개 선택 후 하나를 끌면 둘 다 그 폴더 안', async ({ page }) => {
    await openApp(page)
    await newFolder(page, '폴더1')
    await newDoc(page, 'A')
    await newDoc(page, 'B')
    await itemButton(page, 'A').click()
    await itemButton(page, 'B').click({ modifiers: ['Control'] })

    await dragRowTo(page, treeRowOf(itemButton(page, 'B')), folderItem(page, '폴더1').locator(':scope > .tree-row'))

    await expect(folderItem(page, '폴더1')).toContainText('A')
    await expect(folderItem(page, '폴더1')).toContainText('B')
  })

  test('F-255 D12 밖으로 드래그 — 폴더 안 문서 2개를 최상위 영역으로', async ({ page }) => {
    await openApp(page)
    await newFolder(page, '폴더1')
    await newDoc(page, 'A')
    await newDoc(page, 'B')
    await moveDocToFolder(page, 'A', '폴더1')
    await moveDocToFolder(page, 'B', '폴더1')

    await itemButton(page, 'A').click()
    await itemButton(page, 'B').click({ modifiers: ['Control'] })
    await dragRowTo(page, treeRowOf(itemButton(page, 'B')), page.locator('.tree-root-drop'))

    await expect(folderItem(page, '폴더1')).not.toContainText('A')
    await expect(folderItem(page, '폴더1')).not.toContainText('B')
    await expect(itemButton(page, 'A')).toBeVisible()
    await expect(itemButton(page, 'B')).toBeVisible()
  })

  test('F-255 D13 새 폴더로 넣기 — 새 폴더가 생기고 둘이 들어가며 이름 편집이 열린다', async ({ page }) => {
    await openApp(page)
    await newDoc(page, 'A')
    await newDoc(page, 'B')
    await itemButton(page, 'A').click()
    await itemButton(page, 'B').click({ modifiers: ['Control'] })
    await treeRowOf(itemButton(page, 'A')).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '새 폴더로 넣기' }).click()

    await expect(page.locator('.tree-rename-input')).toBeVisible()
    await page.locator('.tree-rename-input').press('Enter')

    const newFolderLi = page.locator('.tree-item[data-folder-id]').first()
    await expect(newFolderLi).toContainText('A')
    await expect(newFolderLi).toContainText('B')
  })

  test('F-255 D14 폴더를 제 자손에 넣으면 건너뛰고 알린다 — 앱이 깨지지 않는다', async ({ page }) => {
    await openApp(page)
    await newFolder(page, '폴더1')
    await newDoc(page, 'IN')
    await moveDocToFolder(page, 'IN', '폴더1')

    // 이미 펼쳐진 폴더를 일반 클릭하면 접힌다 — Ctrl+클릭으로 열고 닫지 않은 채 선택만 한다
    await itemButton(page, '폴더1').click({ modifiers: ['Control'] })
    await itemButton(page, 'IN').click({ modifiers: ['Control'] })
    await dragRowTo(page, treeRowOf(itemButton(page, '폴더1')), folderItem(page, '폴더1').locator(':scope > .tree-row'))

    await expect(page.locator('.notice')).toBeVisible()
    await expect(folderItem(page, '폴더1')).toContainText('IN') // 그대로 — 앱이 깨지지 않는다
  })

  test('F-255 D15 부모 폴더와 그 안 문서를 같이 옮기면 부모만 옮기고 문서는 따라간다', async ({ page }) => {
    await openApp(page)
    await newFolder(page, '폴더1')
    await newDoc(page, 'IN')
    await moveDocToFolder(page, 'IN', '폴더1')

    await itemButton(page, '폴더1').click({ modifiers: ['Control'] })
    await itemButton(page, 'IN').click({ modifiers: ['Control'] })
    await dragRowTo(page, treeRowOf(itemButton(page, 'IN')), page.locator('.tree-root-drop'))

    await expect(folderItem(page, '폴더1')).toContainText('IN') // 문서는 폴더를 따라 그대로 안에 있다
  })

  test('F-255 D16 회귀 — 선택 없이 문서 하나는 그대로 열기·⋯ 메뉴·드래그가 된다', async ({ page }) => {
    await openApp(page)
    await newFolder(page, '폴더1')
    await newDoc(page, 'A')
    await newDoc(page, 'B') // 마지막으로 가져온 B 가 열려 있다

    await itemButton(page, 'A').click()
    await expect(page.locator('.doc-title')).toHaveValue('A') // 일반 클릭은 그대로 열린다

    await page.locator('.sidebar').getByRole('button', { name: 'A 메뉴' }).click()
    await expect(page.getByRole('menuitem', { name: '폴더로 이동…' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.item-menu-list')).toHaveCount(0)

    await dragRowTo(page, treeRowOf(itemButton(page, 'A')), folderItem(page, '폴더1').locator(':scope > .tree-row'))
    await expect(folderItem(page, '폴더1')).toContainText('A')
  })

  test('F-255 D17 이름 편집 중인 폴더는 우클릭해도 앱 메뉴가 안 열린다', async ({ page }) => {
    await openApp(page)
    await newFolder(page, '폴더1')
    await page.getByRole('button', { name: '폴더1 메뉴' }).click()
    await page.getByRole('menuitem', { name: '이름 변경' }).click()
    await expect(page.locator('.tree-rename-input')).toBeVisible()

    await page.locator('.tree-rename-input').click({ button: 'right' })
    await expect(page.locator('.item-menu-list[data-state="open"]')).toHaveCount(0)
  })
})
