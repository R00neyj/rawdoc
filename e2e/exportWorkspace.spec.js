// 전체·폴더 내보내기 (specs/features/F-281.md) — A11~A15
import { test, expect } from '@playwright/test'
import { unzipSync } from 'fflate'
import { openApp, importMarkdown } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

async function openSettings(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const dialog = page.locator('dialog[aria-labelledby="settings-title"]')
  await dialog.getByRole('tab', { name: '데이터' }).click() // F-290 — 전체 내보내기는 데이터 탭
  return dialog
}

// 사이드바 위쪽 아이콘 버튼으로 최상위에 폴더를 만들고, 기본 이름("새 폴더") 그대로 Enter 로 커밋한다
async function createFolder(page, name) {
  await page.getByRole('button', { name: '새 폴더', exact: true }).click()
  const renameInput = page.locator('.tree-rename-input')
  await expect(renameInput).toBeFocused()
  if (name) {
    await renameInput.fill(name)
  }
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
  await page.getByRole('menuitem', { name: '새 문서' }).click()
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

test.describe('F-281 A11 데이터 절 (스모크)', () => {
  test('설정 대화상자에 데이터 라벨과 전체 내보내기 버튼이 보이고, 닫기로 닫힌다', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })

    const dialog = await openSettings(page)
    await expect(dialog.getByText('데이터')).toBeVisible()
    const exportBtn = dialog.getByRole('button', { name: '전체 내보내기' })
    await expect(exportBtn).toBeVisible()
    await expect(exportBtn).toBeEnabled()

    await dialog.getByRole('button', { name: '닫기' }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('F-281 A12 전체 내보내기', () => {
  test('최상위 문서 + 폴더(문서) + 하위 폴더(문서) — zip 파일명·manifest·.md 3개', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'root.md', content: '루트 본문\n' })
    await page.locator('.doc-title').fill('루트문서')
    await page.locator('.doc-title').blur()

    const folderRow = await createFolder(page, '폴더')
    await addDocInFolder(folderRow, page, '폴더문서')

    await folderRow.locator('.tree-toggle').click() // 펼쳐 하위 폴더 만들기 버튼이 보이게
    await openFolderMenu(folderRow)
    await page.getByRole('menuitem', { name: '하위 폴더' }).click()
    const subRenameInput = page.locator('.tree-rename-input')
    await subRenameInput.fill('하위폴더')
    await page.keyboard.press('Enter')
    const subFolderRow = page.locator('.tree-row').filter({ hasText: '하위폴더' })
    await addDocInFolder(subFolderRow, page, '하위문서')

    const dialog = await openSettings(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: '전체 내보내기' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^\d{4}-\d{2}-\d{2}-export\.zip$/)

    const unzipped = await unzipDownload(download)
    const names = Object.keys(unzipped)
    expect(names).toContain('manifest.json')
    expect(names).toContain('루트문서.md')
    expect(names).toContain('폴더/폴더문서.md')
    expect(names).toContain('폴더/하위폴더/하위문서.md')

    const manifest = JSON.parse(Buffer.from(unzipped['manifest.json']).toString('utf-8'))
    expect(manifest.format).toBe(1)
    expect(manifest.scope).toBe('all')
  })
})

test.describe('F-281 A13 폴더 내보내기', () => {
  test('폴더 ⋯ → 폴더 내보내기 — {폴더 이름}.zip, 루트에 그 문서와 manifest, 바깥 문서 없음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'outside.md', content: '바깥 본문\n' })
    await page.locator('.doc-title').fill('바깥문서')
    await page.locator('.doc-title').blur()

    const folderRow = await createFolder(page, '내보낼폴더')
    await addDocInFolder(folderRow, page, '안쪽문서')

    await openFolderMenu(folderRow)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: '폴더 내보내기' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('내보낼폴더.zip')

    const unzipped = await unzipDownload(download)
    const names = Object.keys(unzipped)
    expect(names).toContain('manifest.json')
    expect(names).toContain('안쪽문서.md')
    expect(names).not.toContain('바깥문서.md')
  })
})

test.describe('F-281 A14 오프라인', () => {
  test('로그인 뒤 오프라인 — 전체 내보내기 버튼 비활성, 안내 문구', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })
    server.setOffline(true)

    const dialog = await openSettings(page)
    const exportBtn = dialog.getByRole('button', { name: '전체 내보내기' })
    await expect(exportBtn).toBeDisabled()
    await expect(dialog.getByText('온라인일 때 내보낼 수 있습니다')).toBeVisible()
  })
})

test.describe('F-281 A15 내보낼 것 없음', () => {
  test('문서·폴더가 없는 빈 상태 — 다운로드 없이 안내 알림', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettings(page)

    let downloadHappened = false
    page.once('download', () => {
      downloadHappened = true
    })
    await dialog.getByRole('button', { name: '전체 내보내기' }).click()
    await expect(page.locator('.notice-message')).toHaveText('내보낼 문서가 없습니다.')
    expect(downloadHappened).toBe(false)
  })
})
