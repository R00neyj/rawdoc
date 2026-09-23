// 문서를 새 탭에서 열기 + 탭 간 동기화 (specs/features/F-296.md 9장)
import { test, expect } from '@playwright/test'
import brand from '../brand.config.ts'
import { openApp, openAppHome, importMarkdown, currentDocId, waitSaved } from './helpers.js'

async function newDoc(page, name) {
  return importMarkdown(page, { name: `${name}.md`, content: `${name}\n` })
}

function treeRowOf(locator) {
  return locator.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " tree-row ")]')
}

// 사이드바 안 정확한 이름의 문서 링크 하나 (F-296 으로 문서 라벨이 <a> 가 됐다)
function docLink(page, name) {
  return page.locator('.sidebar').getByRole('link', { name, exact: true })
}

async function openDocContextMenu(page, name) {
  await treeRowOf(docLink(page, name)).click({ button: 'right' })
}

async function typeIntoEditor(page, text) {
  await page.locator('.cm-content').click()
  await page.keyboard.type(text)
}

async function goHome(page) {
  await page.getByRole('button', { name: `${brand.name} 홈으로` }).click()
}

test.describe('F-296 A1 우클릭 메뉴 순서', () => {
  test('새 탭에서 열기가 메뉴에 있고 삭제보다 위다', async ({ page }) => {
    await openApp(page)
    await newDoc(page, 'A')
    await openDocContextMenu(page, 'A')

    const labels = await page.locator('.item-menu-list[data-state="open"] [role="menuitem"]').allTextContents()
    const openIdx = labels.findIndex((l) => l.includes('새 탭에서 열기'))
    const deleteIdx = labels.findIndex((l) => l.includes('삭제'))
    expect(openIdx).toBeGreaterThanOrEqual(0)
    expect(deleteIdx).toBeGreaterThan(openIdx)
  })
})

test.describe('F-296 A2 메뉴 `새 탭에서 열기`', () => {
  test('새 탭이 열리고 원래 탭은 그대로다', async ({ page, context }) => {
    await openApp(page)
    const docId = await newDoc(page, 'A')
    const hashBefore = await page.evaluate(() => location.hash)

    await openDocContextMenu(page, 'A')
    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('menuitem', { name: '새 탭에서 열기' }).click(),
    ])
    await newPage.waitForLoadState()

    expect(newPage.url()).toContain(`#/d/${docId}`)
    await expect(newPage.locator('.cm-content')).toContainText('A')
    expect(await page.evaluate(() => location.hash)).toBe(hashBefore)
  })
})

test.describe('F-296 A3 가운데클릭', () => {
  test('문서 라벨을 가운데클릭하면 새 탭이 열린다', async ({ page, context }) => {
    await openApp(page)
    const docId = await newDoc(page, 'A')

    const [newPage] = await Promise.all([context.waitForEvent('page'), docLink(page, 'A').click({ button: 'middle' })])
    await newPage.waitForLoadState()

    expect(newPage.url()).toContain(`#/d/${docId}`)
  })
})

test.describe('F-296 A4 Ctrl+클릭', () => {
  test('새 탭이 열리지 않고 여러 선택만 된다', async ({ page, context }) => {
    await openApp(page)
    await newDoc(page, 'A')
    await newDoc(page, 'B')
    await docLink(page, 'A').click()
    const hashBefore = await page.evaluate(() => location.hash)
    const pagesBefore = context.pages().length

    await docLink(page, 'B').click({ modifiers: ['Control'] })

    expect(context.pages().length).toBe(pagesBefore)
    expect(await page.evaluate(() => location.hash)).toBe(hashBefore)
    await expect(treeRowOf(docLink(page, 'A'))).toHaveClass(/tree-row--selected/)
    await expect(treeRowOf(docLink(page, 'B'))).toHaveClass(/tree-row--selected/)
  })
})

test.describe('F-296 A5 홈 화면 최근 문서', () => {
  test('가운데클릭하면 새 탭이 열린다', async ({ page, context }) => {
    await openAppHome(page)
    const docId = await newDoc(page, 'A')
    await goHome(page)

    const item = page.locator('.empty-state-recent-item').filter({ hasText: 'A' })
    const [newPage] = await Promise.all([context.waitForEvent('page'), item.click({ button: 'middle' })])
    await newPage.waitForLoadState()

    expect(newPage.url()).toContain(`#/d/${docId}`)
  })
})

test.describe('F-296 A6 다른 탭에서 만든 문서', () => {
  test('3초 안에 사이드바에 나타난다', async ({ page, context }) => {
    await openApp(page)
    const before = await page.locator('.sidebar .tree-item').count()

    const page2 = await context.newPage()
    await page2.goto('/')
    await expect(page2.locator('.cm-host .cm-editor')).toBeVisible()
    await page2.getByRole('button', { name: '새 문서' }).click()

    await expect.poll(() => page.locator('.sidebar .tree-item').count(), { timeout: 3000 }).toBe(before + 1)
  })
})

test.describe('F-296 A7 다른 탭에서 지운 문서', () => {
  test('3초 안에 사이드바에서 사라진다', async ({ page, context }) => {
    await openApp(page)
    await newDoc(page, 'A') // 연다(현재 문서)
    await newDoc(page, 'B') // A 는 더 이상 현재 문서가 아니다

    const page2 = await context.newPage()
    await page2.goto('/')
    await expect(page2.locator('.cm-host .cm-editor')).toBeVisible()
    await openDocContextMenu(page2, 'A')
    await page2.getByRole('menuitem', { name: '삭제' }).click()
    await page2.getByRole('button', { name: '삭제', exact: true }).click()

    await expect(docLink(page, 'A')).toHaveCount(0, { timeout: 3000 })
  })
})

