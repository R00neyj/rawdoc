// 옵시디언 볼트 내보내기 (specs/features/F-2020.md) — E1~E3
import { test, expect } from '@playwright/test'
import { unzipSync } from 'fflate'
import { openApp, importMarkdown } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

async function openSettings(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const dialog = page.locator('dialog[aria-labelledby="settings-title"]')
  await dialog.getByRole('tab', { name: '데이터' }).click()
  return dialog
}

async function createFolder(page, name) {
  await page.getByRole('button', { name: '새 폴더', exact: true }).click()
  const renameInput = page.locator('.tree-rename-input')
  await expect(renameInput).toBeFocused()
  if (name) await renameInput.fill(name)
  await page.keyboard.press('Enter')
  return page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') }).first()
}

async function openFolderMenu(folderRow) {
  const menuBtn = folderRow.locator('.item-menu-btn')
  await menuBtn.focus()
  await menuBtn.click()
  return menuBtn
}

async function addDocInFolder(folderRow, page, title) {
  await openFolderMenu(folderRow)
  await page.locator('.item-menu-list:not([inert])').getByRole('menuitem', { name: '새 문서' }).click()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  if (title) {
    await page.locator('.doc-title').fill(title)
    await page.locator('.doc-title').blur()
  }
}

async function unzipDownload(download) {
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return unzipSync(new Uint8Array(Buffer.concat(chunks)))
}

test('F-2020 E1·E2·E3 전체 볼트·폴더 볼트 내보내기, 로그인+오프라인이면 버튼 비활성', async ({ page }) => {
  const server = await fakeServer(page)
  await openApp(page)
  // 저장 공간 보호 경고(F-118)가 알림 자리를 차지한다 — warn 은 info 로 안 밀려나므로 먼저 닫는다 (e2e/exportWorkspace.spec.js A15 와 같은 이유)
  const closeNotice = page.getByRole('button', { name: '알림 닫기' })
  if (await closeNotice.count()) await closeNotice.click()

  await importMarkdown(page, { name: 'why.md', content: '본문\n' })
  await page.locator('.doc-title').fill('왜?')
  await page.locator('.doc-title').blur()

  await importMarkdown(page, { name: 'toc.md', content: '[[왜?]]\n' })
  await page.locator('.doc-title').fill('목차')
  await page.locator('.doc-title').blur()

  const folderRow = await createFolder(page, '폴더')
  await addDocInFolder(folderRow, page, '안쪽')

  let dialog = await openSettings(page)
  const vaultBtn = dialog.getByRole('button', { name: '옵시디언 볼트로 내보내기' })
  await expect(vaultBtn).toBeEnabled()
  const [download] = await Promise.all([page.waitForEvent('download'), vaultBtn.click()])
  expect(download.suggestedFilename()).toMatch(/^\d{4}-\d{2}-\d{2}-vault\.zip$/)

  const unzipped = await unzipDownload(download)
  const names = Object.keys(unzipped)
  expect(names).not.toContain('manifest.json')
  expect(names).toContain('왜_.md')
  expect(names).toContain('목차.md')
  expect(names).toContain('폴더/안쪽.md')
  expect(Buffer.from(unzipped['목차.md']).toString('utf-8')).toContain('[[왜_|왜?]]')
  await expect(page.locator('.notice-message')).toHaveText('옵시디언 볼트로 내보냈습니다. 위키링크 1개에 경로를 붙였습니다.')
  await dialog.getByRole('button', { name: '닫기' }).click()

  await openFolderMenu(folderRow)
  const [folderDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.item-menu-list:not([inert])').getByRole('menuitem', { name: '옵시디언 볼트로 내보내기' }).click(),
  ])
  expect(folderDownload.suggestedFilename()).toBe('폴더-vault.zip')
  const folderNames = Object.keys(await unzipDownload(folderDownload))
  expect(folderNames).not.toContain('manifest.json')
  expect(folderNames).toContain('안쪽.md')
  expect(folderNames).not.toContain('목차.md')

  dialog = await openSettings(page)
  server.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(dialog.getByRole('button', { name: '옵시디언 볼트로 내보내기' })).toBeDisabled()
  await expect(dialog.getByText('온라인일 때 내보낼 수 있습니다')).toBeVisible()
})
