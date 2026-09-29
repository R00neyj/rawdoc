// 전체·폴더 내보내기 (specs/features/F-281.md) — A11~A15
import { test, expect } from '@playwright/test'
import { unzipSync } from 'fflate'
import { openApp, importMarkdown } from './helpers.js'

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
  // 방금 닫힌 다른 행의 메뉴가 사라지는 애니메이션 중(inert) 남아 있어 지금 열린 메뉴 안에서만 찾는다
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

test.describe('F-281 A12 전체 내보내기', () => {
  test('최상위 문서 + 폴더(문서) + 하위 폴더(문서) — zip 파일명·manifest·.md 3개', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'root.md', content: '루트 본문\n' })
    await page.locator('.doc-title').fill('루트문서')
    await page.locator('.doc-title').blur()

    const folderRow = await createFolder(page, '폴더')
    await addDocInFolder(folderRow, page, '폴더문서')

    // 이름 입력 칸은 트리 안에 있어 부모가 펼쳐져 있어야 한다 — 이미 펼쳐졌는데 누르면 접혀서 .tree-rename-input 이 영영 안 보인다
    const toggle = folderRow.locator('.tree-toggle')
    const alreadyOpen = await toggle.locator('.tree-toggle-icon--open').count()
    if (!alreadyOpen) await toggle.click()
    await openFolderMenu(folderRow)
    await page.locator('.item-menu-list:not([inert])').getByRole('menuitem', { name: '하위 폴더' }).click()
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
      page.locator('.item-menu-list:not([inert])').getByRole('menuitem', { name: '폴더 내보내기' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('내보낼폴더.zip')

    const unzipped = await unzipDownload(download)
    const names = Object.keys(unzipped)
    expect(names).toContain('manifest.json')
    expect(names).toContain('안쪽문서.md')
    expect(names).not.toContain('바깥문서.md')
  })
})
