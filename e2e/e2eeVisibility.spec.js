// 잠긴 금고의 문서 숨김과 폴더에서 열기·잠그기 (specs/features/F-4003.md 5.2) — 준비 함수는 e2eeDocs.spec.js 에서 복사했다
import { test, expect } from '@playwright/test'
import { openApp as openAppRaw, setPrefBeforeLoad, currentDocId, importMarkdown, resetBrowserState } from './helpers.js'

const SETTINGS_DIALOG_SELECTOR = 'dialog[aria-labelledby="settings-title"]'
const PASSWORD = '충분히긴금고암호입니다'
const VAULT_FOLDER = '비밀함'
const PLAIN_FOLDER = '일반함'
const S1 = '금고가 잠겨 있어 금고 문서는 찾지 않았습니다'

// 저장 공간 보호 알림(F-118)이 금고 알림과 같은 한 자리를 두고 경쟁하지 않게 미리 꺼 둔다
async function openApp(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openAppRaw(page)
}

async function waitBooted(page) {
  await expect(page.locator('.cm-host .cm-editor').or(page.locator('.e2ee-locked-panel')).or(page.locator('.empty-state'))).toBeVisible()
}

function unlockDialog(page) {
  return page.locator('dialog[aria-labelledby="e2ee-unlock-title"]')
}

async function createVault(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const dialog = page.locator(SETTINGS_DIALOG_SELECTOR)
  await dialog.getByRole('tab', { name: '금고' }).click()
  await dialog.getByRole('button', { name: '금고 만들기…' }).click()
  const create = page.locator('dialog[aria-labelledby="e2ee-create-title"]')
  await create.locator('input[aria-labelledby="e2ee-create-password-label"]').fill(PASSWORD)
  await create.locator('input[aria-labelledby="e2ee-create-confirm-label"]').fill(PASSWORD)
  await create.getByRole('button', { name: '다음' }).click()
  await create.getByLabel('복구 코드를 안전한 곳에 보관했습니다').check()
  await create.getByRole('button', { name: '금고 만들기' }).click()
  await expect(create).toBeHidden()
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')
}

function rowOf(page, name) {
  const label = page.getByRole('button', { name, exact: true }).or(page.getByRole('link', { name, exact: true }))
  return page.locator('.sidebar .tree-row').filter({ has: label })
}

function docLink(page, id) {
  return page.locator(`.sidebar a[href="#/d/${id}"]`)
}

function docRow(page, id) {
  return page.locator('.sidebar .tree-row').filter({ has: page.locator(`a[href="#/d/${id}"]`) })
}

function folderItem(page, folderId) {
  return page.locator(`.sidebar li[data-folder-id="${folderId}"]`)
}

function openMenu(page) {
  return page.locator('.item-menu-list:not([inert])')
}

async function openRowMenu(page, row) {
  await row.hover()
  await row.locator('button[aria-label$=" 메뉴"]').click()
  return openMenu(page)
}

async function closeMenu(page) {
  await page.keyboard.press('Escape')
  await expect(page.locator('.item-menu-list')).toHaveCount(0)
}

async function newFolder(page, name) {
  await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
  const input = page.locator('.tree-rename-input')
  await expect(input).toBeFocused()
  await input.fill(name)
  await input.press('Enter')
  await expect(rowOf(page, name)).toBeVisible()
}

// 로컬 폴더 행에 e2ee: true 를 넣는다 — 금고 폴더를 만드는 화면은 F-407 몫 (F-405 9.2)
async function markLocalFolderE2ee(page, folderId) {
  await page.evaluate(
    (folderId) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('folders', 'readwrite')
          const store = tx.objectStore('folders')
          const get = store.get(folderId)
          get.onsuccess = () => store.put({ ...get.result, e2ee: true })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    folderId,
  )
}

async function folderIdOf(page, name) {
  return page.locator('.sidebar li[data-folder-id]').filter({ has: page.getByRole('button', { name, exact: true }) }).first().getAttribute('data-folder-id')
}

async function unlockVia(container) {
  await container.locator('input[type="password"]').fill(PASSWORD)
  await container.getByRole('button', { name: '열기', exact: true }).click()
}

