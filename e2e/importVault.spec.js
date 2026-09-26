// 볼트 가져오기 (specs/features/F-2019.md) — V1~V7. 폴더 끌어놓기 자체는 e2e 로 못 낸다(머리 (b), 15.2)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { test, expect } from '@playwright/test'
import { zipSync } from 'fflate'
import { openApp, waitSaved, readSavedContent, setPrefBeforeLoad } from './helpers.js'

async function skipPersistNotice(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
}

function u32be(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}
function ascii(s) {
  return Array.from(s).map((c) => c.charCodeAt(0))
}
// IHDR 만 있는 최소 PNG — inspectImageBytes 가 읽는다 (e2e/image.spec.js 의 pngBytes 와 같은 모양)
function pngBytes(width, height) {
  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32be(13), ...ascii('IHDR'), ...u32be(width), ...u32be(height), 8, 6, 0, 0, 0]
}
function sha256Hex16(bytes) {
  return crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex').slice(0, 16)
}

const GRIM_PNG = pngBytes(40, 20)
const GRIM_HASH = sha256Hex16(GRIM_PNG)

// 15.2 기본 볼트
function writeBaseVault(dir) {
  fs.mkdirSync(path.join(dir, '위키/개념'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'attachments'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.obsidian'), { recursive: true })
  fs.writeFileSync(path.join(dir, '루트.md'), '# 루트\n\n[[위키/개념/a]]\n')
  fs.writeFileSync(
    path.join(dir, '위키/개념/a.md'),
    '# a\n\n![[그림.png]]\n\n![[그림.png|300]]\n\n글 가운데 ![[그림.png]] 입니다.\n\n![[다른 문서]]\n',
  )
  fs.writeFileSync(path.join(dir, '위키/색인.md'), '색인\n')
  fs.writeFileSync(path.join(dir, 'attachments/그림.png'), Buffer.from(GRIM_PNG))
  fs.writeFileSync(path.join(dir, '.obsidian/app.json'), '{}')
  fs.writeFileSync(path.join(dir, '메모.txt'), '메모\n')
}

async function openSettingsData(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const dialog = page.locator('dialog[aria-labelledby="settings-title"]')
  await dialog.getByRole('tab', { name: '데이터' }).click()
  return dialog
}

function importDialogLocator(page) {
  return page.locator('dialog[aria-labelledby="import-preview-title"]')
}

function folderInput(page) {
  return page.locator('input[data-import="folder"]')
}

function zipInput(page) {
  return page.locator('input[data-import="zip"]')
}

async function chooseFolder(page, dirPath) {
  await folderInput(page).setInputFiles(dirPath)
}

async function chooseZip(page, buffer, name = 'vault.zip') {
  await zipInput(page).setInputFiles({ name, mimeType: 'application/zip', buffer })
}

function treeRowByLabel(page, name) {
  return page
    .locator('.tree-row')
    .filter({ has: page.locator('.tree-toggle') })
    .filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${name}$`) }) })
}

async function openFolderMenu(folderRow) {
  const menuBtn = folderRow.locator('.item-menu-btn')
  await menuBtn.focus()
  await menuBtn.click()
  return menuBtn
}

function openMenuItem(page, name) {
  return page.locator('.item-menu-list:not([inert])').getByRole('menuitem', { name })
}

async function docIdByLabel(page, name) {
  await page.locator('.tree-label').filter({ hasText: new RegExp(`^${name}$`) }).click()
  return page.evaluate(() => {
    const m = /^#\/d\/(.+)$/.exec(location.hash)
    return m ? m[1] : null
  })
}

test.describe('F-2019 볼트 가져오기', () => {
  test('V1 폴더 선택 (스모크)', async ({ page }, testInfo) => {
    await skipPersistNotice(page)
    await openApp(page)
    const dir = testInfo.outputPath('내 볼트')
    writeBaseVault(dir)

    const dialog = await openSettingsData(page)
    await dialog.getByRole('button', { name: '폴더 가져오기…' }).click()
    await expect(dialog).toBeHidden() // 설정이 닫힌다 (4.2)
    await chooseFolder(page, dir)

    const importDialog = importDialogLocator(page)
    await expect(importDialog).toBeVisible()
    await expect(importDialog).toContainText('내 볼트')
    const select = importDialog.locator('.import-target')
    await expect(select).toHaveValue('new')
    await expect(select.locator('option:checked')).toHaveText('새 폴더 "내 볼트"')
    await expect(importDialog).toContainText('새로 3개')
    await expect(importDialog).toContainText('갱신 0개')
    await expect(importDialog).toContainText('건너뜀 0개')
    await expect(importDialog).toContainText('이미지 1개')
    await expect(importDialog).toContainText('.md 가 아니라 건너뛴 파일 1개')
    await expect(importDialog).toContainText('원문 그대로 둔 이미지·임베드 2개')

    await importDialog.getByRole('button', { name: '가져오기' }).click()
    await expect(page.locator('.notice-message')).toHaveText('문서 3개를 가져왔습니다.')

    await expect(page.locator('.tree-label').filter({ hasText: /^내 볼트$/ })).toBeVisible()
    await expect(page.locator('.tree-label').filter({ hasText: /^위키$/ })).toBeVisible()
    await expect(page.locator('.tree-label').filter({ hasText: /^루트$/ })).toBeVisible()
  })

  test('V2 이미지 변환', async ({ page }, testInfo) => {
    await skipPersistNotice(page)
    await openApp(page)
    const dir = testInfo.outputPath('내 볼트')
    writeBaseVault(dir)

    const dialog = await openSettingsData(page)
    await dialog.getByRole('button', { name: '폴더 가져오기…' }).click()
    await chooseFolder(page, dir)
    await importDialogLocator(page).getByRole('button', { name: '가져오기' }).click()
    await expect(page.locator('.notice-message')).toHaveText('문서 3개를 가져왔습니다.')

    // 위키 → 개념 폴더를 차례로 펼쳐 안의 a 를 연다
    await treeRowByLabel(page, '위키').locator('.tree-toggle').click()
    await treeRowByLabel(page, '개념').locator('.tree-toggle').click()
    const docId = await docIdByLabel(page, 'a')
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()

    const saved = await readSavedContent(page, docId)
    const expected =
      `# a\n\n` +
      `<div align="left">\n  <img src="attachments/${GRIM_HASH}.png" alt="그림">\n</div>\n\n` +
      `<div align="left">\n  <img src="attachments/${GRIM_HASH}.png" alt="그림" width="300">\n</div>\n\n` +
      `글 가운데 ![[그림.png]] 입니다.\n\n` +
      `![[다른 문서]]\n`
    expect(saved.content).toBe(expected)

    await expect(page.locator('.md-image-box')).toHaveCount(2)
  })

  test('V3 다시 가져오기 = 건너뜀', async ({ page }, testInfo) => {
    await skipPersistNotice(page)
    await openApp(page)
    const dir = testInfo.outputPath('내 볼트')
    writeBaseVault(dir)

    const dialog1 = await openSettingsData(page)
    await dialog1.getByRole('button', { name: '폴더 가져오기…' }).click()
    await chooseFolder(page, dir)
    await importDialogLocator(page).getByRole('button', { name: '가져오기' }).click()
    await expect(page.locator('.notice-message')).toHaveText('문서 3개를 가져왔습니다.')

    const dialog2 = await openSettingsData(page)
    await dialog2.getByRole('button', { name: '폴더 가져오기…' }).click()
    await chooseFolder(page, dir)

    const importDialog = importDialogLocator(page)
    await expect(importDialog).toBeVisible()
    const select = importDialog.locator('.import-target')
    await expect(select.locator('option:checked')).toHaveText('내 볼트')
    await expect(importDialog).toContainText('새로 0개')
    await expect(importDialog).toContainText('갱신 0개')
    await expect(importDialog).toContainText('건너뜀 3개')
    await expect(importDialog).toContainText('이미지 0개')
    await expect(importDialog).toContainText('가져올 문서가 없습니다.')
    await expect(importDialog.getByRole('button', { name: '가져오기' })).toBeDisabled()
  })

  test('V4 갱신·사본·그대로 둔 문서', async ({ page }, testInfo) => {
    await skipPersistNotice(page)
    await openApp(page)
    const dir = testInfo.outputPath('내 볼트')
    writeBaseVault(dir)

    const dialog1 = await openSettingsData(page)
    await dialog1.getByRole('button', { name: '폴더 가져오기…' }).click()
    await chooseFolder(page, dir)
    await importDialogLocator(page).getByRole('button', { name: '가져오기' }).click()
    await expect(page.locator('.notice-message')).toHaveText('문서 3개를 가져왔습니다.')

    // 앱에서 내 볼트 폴더에 문서를 하나 더 만든다 — 볼트에는 없는 문서
    const vaultFolderRow = treeRowByLabel(page, '내 볼트')
    await openFolderMenu(vaultFolderRow)
    await openMenuItem(page, '새 문서').click()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await page.locator('.doc-title').fill('앱에서 쓴 글')
    await page.locator('.doc-title').blur()
    await waitSaved(page)

    // 디스크에서 볼트를 고친다
    fs.writeFileSync(path.join(dir, '위키/색인.md'), '색인 고침\n')
    fs.writeFileSync(path.join(dir, '위키/새 글.md'), '새 글\n')

    const dialog2 = await openSettingsData(page)
    await dialog2.getByRole('button', { name: '폴더 가져오기…' }).click()
    await chooseFolder(page, dir)

    const importDialog = importDialogLocator(page)
    await expect(importDialog).toBeVisible()
    await expect(importDialog).toContainText('새로 1개')
    await expect(importDialog).toContainText('갱신 1개')
    await expect(importDialog).toContainText('건너뜀 2개')
    await expect(importDialog).toContainText('볼트에 없어 그대로 둔 문서 1개')
    await expect(importDialog).toContainText('이전 내용을')

    await importDialog.getByRole('button', { name: '가져오기' }).click()
    await expect(page.locator('.notice-message')).toHaveText('문서 1개를 가져오고 1개를 갱신했습니다.')

    await expect(page.locator('.tree-label').filter({ hasText: /^앱에서 쓴 글$/ })).toBeVisible()
    await treeRowByLabel(page, '위키').locator('.tree-toggle').click()
    await expect(page.locator('.tree-label').filter({ hasText: /^색인 \(가져오기 전\)$/ })).toBeVisible()
    await expect(page.locator('.tree-label').filter({ hasText: /^새 글$/ })).toBeVisible()
  })

  test('V5 넣을 폴더 바꾸기', async ({ page }, testInfo) => {
    await skipPersistNotice(page)
    await openApp(page)
    const dir = testInfo.outputPath('내 볼트')
    writeBaseVault(dir)

    const dialog1 = await openSettingsData(page)
    await dialog1.getByRole('button', { name: '폴더 가져오기…' }).click()
    await chooseFolder(page, dir)
    await importDialogLocator(page).getByRole('button', { name: '가져오기' }).click()
    await expect(page.locator('.notice-message')).toHaveText('문서 3개를 가져왔습니다.')

    const rowCountBefore = await page.locator('.tree-row').count()

    const dialog2 = await openSettingsData(page)
    await dialog2.getByRole('button', { name: '폴더 가져오기…' }).click()
    await chooseFolder(page, dir)

    const importDialog = importDialogLocator(page)
    const select = importDialog.locator('.import-target')
    await expect(importDialog).toContainText('건너뜀 3개')

    await select.selectOption('top')
    await expect(importDialog).toContainText('새로 3개')
    await expect(importDialog).toContainText('갱신 0개')
    await expect(importDialog).toContainText('건너뜀 0개')

    await select.selectOption({ label: '내 볼트' })
    await expect(importDialog).toContainText('건너뜀 3개')

    await importDialog.getByRole('button', { name: '취소' }).click()
    await expect(importDialog).toBeHidden()
    await expect(page.locator('.tree-row')).toHaveCount(rowCountBefore)
  })

  test('V6 manifest.json 없는 zip', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)

    const zipBytes = zipSync({
      '내 볼트/a.md': new TextEncoder().encode('# a\n'),
      '내 볼트/b/c.md': new TextEncoder().encode('# c\n'),
      '__MACOSX/x': new TextEncoder().encode(''),
    })

    const dialog = await openSettingsData(page)
    await dialog.getByRole('button', { name: '가져오기…', exact: true }).click()
    await chooseZip(page, Buffer.from(zipBytes), 'vault.zip')

    const importDialog = importDialogLocator(page)
    await expect(importDialog).toBeVisible()
    await expect(importDialog).toContainText('vault.zip')
    await expect(importDialog.locator('.import-target option:checked')).toHaveText('새 폴더 "내 볼트"')
    await expect(importDialog).toContainText('새로 2개')

    await importDialog.getByRole('button', { name: '가져오기' }).click()
    await expect(page.locator('.notice-message')).toHaveText('문서 2개를 가져왔습니다.')

    await expect(page.locator('.tree-label').filter({ hasText: /^내 볼트$/ })).toBeVisible()
    await expect(page.locator('.tree-label').filter({ hasText: /^a$/ })).toBeVisible()
    await expect(page.locator('.tree-label').filter({ hasText: /^b$/ })).toBeVisible()
  })

  test('V7 끌어놓기 덮개 문구', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)

    await page.evaluate(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(['# 안녕\n'], 'a.md', { type: 'text/markdown' }))
      const el = document.querySelector('.sidebar')
      el.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })

    await expect(page.locator('.drop-overlay')).toContainText('여기에 놓아 .md 파일·폴더 가져오기')
  })
})
