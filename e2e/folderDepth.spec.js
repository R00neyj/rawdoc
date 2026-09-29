// 폴더 깊이 해제 — 깊은 트리 만들기·옮기기·열기, 순환 방어, 공개 폴더 목록 (specs/features/F-2017.md 14.3)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId } from './helpers.js'

const DEPTH_NAMES = ['가', '나', '다', '라', '마', '바', '사']

// 폴더·문서 행 하나 — .tree-row 는 자기 라벨만 담고 하위 그룹은 형제라 이름으로 정확히 하나를 고른다
function rowOf(page, name) {
  const label = page.getByRole('button', { name, exact: true }).or(page.getByRole('link', { name, exact: true }))
  return page.locator('.sidebar .tree-row').filter({ has: label })
}

function groupsAbove(row) {
  return row.locator('xpath=ancestor::ul[@role="group"]')
}

function openMenuList(page) {
  return page.locator('.item-menu-list:not([inert])')
}

async function openRowMenu(page, name) {
  const row = rowOf(page, name)
  await row.hover()
  await row.getByRole('button', { name: `${name} 메뉴` }).click()
  return openMenuList(page)
}

async function renameNewFolder(page, name) {
  const input = page.locator('.tree-rename-input')
  await expect(input).toBeFocused()
  await input.fill(name)
  await input.press('Enter')
  await expect(rowOf(page, name)).toBeVisible()
}

async function newFolder(page, name) {
  await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
  await renameNewFolder(page, name)
}

async function newSubfolder(page, parentName, name) {
  const menu = await openRowMenu(page, parentName)
  await menu.getByRole('menuitem', { name: '하위 폴더' }).click()
  await renameNewFolder(page, name)
}

async function buildDepthChain(page) {
  await newFolder(page, DEPTH_NAMES[0])
  for (let i = 1; i < DEPTH_NAMES.length; i++) await newSubfolder(page, DEPTH_NAMES[i - 1], DEPTH_NAMES[i])
}

async function moveDocToFolder(page, title, folderName) {
  const menu = await openRowMenu(page, title)
  await menu.getByRole('menuitem', { name: '폴더로 이동…' }).click()
  await page.getByRole('radio', { name: folderName, exact: true }).click()
  await page.getByRole('button', { name: '이동', exact: true }).click()
}

async function expandIfCollapsed(page, name) {
  const toggle = page.locator('.sidebar').getByRole('button', { name: `${name} 펼치기`, exact: true })
  if (await toggle.count()) await toggle.click()
}

// Playwright 수동 드래그 — sidebarSelect.spec.js 와 같은 방식
async function dragRowTo(page, sourceLocator, targetLocator) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await sourceLocator.dispatchEvent('dragstart', { dataTransfer })
  await targetLocator.dispatchEvent('dragover', { dataTransfer })
  await targetLocator.dispatchEvent('drop', { dataTransfer })
  await sourceLocator.dispatchEvent('dragend', { dataTransfer })
}