async function writeTitleAndBody(page, title, body) {
  await page.locator('.doc-title').fill(title)
  await page.locator('.doc-title').press('Enter')
  await page.locator('.cm-content').click()
  await page.keyboard.type(body)
}

async function waitSaved(page) {
  await expect(page.locator('.statusbar-save')).toContainText('저장됨', { timeout: 10_000 })
}

// 금고 만들기 → 폴더를 금고 폴더로 → 새로고침(잠김) → 금고 폴더에 `비밀 제목` 하나(D-11 로 연다)
async function setupVaultDoc(page) {
  await openApp(page)
  const plainId = await currentDocId(page)
  await createVault(page)
  await newFolder(page, VAULT_FOLDER)
  const folderId = await folderIdOf(page, VAULT_FOLDER)
  await markLocalFolderE2ee(page, folderId)
  await page.reload()
  await waitBooted(page)

  const menu = await openRowMenu(page, rowOf(page, VAULT_FOLDER))
  await menu.getByRole('menuitem', { name: '새 문서', exact: true }).click()
  await unlockVia(unlockDialog(page))
  await expect(unlockDialog(page)).toBeHidden()
  await expect(page.locator('.doc-title')).toBeFocused()
  const secretId = await currentDocId(page)
  await writeTitleAndBody(page, '비밀 제목', '비밀 본문 한 줄')
  await waitSaved(page)
  return { plainId, folderId, secretId }
}

async function goHash(page, hash) {
  await page.evaluate((h) => {
    location.hash = h
  }, hash)
}

async function searchNotes(page) {
  await page.keyboard.press('Control+Shift+F')
  await page.locator('.search-input').fill('가')
  await expect(page.locator('dialog[open] .search-note', { hasText: S1 })).toBeVisible()
  await expect(page.locator('dialog[open] .search-note', { hasText: '목록을 새로 읽는 중' })).toHaveCount(0)
  const notes = await page.locator('dialog[open] .search-note').allTextContents()
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  return notes
}

