// 금고 폴더 드롭 — 평문 문서를 금고 폴더에 끌어 놓으면 D-9 확인 뒤 금고 문서로 바꿔 그 폴더로 옮긴다 (F-407 경로 재사용)
import { test, expect } from '@playwright/test'
import { openApp as openAppRaw, setPrefBeforeLoad, importMarkdown } from './helpers.js'

const PASSWORD = '충분히긴금고암호입니다'
const VAULT_FOLDER = '비밀함'
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/

// 저장 공간 보호 알림(F-118)이 금고 알림과 한 자리를 두고 경쟁하지 않게 미리 꺼 둔다
async function openApp(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openAppRaw(page)
}

function notice(page) {
  return page.locator('.notice:not([inert]) .notice-message')
}

function convertDialog(page) {
  return page.locator('dialog[open] .e2ee-convert-dialog')
}

function folderRow(page, name) {
  return page.locator('.sidebar .tree-row').filter({ has: page.getByRole('button', { name, exact: true }) })
}

function docRow(page, id) {
  return page.locator('.sidebar .tree-row').filter({ has: page.locator(`a[href="#/d/${id}"]`) })
}

async function folderIdOf(page, name) {
  return page.locator('.sidebar li[data-folder-id]').filter({ has: page.getByRole('button', { name, exact: true }) }).first().getAttribute('data-folder-id')
}

async function newFolder(page, name) {
  await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
  const input = page.locator('.tree-rename-input')
  await expect(input).toBeFocused()
  await input.fill(name)
  await input.press('Enter')
  await expect(folderRow(page, name)).toBeVisible()
}

// e2eeDocs.spec.js 와 같은 끌어 놓기 — 사이드바 dragstart·dragover·drop·dragend
async function dragRowTo(page, sourceLocator, targetLocator) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await sourceLocator.dispatchEvent('dragstart', { dataTransfer })
  await targetLocator.dispatchEvent('dragover', { dataTransfer })
  await targetLocator.dispatchEvent('drop', { dataTransfer })
  await sourceLocator.dispatchEvent('dragend', { dataTransfer })
}

function readDocRow(page, id) {
  return page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const r = db.transaction('docs', 'readonly').objectStore('docs').get(id)
          r.onsuccess = () => {
            db.close()
            resolve(r.result ?? null)
          }
          r.onerror = () => reject(r.error)
        }
      }),
    id,
  )
}

// 빈 폴더를 메뉴의 금고로 옮기기로 금고 폴더로 — D-8 로 금고를 만들어 열린 채로 둔다
async function makeOpenVaultFolder(page) {
  await newFolder(page, VAULT_FOLDER)
  const row = folderRow(page, VAULT_FOLDER)
  await row.hover()
  await row.locator('button[aria-label$=" 메뉴"]').click()
  await page.locator('.item-menu-list:not([inert])').getByRole('menuitem', { name: '금고로 옮기기…', exact: true }).click()
  await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
  const create = page.locator('dialog[aria-labelledby="e2ee-create-title"]')
  await expect(create).toBeVisible()
  await create.locator('input[aria-labelledby="e2ee-create-password-label"]').fill(PASSWORD)
  await create.locator('input[aria-labelledby="e2ee-create-confirm-label"]').fill(PASSWORD)
  await create.getByRole('button', { name: '다음' }).click()
  await create.getByLabel('복구 코드를 안전한 곳에 보관했습니다').check()
  await create.getByRole('button', { name: '금고 만들기' }).click()
  await expect(create).toBeHidden()
  await expect(notice(page)).toHaveText(`"${VAULT_FOLDER}" 폴더를 금고로 옮겼습니다(문서 0개).`)
  return folderIdOf(page, VAULT_FOLDER)
}

test.describe('금고 폴더 드롭', () => {
  test('금고 폴더 드롭 — 취소하면 제자리·평문, 확인하면 금고 문서가 되어 그 폴더 안에 있고 새로고침 뒤에도 그대로', async ({ page }) => {
    test.setTimeout(60_000)
    await openApp(page)
    const folderId = await makeOpenVaultFolder(page)
    const id = await importMarkdown(page, { name: '드롭 메모.md', content: '# 드롭\n\n평문 본문\n' })
    expect((await readDocRow(page, id)).folderId ?? null).toBeNull()

    await test.step('취소 — 문서는 제자리, 평문, E19 없음', async () => {
      await dragRowTo(page, docRow(page, id), folderRow(page, VAULT_FOLDER))
      const dialog = convertDialog(page)
      await expect(dialog).toContainText('"드롭 메모"을(를) 암호화해 이 브라우저의 금고에 넣습니다.')
      await expect(dialog.locator('.e2ee-convert-note').first()).toHaveText(`옮긴 뒤 "${VAULT_FOLDER}" 폴더에 넣습니다.`)
      await dialog.getByRole('button', { name: '취소', exact: true }).click()
      await expect(dialog).toHaveCount(0)

      const row = await readDocRow(page, id)
      expect(row.folderId ?? null).toBeNull()
      expect(row.e2eeKey).toBeUndefined()
      expect(row.content).toContain('평문 본문')
      await expect(page.locator('.notice--error')).toHaveCount(0)
    })

    await test.step('확인 — 금고 문서가 되어 금고 폴더로, 새로고침 뒤에도', async () => {
      await dragRowTo(page, docRow(page, id), folderRow(page, VAULT_FOLDER))
      await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
      await expect(notice(page)).toHaveText(`"드롭 메모"을(를) 금고로 옮겨 "${VAULT_FOLDER}" 폴더에 넣었습니다.`)
      await expect.poll(async () => (await readDocRow(page, id)).folderId).toBe(folderId)

      await page.reload()
      await expect(page.locator('.cm-host .cm-editor').or(page.locator('.e2ee-locked-panel')).or(page.locator('.empty-state'))).toBeVisible()
      const row = await readDocRow(page, id)
      expect(row.folderId).toBe(folderId)
      expect(row.e2eeKey).toHaveLength(56)
      expect(row.content).toMatch(BASE64_RE)
      expect(row.content).not.toContain('평문')
    })
  })
})
