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

// F-255 D3 메뉴 위치(화면 밖으로 안 나감)는 좌표 값이라 e2e 에서 뺐다 — specs/human-checks.md
test.describe('F-255 사이드바 여러 항목 선택·우클릭 메뉴', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('F-255 D1·D8·D9·D17 우클릭 — ⋯ 메뉴와 같은 메뉴·기본 메뉴 막힘, 여러 항목 메뉴, 선택 밖 우클릭, 이름 편집 중에는 안 열림', async ({ page }) => {
    await openApp(page)
    await newDoc(page, 'A')
    await newDoc(page, 'B')
    await newDoc(page, 'C')
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
    await page.keyboard.press('Escape')
    // 완전히 닫혀 DOM 에서 사라질 때까지 기다린다 — inert 만으로는 접근성 트리 반영에 몇 프레임 지연이 있어 자리끼리 겹칠 수 있다
    await expect(page.locator('.item-menu-list')).toHaveCount(0)

    await itemButton(page, 'A').click()
    await itemButton(page, 'B').click({ modifiers: ['Control'] })
    await treeRowOf(itemButton(page, 'A')).click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: '새 폴더로 넣기' })).toBeVisible()
    // A·B 는 둘 다 이미 최상위라 이 항목은 안 보인다 (2026-09-22 사용자 신고로 조건 추가)
    await expect(page.getByRole('menuitem', { name: '최상위로 옮기기' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: '삭제' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '폴더로 이동…' })).not.toBeVisible() // 단일 전용은 숨긴다
    await page.keyboard.press('Escape')
    await expect(page.locator('.item-menu-list')).toHaveCount(0)

    // D9 — 선택 밖(C) 우클릭 → C 만 선택되고 단일 메뉴
    await treeRowOf(itemButton(page, 'C')).click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: '폴더로 이동…' })).toBeVisible()
    await expect(treeRowOf(itemButton(page, 'C'))).toHaveClass(/tree-row--selected/)
    await expect(treeRowOf(itemButton(page, 'A'))).not.toHaveClass(/tree-row--selected/)
    expect(await page.locator('.tree-row--selected').count()).toBe(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('.item-menu-list')).toHaveCount(0)

    await newFolder(page, '폴더1')
    await page.getByRole('button', { name: '폴더1 메뉴' }).click()
    await page.getByRole('menuitem', { name: '이름 변경' }).click()
    await expect(page.locator('.tree-rename-input')).toBeVisible()
    await page.locator('.tree-rename-input').click({ button: 'right' })
    await expect(page.locator('.item-menu-list[data-state="open"]')).toHaveCount(0)
  })

  test('F-255 D4·D5·D7·D16·D23·D24 Ctrl+클릭 선택·해제, 빈 곳·Esc 해제, 선택 없는 문서 열기·⋯ 메뉴, 고정된 문서 규칙', async ({ page }) => {
    await openApp(page)
    await newDoc(page, 'A')
    await newDoc(page, 'B')
    await newDoc(page, 'C') // 트리 순서는 최근 수정순 — C, B, A
    await itemButton(page, 'A').click()
    const openBefore = await page.evaluate(() => location.hash)
    await itemButton(page, 'B').click({ modifiers: ['Control'] })
    await expect(treeRowOf(itemButton(page, 'A'))).toHaveClass(/tree-row--selected/)
    await expect(treeRowOf(itemButton(page, 'B'))).toHaveClass(/tree-row--selected/)
    expect(await page.evaluate(() => location.hash)).toBe(openBefore) // D4 — B 는 열리지 않는다

    await itemButton(page, 'B').click({ modifiers: ['Control'] }) // D5 — 다시 Ctrl+B 로 뺀다
    await expect(treeRowOf(itemButton(page, 'B'))).not.toHaveClass(/tree-row--selected/)
    await expect(treeRowOf(itemButton(page, 'A'))).toHaveClass(/tree-row--selected/)

    await page.locator('.tree-root-drop').click() // D7
    await expect(page.locator('.tree-row--selected')).toHaveCount(0)
    await itemButton(page, 'A').click({ modifiers: ['Control'] })
    await expect(treeRowOf(itemButton(page, 'A'))).toHaveClass(/tree-row--selected/)
    await page.keyboard.press('Escape')
    await expect(page.locator('.tree-row--selected')).toHaveCount(0)

    await itemButton(page, 'A').click() // D16 — 선택 없이 문서 하나는 그대로 열기·⋯ 메뉴
    await expect(page.locator('.doc-title')).toHaveValue('A')
    await page.locator('.sidebar').getByRole('button', { name: 'A 메뉴' }).click()
    await expect(page.getByRole('menuitem', { name: '폴더로 이동…' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.item-menu-list')).toHaveCount(0)

    const list = page.locator('.doc-list')
    await list.getByRole('button', { name: 'B 메뉴' }).click()
    await page.locator('.item-menu-list:not([inert])').getByRole('menuitem', { name: '상단 고정' }).click()
    await expect(page.locator('.pinned-list .tree-row')).toHaveCount(1)

    // D24 — B 의 트리 줄부터 A 까지 두 개만, C 는 화면에서 그 위라 들어오면 안 된다
    await list.getByRole('link', { name: 'A', exact: true }).click()
    await list.getByRole('link', { name: 'B', exact: true }).click({ modifiers: ['Shift'] })
    await expect(page.locator('.doc-list .tree-row--selected')).toHaveCount(2)
    await expect(treeRowOf(list.getByRole('link', { name: 'C', exact: true }))).not.toHaveClass(/tree-row--selected/)
    await page.keyboard.press('Escape')
    await expect(page.locator('.tree-row--selected')).toHaveCount(0)

    // D23 — 고정된 문서를 트리에서 우클릭해도 메뉴는 하나만 열리고 `고정 해제` 가 먹는다
    await treeRowOf(list.getByRole('link', { name: 'B', exact: true })).click({ button: 'right' })
    await expect(page.locator('.item-menu-list[data-state="open"]')).toHaveCount(1)
    await page.locator('.item-menu-list:not([inert])').getByRole('menuitem', { name: '고정 해제' }).click()
    await expect(page.locator('.pinned-list')).toHaveCount(0)
  })

  test('F-255 D11·D12·D13 여러 항목 드래그로 폴더 안으로·밖으로, 새 폴더로 넣기', async ({ page }) => {
    await openApp(page)
    await newFolder(page, '폴더1')
    await newDoc(page, 'A')
    await newDoc(page, 'B')
    await itemButton(page, 'A').click()
    await itemButton(page, 'B').click({ modifiers: ['Control'] })
    await dragRowTo(page, treeRowOf(itemButton(page, 'B')), folderItem(page, '폴더1').locator(':scope > .tree-row'))
    await expect(folderItem(page, '폴더1')).toContainText('A')
    await expect(folderItem(page, '폴더1')).toContainText('B')

    await itemButton(page, 'A').click()
    await itemButton(page, 'B').click({ modifiers: ['Control'] })
    await dragRowTo(page, treeRowOf(itemButton(page, 'B')), page.locator('.tree-root-drop'))
    await expect(folderItem(page, '폴더1')).not.toContainText('A')
    await expect(folderItem(page, '폴더1')).not.toContainText('B')
    await expect(itemButton(page, 'A')).toBeVisible()
    await expect(itemButton(page, 'B')).toBeVisible()

    await itemButton(page, 'A').click()
    await itemButton(page, 'B').click({ modifiers: ['Control'] })
    await treeRowOf(itemButton(page, 'A')).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '새 폴더로 넣기' }).click()
    await expect(page.locator('.tree-rename-input')).toBeVisible()
    await page.locator('.tree-rename-input').press('Enter')
    const newFolderLi = page.locator('.tree-item[data-folder-id]').filter({ hasText: 'A' }).filter({ hasText: 'B' })
    await expect(newFolderLi).toHaveCount(1)
  })

  test('F-255 D22·D10·D14 최상위로 옮기기, 여러 삭제, 폴더를 제 자손에 넣으면 건너뛰고 알린다', async ({ page }) => {
    await openApp(page)
    await newFolder(page, '폴더1')
    await newDoc(page, 'IN')
    await newDoc(page, 'R')
    await moveDocToFolder(page, 'IN', '폴더1')
    await expect(folderItem(page, '폴더1')).toContainText('IN')

    // 2026-09-22 사용자 신고 — 폴더 안 항목이 섞여야 `최상위로 옮기기` 가 나오고, 누르면 실제로 올라온다
    await itemButton(page, 'R').click()
    await itemButton(page, 'IN').click({ modifiers: ['Control'] })
    await treeRowOf(itemButton(page, 'R')).click({ button: 'right' })
    await page.locator('.item-menu-list:not([inert])').getByRole('menuitem', { name: '최상위로 옮기기' }).click()
    await expect(folderItem(page, '폴더1')).not.toContainText('IN')

    await itemButton(page, 'R').click()
    await itemButton(page, 'IN').click({ modifiers: ['Control'] })
    await treeRowOf(itemButton(page, 'R')).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '삭제' }).click()
    const dialog = page.locator('dialog[aria-labelledby="confirm-bulk-delete-title"]')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('2개')
    await dialog.getByRole('button', { name: '삭제', exact: true }).click()
    await expect(itemButton(page, 'R')).toHaveCount(0)
    await expect(itemButton(page, 'IN')).toHaveCount(0)

    await newDoc(page, 'IN2')
    await moveDocToFolder(page, 'IN2', '폴더1')
    // 이미 펼쳐진 폴더를 일반 클릭하면 접힌다 — Ctrl+클릭으로 열고 닫지 않은 채 선택만 한다
    await itemButton(page, '폴더1').click({ modifiers: ['Control'] })
    await itemButton(page, 'IN2').click({ modifiers: ['Control'] })
    await dragRowTo(page, treeRowOf(itemButton(page, '폴더1')), folderItem(page, '폴더1').locator(':scope > .tree-row'))
    await expect(page.locator('.notice')).toBeVisible()
    await expect(folderItem(page, '폴더1')).toContainText('IN2') // 그대로 — 앱이 깨지지 않는다
  })
})