test.describe('F-4003 잠긴 금고 숨김', () => {
  test('F-4003 E1 잠긴 동안 트리·고정됨·최근 문서에 금고 문서가 없고, 금고 폴더 펼치기는 D-11 을 거친다', async ({ page }) => {
    test.setTimeout(90_000)
    const { plainId, folderId, secretId } = await setupVaultDoc(page)

    // 금고 폴더 안 문서는 상단 고정
    const pinMenu = await openRowMenu(page, docRow(page, secretId))
    await pinMenu.getByRole('menuitem', { name: '상단 고정', exact: true }).click()
    await expect(page.locator('.pinned-list').locator(`a[href="#/d/${secretId}"]`)).toHaveCount(1)

    // 루트 문서를 금고로 옮긴다 — 가져오기는 지금 문서의 폴더에 넣으므로 루트 문서로 간다
    await docLink(page, plainId).click()
    await expect.poll(() => currentDocId(page)).toBe(plainId)
    const rootId = await importMarkdown(page, { name: '루트 비밀.md', content: '루트 본문\n' })
    const convertMenu = await openRowMenu(page, docRow(page, rootId))
    await convertMenu.getByRole('menuitem', { name: '금고로 옮기기…', exact: true }).click()
    await page.locator('dialog[open] .e2ee-convert-dialog').getByRole('button', { name: '옮기기', exact: true }).click()
    await expect(page.locator('.notice-message')).toHaveText('"루트 비밀"을(를) 금고로 옮겼습니다.')

    await docLink(page, plainId).click()
    await expect.poll(() => currentDocId(page)).toBe(plainId)
    await expect(folderItem(page, folderId)).toHaveAttribute('aria-expanded', 'true')

    await page.reload()
    await waitBooted(page)

    for (const id of [secretId, rootId]) await expect(docLink(page, id)).toHaveCount(0)
    await expect(page.locator('.pinned-list')).toHaveCount(0)
    await expect(folderItem(page, folderId)).toHaveAttribute('aria-expanded', 'false')

    await goHash(page, '#/')
    await expect(page.locator('.empty-state')).toBeVisible()
    await expect(page.locator(`.empty-state-recent a[href="#/d/${plainId}"]`)).toHaveCount(1)
    for (const id of [secretId, rootId]) await expect(page.locator(`.empty-state-recent a[href="#/d/${id}"]`)).toHaveCount(0)
    expect(await page.content()).not.toContain('잠긴 문서')

    const toggle = page.locator('.sidebar').getByRole('button', { name: `${VAULT_FOLDER} 펼치기`, exact: true })
    await toggle.click()
    await expect(unlockDialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(unlockDialog(page)).toBeHidden()
    await expect(folderItem(page, folderId)).toHaveAttribute('aria-expanded', 'false')
    await expect(docLink(page, secretId)).toHaveCount(0)

    await toggle.click()
    await unlockVia(unlockDialog(page))
    await expect(unlockDialog(page)).toBeHidden()
    await expect(folderItem(page, folderId)).toHaveAttribute('aria-expanded', 'true')
    await expect(folderItem(page, folderId).getByRole('link', { name: '비밀 제목', exact: true })).toBeVisible()
  })

  test('F-4003 E2 열린 금고 폴더 ⋯·우클릭 메뉴의 금고 잠그기 — 삭제 바로 앞, 잠그면 행이 사라지고 잠긴 동안·일반 폴더에는 없다', async ({ page }) => {
    test.setTimeout(90_000)
    const { folderId, secretId } = await setupVaultDoc(page)
    await newFolder(page, PLAIN_FOLDER)
    const vaultRow = rowOf(page, VAULT_FOLDER)
    const lockItem = (menu) => menu.getByRole('menuitem', { name: '금고 잠그기', exact: true })

    // ⋯ 메뉴 — 항목 순서에서 `금고 잠그기` 다음이 `삭제`
    const menu = await openRowMenu(page, vaultRow)
    const labels = (await menu.getByRole('menuitem').allTextContents()).map((t) => t.trim())
    expect(labels[labels.indexOf('금고 잠그기') + 1]).toBe('삭제')
    await lockItem(menu).click()
    await expect(page.locator('.statusbar-e2ee')).toHaveCount(0)
    await expect(docLink(page, secretId)).toHaveCount(0)
    await expect(folderItem(page, folderId)).toHaveAttribute('aria-expanded', 'false')

    // 잠긴 동안 ⋯·우클릭 모두 없다. 일반 폴더에도 없다
    await expect(lockItem(await openRowMenu(page, vaultRow))).toHaveCount(0)
    await closeMenu(page)
    await vaultRow.click({ button: 'right' })
    await expect(openMenu(page).getByRole('menuitem', { name: '삭제', exact: true })).toBeVisible()
    await expect(lockItem(openMenu(page))).toHaveCount(0)
    await closeMenu(page)
    await expect(lockItem(await openRowMenu(page, rowOf(page, PLAIN_FOLDER)))).toHaveCount(0)
    await closeMenu(page)

    // 펼치기로 다시 열고 같은 흐름을 우클릭으로
    await page.locator('.sidebar').getByRole('button', { name: `${VAULT_FOLDER} 펼치기`, exact: true }).click()
    await unlockVia(unlockDialog(page))
    await expect(docLink(page, secretId)).toBeVisible()
    await vaultRow.click({ button: 'right' })
    await lockItem(openMenu(page)).click()
    await expect(page.locator('.statusbar-e2ee')).toHaveCount(0)
    await expect(docLink(page, secretId)).toHaveCount(0)
    await expect(folderItem(page, folderId)).toHaveAttribute('aria-expanded', 'false')
    await vaultRow.click({ button: 'right' })
    await expect(openMenu(page).getByRole('menuitem', { name: '삭제', exact: true })).toBeVisible()
    await expect(lockItem(openMenu(page))).toHaveCount(0)
  })

  test('F-4003 E3 검색 안내 줄은 금고 문서 0개인 잠긴 금고와 1개인 잠긴 금고에서 같다', async ({ page }) => {
    test.setTimeout(90_000)
    await openApp(page)
    await createVault(page)
    await page.reload()
    await waitBooted(page)
    const empty = await searchNotes(page)

    await resetBrowserState(page)
    await setupVaultDoc(page)
    await page.reload()
    await waitBooted(page)
    const withDoc = await searchNotes(page)

    expect(empty).toContain(S1)
    expect(withDoc).toEqual(empty)
  })
})
