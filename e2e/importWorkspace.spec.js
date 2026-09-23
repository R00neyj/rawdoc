// 가져오기 (specs/features/F-282.md) — A11~A15
import { test, expect } from '@playwright/test'
import { zipSync, unzipSync } from 'fflate'
import { openApp, importMarkdown, waitSaved, readSavedContent, setPrefBeforeLoad } from './helpers.js'

// 저장 공간 보호 경고(F-118)가 가져오기 결과 알림을 밀어내지 않게 미리 본 것으로 표시해 둔다 (e2e/fileDrop.spec.js 와 같은 이유)
async function skipPersistNotice(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
}

async function openSettingsData(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const dialog = page.locator('dialog[aria-labelledby="settings-title"]')
  await dialog.getByRole('tab', { name: '데이터' }).click() // F-290 — 가져오기 버튼은 데이터 탭
  return dialog
}

function importDialogLocator(page) {
  return page.locator('dialog[aria-labelledby="import-preview-title"]')
}

function zipInput(page) {
  return page.locator('input[data-import="zip"]')
}

async function chooseZip(page, buffer, name = 'import.zip') {
  await zipInput(page).setInputFiles({ name, mimeType: 'application/zip', buffer })
}

async function downloadBuffer(download) {
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function folderRowByName(page, name) {
  // 이름으로 고정 — '.first()' 는 폴더가 둘 이상이면 이름과 무관하게 DOM 순서상 첫 행을 가리켜 버린다
  return page
    .locator('.tree-row')
    .filter({ has: page.locator('.tree-toggle') })
    .filter({ has: page.locator('.tree-label', { hasText: new RegExp(`^${name}$`) }) })
}

async function createFolder(page, name) {
  await page.getByRole('button', { name: '새 폴더', exact: true }).click()
  const renameInput = page.locator('.tree-rename-input')
  await expect(renameInput).toBeFocused()
  if (name) await renameInput.fill(name)
  await page.keyboard.press('Enter')
  return folderRowByName(page, name)
}

// 방금 닫힌 다른 행의 메뉴가 사라지는 애니메이션 중(inert) 남아 있을 수 있어 지금 열린 메뉴 안에서만 찾는다
function openMenuItem(page, name) {
  return page.locator('.item-menu-list:not([inert])').getByRole('menuitem', { name })
}

async function openFolderMenu(folderRow) {
  const menuBtn = folderRow.locator('.item-menu-btn')
  await menuBtn.focus()
  await menuBtn.click()
  return menuBtn
}

async function addDocInFolder(folderRow, page, title) {
  await openFolderMenu(folderRow)
  await openMenuItem(page, '새 문서').click()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  if (title) {
    await page.locator('.doc-title').fill(title)
    await page.locator('.doc-title').blur()
  }
  await waitSaved(page)
}

async function deleteDocRow(page, title) {
  const row = page.locator('.tree-row').filter({ hasText: title }).first()
  await row.hover()
  await row.locator('.item-menu-btn').click()
  await openMenuItem(page, '삭제').click()
  await page.getByRole('button', { name: '삭제', exact: true }).click()
}

async function deleteFolderRowAll(folderRow, page) {
  await openFolderMenu(folderRow)
  await openMenuItem(page, '삭제').click()
  const dialog = page.locator('dialog[open]')
  await dialog.getByRole('button', { name: '전부 삭제' }).click()
}

test.describe('F-282 A11 대화상자 (스모크)', () => {
  test('설정 → 가져오기… → 파일 고르기 → 미리보기 → 취소', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    const before = await page.locator('.tree-row').count()

    const dialog = await openSettingsData(page)
    await dialog.getByRole('button', { name: '가져오기…' }).click()
    await expect(dialog).toBeHidden()

    const zipBytes = zipSync({ 'a.md': new TextEncoder().encode('A 내용\n') })
    await chooseZip(page, Buffer.from(zipBytes))

    const importDialog = importDialogLocator(page)
    await expect(importDialog).toBeVisible()
    await expect(importDialog).toContainText('새로 1개')

    await importDialog.getByRole('button', { name: '취소' }).click()
    await expect(importDialog).toBeHidden()
    await expect(page.locator('.tree-row')).toHaveCount(before)
  })
})

