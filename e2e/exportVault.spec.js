// 옵시디언 볼트 내보내기 (specs/features/F-2020.md) — E1~E5
import { test, expect } from '@playwright/test'
import { unzipSync } from 'fflate'
import { openApp, importMarkdown, readSavedContent } from './helpers.js'
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

function u32be(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}
function ascii(s) {
  return Array.from(s).map((c) => c.charCodeAt(0))
}
function pngBytes(width, height) {
  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u32be(13), ...ascii('IHDR'), ...u32be(width), ...u32be(height), 8, 6, 0, 0, 0]
}

async function pasteFiles(page, { targetSelector = '.cm-content', files }) {
  await page.evaluate(
    ({ targetSelector, files }) => {
      const dt = new DataTransfer()
      for (const f of files) dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.mime }))
      const el = document.querySelector(targetSelector)
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    },
    { targetSelector, files },
  )
}

test.describe('F-2020 E1 데이터 탭 버튼 (스모크)', () => {
  test('버튼이 보이고 눌리며, 로그인+오프라인이면 비활성·안내가 보인다', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    await importMarkdown(page, { content: '본문\n' })

    const dialog = await openSettings(page)
    const vaultBtn = dialog.getByRole('button', { name: '옵시디언 볼트로 내보내기' })
    await expect(vaultBtn).toBeVisible()
    await expect(vaultBtn).toBeEnabled()

    const [download] = await Promise.all([page.waitForEvent('download'), vaultBtn.click()])
    expect(download.suggestedFilename()).toMatch(/^\d{4}-\d{2}-\d{2}-vault\.zip$/)

    server.setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    await expect(vaultBtn).toBeDisabled()
    await expect(dialog.getByText('온라인일 때 내보낼 수 있습니다')).toBeVisible()
  })
})

test.describe('F-2020 E2 전체 볼트', () => {
  test('최상위 문서 + [[왜?]] 링크가 있는 문서 + 폴더 문서 — zip 이름·항목·고친 링크·알림', async ({ page }) => {
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

    const dialog = await openSettings(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: '옵시디언 볼트로 내보내기' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^\d{4}-\d{2}-\d{2}-vault\.zip$/)

    const unzipped = await unzipDownload(download)
    const names = Object.keys(unzipped)
    expect(names).not.toContain('manifest.json')
    expect(names).toContain('왜_.md')
    expect(names).toContain('목차.md')
    expect(names).toContain('폴더/안쪽.md')

    const tocContent = Buffer.from(unzipped['목차.md']).toString('utf-8')
    expect(tocContent).toContain('[[왜_|왜?]]')

    await expect(page.locator('.notice-message')).toHaveText('옵시디언 볼트로 내보냈습니다. 위키링크 1개에 경로를 붙였습니다.')
  })
})

test.describe('F-2020 E3 폴더 볼트', () => {
  test('폴더 ⋯ → 옵시디언 볼트로 내보내기 — {폴더 이름}-vault.zip, 바깥 문서 없음, manifest 없음', async ({ page }) => {
    await openApp(page)
    await importMarkdown(page, { name: 'outside.md', content: '바깥 본문\n' })
    await page.locator('.doc-title').fill('바깥문서')
    await page.locator('.doc-title').blur()

    const folderRow = await createFolder(page, '내보낼폴더')
    await addDocInFolder(folderRow, page, '안쪽문서')

    await openFolderMenu(folderRow)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.item-menu-list:not([inert])').getByRole('menuitem', { name: '옵시디언 볼트로 내보내기' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('내보낼폴더-vault.zip')

    const unzipped = await unzipDownload(download)
    const names = Object.keys(unzipped)
    expect(names).not.toContain('manifest.json')
    expect(names).toContain('안쪽문서.md')
    expect(names).not.toContain('바깥문서.md')
  })
})

test.describe('F-2020 E4 이미지', () => {
  test('폴더 안 문서의 이미지 — attachments/ 루트, {폴더}/attachments/ 없음, 임베드 한 줄', async ({ page }) => {
    await openApp(page)
    const folderRow = await createFolder(page, '폴더')
    await addDocInFolder(folderRow, page, '그림문서')

    await page.locator('.cm-content').click()
    await pasteFiles(page, { files: [{ bytes: pngBytes(20, 20), name: 'a.png', mime: 'image/png' }] })
    await expect(page.locator('.md-image-box')).toBeVisible()

    const saved = await readSavedContent(page)
    const idMatch = /attachments\/([0-9a-f]{16})\.png/.exec(saved.content)
    expect(idMatch).not.toBeNull()
    const id = idMatch[1]

    const dialog = await openSettings(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: '옵시디언 볼트로 내보내기' }).click(),
    ])
    const unzipped = await unzipDownload(download)
    expect(Object.keys(unzipped)).toContain(`attachments/${id}.png`)
    expect(Object.keys(unzipped)).not.toContain(`폴더/attachments/${id}.png`)

    const docText = Buffer.from(unzipped['폴더/그림문서.md']).toString('utf-8')
    expect(docText).toMatch(new RegExp(`!\\[\\[${id}\\.png\\|\\d+\\]\\]`))
    expect(docText).not.toContain('<div align')
  })
})