test.describe('F-296 A8 다른 탭에서 만든 폴더', () => {
  test('3초 안에 사이드바에 나타난다', async ({ page, context }) => {
    await openApp(page)
    const before = await page.locator('.sidebar .tree-item[data-folder-id]').count()

    const page2 = await context.newPage()
    await page2.goto('/')
    await expect(page2.locator('.cm-host .cm-editor')).toBeVisible()
    await page2.getByRole('button', { name: '새 폴더' }).click()

    await expect
      .poll(() => page.locator('.sidebar .tree-item[data-folder-id]').count(), { timeout: 3000 })
      .toBe(before + 1)
  })
})

test.describe('F-296 A9 지금 연 문서가 다른 탭에서 지워짐', () => {
  test('알림이 뜨고 입력이 반영되지 않는다', async ({ page, context }) => {
    await openApp(page)
    await newDoc(page, 'X')

    const page2 = await context.newPage()
    await page2.goto('/')
    await expect(page2.locator('.cm-host .cm-editor')).toBeVisible()
    await openDocContextMenu(page2, 'X')
    await page2.getByRole('menuitem', { name: '삭제' }).click()
    await page2.getByRole('button', { name: '삭제', exact: true }).click()

    await expect(page.locator('.notice-message')).toContainText('이 문서가 다른 탭에서 삭제되었습니다', {
      timeout: 5000,
    })
    await typeIntoEditor(page, '몰래 입력')
    await expect(page.locator('.cm-content')).not.toContainText('몰래 입력')
  })
})

test.describe('F-296 A10 새 문서로 저장', () => {
  test('내용을 살려 새 문서를 만들고 알림이 사라진다', async ({ page, context }) => {
    await openApp(page)
    const docId = await newDoc(page, 'X')

    const page2 = await context.newPage()
    await page2.goto('/')
    await expect(page2.locator('.cm-host .cm-editor')).toBeVisible()
    await openDocContextMenu(page2, 'X')
    await page2.getByRole('menuitem', { name: '삭제' }).click()
    await page2.getByRole('button', { name: '삭제', exact: true }).click()
    await expect(page.locator('.notice-message')).toContainText('이 문서가 다른 탭에서 삭제되었습니다', {
      timeout: 5000,
    })

    const before = await page.locator('.sidebar .tree-item').count()
    await page.getByRole('button', { name: '새 문서로 저장' }).click()

    await expect(page.locator('.notice')).toHaveCount(0)
    expect(await currentDocId(page)).not.toBe(docId)
    await expect(page.locator('.cm-content')).toContainText('X')
    await expect.poll(() => page.locator('.sidebar .tree-item').count()).toBe(before + 1)
  })
})

test.describe('F-296 A11 같은 문서를 다른 탭에서 열기', () => {
  test('나중 탭은 읽기 전용, 먼저 연 탭은 계속 편집된다', async ({ page, context }) => {
    await openApp(page)
    const docId = await newDoc(page, 'X')

    const page2 = await context.newPage()
    await page2.goto(`/#/d/${docId}`)
    await expect(page2.locator('.cm-host .cm-editor')).toBeVisible()

    await expect(page2.locator('.notice-message')).toContainText('다른 탭에서 편집 중입니다', { timeout: 5000 })
    await typeIntoEditor(page2, '탭B 입력')
    await expect(page2.locator('.cm-content')).toContainText('X')
    await expect(page2.locator('.cm-content')).not.toContainText('탭B 입력')

    await typeIntoEditor(page, ' 탭A 입력')
    await expect(page.locator('.cm-content')).toContainText('탭A 입력')
  })
})

test.describe('F-296 A12 먼저 연 탭을 놓으면 편집권을 되찾는다', () => {
  test('5초 안에 다시 편집할 수 있다', async ({ page, context }) => {
    await openApp(page)
    const docId = await newDoc(page, 'X')

    const page2 = await context.newPage()
    await page2.goto(`/#/d/${docId}`)
    await expect(page2.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(page2.locator('.notice-message')).toContainText('다른 탭에서 편집 중입니다', { timeout: 5000 })

    // 실제 탭 닫기는 렌더러가 곧장 죽어 신호가 못 나갈 수 있다 — pagehide 를 직접 흉내낸다 (docLock.spec.js 와 같은 방식)
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await page.close()

    await expect(page2.locator('.notice-message')).toContainText('이제 편집할 수 있습니다', { timeout: 5000 })
    await typeIntoEditor(page2, ' 이어서 편집')
    await expect(page2.locator('.cm-content')).toContainText('이어서 편집')
  })
})

test.describe('F-296 A13 편집권을 되찾으면 최신 내용을 본다', () => {
  test('먼저 연 탭이 저장한 내용이 다시 마운트된 화면에 보인다', async ({ page, context }) => {
    await openApp(page)
    const docId = await newDoc(page, 'X')

    const page2 = await context.newPage()
    await page2.goto(`/#/d/${docId}`)
    await expect(page2.locator('.cm-host .cm-editor')).toBeVisible()
    await expect(page2.locator('.notice-message')).toContainText('다른 탭에서 편집 중입니다', { timeout: 5000 })

    await typeIntoEditor(page, ' 최신내용')
    await waitSaved(page)

    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await page.close()

    await expect(page2.locator('.notice-message')).toContainText('이제 편집할 수 있습니다', { timeout: 5000 })
    await expect(page2.locator('.cm-content')).toContainText('최신내용')
  })
})