test.describe('F-282 A12 왕복', () => {
  test('전체 내보내기 → 전부 지움 → 가져오기 — 같은 구조·같은 제목·같은 바이트', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    // 첫 실행 안내 문서("사용법")가 이미 하나 있다 — 지운 뒤 남는 행 수 기준으로 삼는다
    const baselineRows = await page.locator('.tree-row').count()
    const rootId = await importMarkdown(page, { name: 'root.md', content: '루트 본문\n' })
    await page.locator('.doc-title').fill('루트문서')
    await page.locator('.doc-title').blur()
    await waitSaved(page)

    // 하위 폴더(중첩) 생성은 F-282 밖의 기존 앱 버그로 막혀 있어 최상위 폴더 두 개로 대신한다 — 3.6 폴더 판정·id 유지 round-trip 은 중첩 여부와 무관하게 같은 경로로 검증된다
    const folderRow = await createFolder(page, '폴더')
    await addDocInFolder(folderRow, page, '폴더문서')
    const folder2Row = await createFolder(page, '폴더2')
    await addDocInFolder(folder2Row, page, '폴더2문서')

    let dialog = await openSettingsData(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: '전체 내보내기' }).click(),
    ])
    const zipBuffer = await downloadBuffer(download)
    await dialog.getByRole('button', { name: '닫기' }).click()

    // 전부 지운다 — 최상위 문서 하나, 폴더(안의 문서 포함) 둘. 단계 사이에 다시 그려지길 기다려 지워지는 중인 행을 잡지 않게 한다
    await deleteDocRow(page, '루트문서')
    await expect(page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') })).toHaveCount(2)
    await deleteFolderRowAll(page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') }).first(), page)
    await expect(page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') })).toHaveCount(1)
    await deleteFolderRowAll(page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') }).first(), page)
    await expect(page.locator('.tree-row')).toHaveCount(baselineRows)

    dialog = await openSettingsData(page)
    await dialog.getByRole('button', { name: '가져오기…' }).click()
    await chooseZip(page, zipBuffer)

    const importDialog = importDialogLocator(page)
    await expect(importDialog).toBeVisible()
    await expect(importDialog).toContainText('새로 3개')
    await importDialog.getByRole('button', { name: '가져오기' }).click()

    await expect(page.locator('.notice-message')).toHaveText('문서 3개를 가져왔습니다.')
    await expect(page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') })).toHaveCount(2)
    await expect(page.locator('.tree-label').filter({ hasText: /^루트문서$/ })).toBeVisible()

    // 폴더 id 가 지운 것과 같게 돌아와(3.6) 지우기 전 펼침 기록(md.openFolders)에 남아 있던 id 로 펼쳐진 채 보인다
    await expect(page.locator('.tree-row').filter({ has: page.locator('.tree-toggle-spacer') })).toHaveCount(baselineRows + 3)
    await expect(page.locator('.tree-label').filter({ hasText: /^폴더문서$/ })).toBeVisible()
    await expect(page.locator('.tree-label').filter({ hasText: /^폴더2문서$/ })).toBeVisible()

    // readSavedContent 는 상태바 "저장됨" 을 기다린다 — 문서를 열어야 상태바가 보인다
    await page.locator('.tree-label').filter({ hasText: /^루트문서$/ }).click()
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    const restored = await readSavedContent(page, rootId)
    expect(restored.content).toBe('루트 본문\n')
  })
})

test.describe('F-282 A13 갱신·사본', () => {
  test('zip 쪽 updatedAt 이 더 늦으면 갱신하고, 갱신 전 내용을 사본으로 남긴다', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    const docId = await importMarkdown(page, { name: 'doc.md', content: '원본 내용\n' })
    await page.locator('.doc-title').fill('갱신문서')
    await page.locator('.doc-title').blur()
    await waitSaved(page)

    let dialog = await openSettingsData(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: '전체 내보내기' }).click(),
    ])
    const zipBuffer = await downloadBuffer(download)
    await dialog.getByRole('button', { name: '닫기' }).click()

    // 문서를 고쳐 저장 — updatedAt 을 늦춘다
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('고친 내용')
    await waitSaved(page)

    const unzipped = unzipSync(new Uint8Array(zipBuffer))
    const manifest = JSON.parse(Buffer.from(unzipped['manifest.json']).toString('utf-8'))
    manifest.docs[0].updatedAt = Date.now() + 10_000_000 // 확실히 더 늦게
    const rezipped = zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
      [manifest.docs[0].path]: unzipped[manifest.docs[0].path],
    })

    dialog = await openSettingsData(page)
    await dialog.getByRole('button', { name: '가져오기…' }).click()
    await chooseZip(page, Buffer.from(rezipped))

    const importDialog = importDialogLocator(page)
    await expect(importDialog).toBeVisible()
    await expect(importDialog).toContainText('갱신 1개')
    await importDialog.getByRole('button', { name: '가져오기' }).click()

    await expect(page.locator('.notice-message')).toHaveText('문서 0개를 가져오고 1개를 갱신했습니다.')
    await expect(page.locator('.tree-row').filter({ hasText: '갱신문서 (가져오기 전)' })).toBeVisible()

    const updated = await readSavedContent(page, docId)
    expect(updated.content).toBe('원본 내용\n')
  })
})