function collectPageErrors(page) {
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

test.describe('F-2017 폴더 깊이 해제', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('F-2017 A2 자식 폴더가 있는 폴더를 다른 폴더 안으로 끌어놓는다', async ({ page }) => {
    await openApp(page)
    await newFolder(page, 'X')
    await newSubfolder(page, 'X', 'X1')
    await newFolder(page, 'Y')
    await importMarkdown(page, { name: '깊은 문서.md', content: '깊은 문서\n' })
    await moveDocToFolder(page, '깊은 문서', 'X1')

    const idX = await rowOf(page, 'X').locator('xpath=..').getAttribute('data-folder-id')
    const idY = await rowOf(page, 'Y').locator('xpath=..').getAttribute('data-folder-id')
    const idX1 = await rowOf(page, 'X1').locator('xpath=..').getAttribute('data-folder-id')

    await dragRowTo(page, rowOf(page, 'X'), rowOf(page, 'Y'))

    await expandIfCollapsed(page, 'Y')
    await expandIfCollapsed(page, 'X')
    await expandIfCollapsed(page, 'X1')
    // 행 → li → ul(group) → 부모 li
    await expect(rowOf(page, 'X').locator('xpath=../../..')).toHaveAttribute('data-folder-id', idY)
    await expect(rowOf(page, 'X1').locator('xpath=../../..')).toHaveAttribute('data-folder-id', idX)
    await expect(rowOf(page, '깊은 문서').locator('xpath=../../..')).toHaveAttribute('data-folder-id', idX1)
    await expect(groupsAbove(rowOf(page, '깊은 문서'))).toHaveCount(3)
  })

  test('F-2017 A1·A3·A4 7단계 만들기, 손자 폴더에 놓기는 아무 일 없음, 이동 대화상자·새로고침 뒤 조상 펼침', async ({ page }) => {
    const errors = collectPageErrors(page)
    await openApp(page)
    await buildDepthChain(page)

    await expect(page.locator('.sidebar .tree-toggle')).toHaveCount(7)
    await expect(groupsAbove(rowOf(page, '사'))).toHaveCount(6)

    await dragRowTo(page, rowOf(page, '가'), rowOf(page, '다'))
    await expect(groupsAbove(rowOf(page, '가'))).toHaveCount(0)
    await expect(groupsAbove(rowOf(page, '다'))).toHaveCount(2)
    await expect(page.locator('.sidebar .tree-toggle')).toHaveCount(7)
    expect(errors).toEqual([])

    await importMarkdown(page, { name: '깊은 문서.md', content: '깊은 문서\n' })

    const menu = await openRowMenu(page, '깊은 문서')
    await menu.getByRole('menuitem', { name: '폴더로 이동…' }).click()
    const radios = page.getByRole('radio')
    await expect(radios).toHaveText(['최상위', ...DEPTH_NAMES])
    await page.getByRole('radio', { name: '사', exact: true }).click()
    await page.getByRole('button', { name: '이동', exact: true }).click()
    await expect(groupsAbove(rowOf(page, '깊은 문서'))).toHaveCount(7)

    await page.locator('.sidebar').getByRole('button', { name: '가 접기', exact: true }).click()
    await expect(rowOf(page, '깊은 문서')).toHaveCount(0)
    await page.reload()

    await expect(rowOf(page, '깊은 문서')).toBeVisible()
    await expect(groupsAbove(rowOf(page, '깊은 문서'))).toHaveCount(7)
    await expect(page.locator('.doc-title-crumb')).toHaveText(DEPTH_NAMES)
  })

  test('F-2017 A5 순환이 저장돼도 앱이 뜨고, 순환 폴더를 최상위로 끌어 풀 수 있다', async ({ page }) => {
    await openApp(page)
    await newFolder(page, 'A')
    await newFolder(page, 'B')
    await importMarkdown(page, { name: '순환 문서.md', content: '순환 문서\n' })
    await moveDocToFolder(page, '순환 문서', 'A')
    await expect(groupsAbove(rowOf(page, '순환 문서'))).toHaveCount(1)
    const docId = await currentDocId(page)
    expect(docId).toBeTruthy()

    const idA = await rowOf(page, 'A').locator('xpath=..').getAttribute('data-folder-id')
    const idB = await rowOf(page, 'B').locator('xpath=..').getAttribute('data-folder-id')
    await page.evaluate(
      ({ idA, idB }) =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('md-docs')
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            const db = req.result
            const tx = db.transaction('folders', 'readwrite')
            const store = tx.objectStore('folders')
            const getA = store.get(idA)
            getA.onsuccess = () => {
              store.put({ ...getA.result, parentId: idB })
              const getB = store.get(idB)
              getB.onsuccess = () => store.put({ ...getB.result, parentId: idA })
            }
            tx.oncomplete = () => {
              db.close()
              resolve(null)
            }
            tx.onerror = () => reject(tx.error)
          }
        }),
      { idA, idB },
    )

    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.doc-title-crumb')).toHaveText(['A'])
    await expect(page.locator('.sidebar .tree-toggle')).toHaveCount(2)
    await expect(groupsAbove(rowOf(page, 'A'))).toHaveCount(0)
    await expect(groupsAbove(rowOf(page, 'B'))).toHaveCount(0)

    await dragRowTo(page, rowOf(page, 'A'), page.locator('.tree-root-drop'))
    await expandIfCollapsed(page, 'A')
    await expect(groupsAbove(rowOf(page, 'B'))).toHaveCount(1)
    await page.reload()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible({ timeout: 10_000 })
    await expandIfCollapsed(page, 'A')
    await expect(groupsAbove(rowOf(page, 'A'))).toHaveCount(0)
    await expect(groupsAbove(rowOf(page, 'B'))).toHaveCount(1)
    await expect(rowOf(page, 'B').locator('xpath=../../..')).toHaveAttribute('data-folder-id', idA)
  })
})