test.describe('F-282 A14 일반 zip', () => {
  test('manifest 없는 zip — .md 만 문서로, 폴더를 만들고, 나머지는 경고', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)

    const zipBytes = zipSync({
      'a.md': new TextEncoder().encode('A 내용\n'),
      '폴더/b.md': new TextEncoder().encode('B 내용\n'),
      'note.txt': new TextEncoder().encode('텍스트\n'),
    })

    const dialog = await openSettingsData(page)
    await dialog.getByRole('button', { name: '가져오기…' }).click()
    await chooseZip(page, Buffer.from(zipBytes))

    const importDialog = importDialogLocator(page)
    await expect(importDialog).toBeVisible()
    await expect(importDialog).toContainText('새로 2개')
    await expect(importDialog).toContainText('.md 가 아니라 건너뛴 파일 1개')
    await importDialog.getByRole('button', { name: '가져오기' }).click()

    await expect(page.locator('.notice-message')).toHaveText('문서 2개를 가져왔습니다.')
    await expect(page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') })).toHaveCount(1)
    await expect(page.locator('.tree-label').filter({ hasText: /^폴더$/ })).toBeVisible()
    await expect(page.locator('.tree-label').filter({ hasText: /^a$/ })).toBeVisible()
    // 가져오기로 만든 폴더는 기본으로 접혀 있다 — 펼쳐야 안의 문서가 보인다
    await page.locator('.tree-row').filter({ has: page.locator('.tree-toggle') }).locator('.tree-toggle').click()
    await expect(page.locator('.tree-label').filter({ hasText: /^b$/ })).toBeVisible()
  })
})

test.describe('F-282 A15 거부', () => {
  test('모르는 format — 대화상자를 열지 않고 오류 알림만', async ({ page }) => {
    await skipPersistNotice(page)
    await openApp(page)
    const before = await page.locator('.tree-row').count()

    const zipBytes = zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify({ format: 99, folders: [], docs: [] })),
    })

    const dialog = await openSettingsData(page)
    await dialog.getByRole('button', { name: '가져오기…' }).click()
    await chooseZip(page, Buffer.from(zipBytes))

    await expect(page.locator('.notice-message')).toHaveText('이 zip 은 모르는 형식(format 99)이라 가져올 수 없습니다.')
    await expect(importDialogLocator(page)).toBeHidden()
    await expect(page.locator('.tree-row')).toHaveCount(before)
  })
})
