// 금고 문서의 검색·지도·내보내기·공유 메뉴 (specs/features/F-409.md 9.2) — 준비는 F-405 9.2 와 같은 방식
import { test, expect } from '@playwright/test'
import zlib from 'node:zlib'
import { unzipSync } from 'fflate'
import brand from '../brand.config.ts'
import { openApp as openAppRaw, setPrefBeforeLoad, currentDocId, setViewMode, openExportMenu, EXPORT_BUTTON_LABEL } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const SETTINGS_DIALOG_SELECTOR = 'dialog[aria-labelledby="settings-title"]'
const PASSWORD = '충분히긴금고암호입니다'
const VAULT_FOLDER = '비밀함'
const SHARE_BUTTON_LABEL = '공유 — 링크·마크다운 복사'

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

async function openRowMenu(page, name) {
  const row = rowOf(page, name)
  await row.hover()
  await row.getByRole('button', { name: `${name} 메뉴` }).click()
  return page.locator('.item-menu-list:not([inert])')
}

async function newFolder(page, name) {
  await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
  const input = page.locator('.tree-rename-input')
  await expect(input).toBeFocused()
  await input.fill(name)
  await input.press('Enter')
  await expect(rowOf(page, name)).toBeVisible()
}

// 금고 폴더 `⋯` → 새 문서 — 금고가 열려 있으면 곧장 새 문서가 열리고, 잠겨 있으면 D-11 이 뜬다
async function clickNewDocInFolder(page, folderName) {
  const menu = await openRowMenu(page, folderName)
  await menu.getByRole('menuitem', { name: '새 문서', exact: true }).click()
}

async function newVaultDoc(page, folderName = VAULT_FOLDER) {
  const before = await currentDocId(page)
  await clickNewDocInFolder(page, folderName)
  await expect.poll(() => currentDocId(page)).not.toBe(before)
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  return currentDocId(page)
}

// 로컬 폴더 행에 e2ee: true 를 넣는다 — 금고 폴더를 만드는 화면은 F-407 몫 (F-405 9.2 와 같은 방식)
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

async function gotoDoc(page, id) {
  await page.evaluate((id) => {
    location.hash = `#/d/${id}`
  }, id)
}

// 상태바로 금고를 잠근다(이미 열려 있어야 한다) — F-405 E4·E5 와 같은 동작
async function lockVault(page) {
  await page.locator('.statusbar-e2ee').click()
  await expect(page.locator('.statusbar-e2ee')).toHaveCount(0)
}

// 지도 화면처럼 상태바가 안 보이는 화면에서는 팔레트 `금고 잠그기` 로 잠근다 (e2eeKeys.spec.js 와 같은 경로)
async function lockVaultViaPalette(page) {
  await page.keyboard.press('Control+p')
  const palette = page.locator('dialog[open] .command-palette')
  await palette.locator('.command-palette-input').fill('금고 잠그기')
  await palette.getByRole('option', { name: '금고 잠그기', exact: true }).click()
}

// 금고 문서 + 일반 문서([[비밀 제목]] 을 가리킨다)를 만든다(9.2 준비) — `새 문서` 는 지금 문서의 폴더 안에 만들어(newDocFolderId), 금고 폴더를 만들기 전 루트의 첫 문서를 고쳐 쓴다
async function setupDocs(page) {
  await openApp(page)
  await page.locator('.doc-title').fill('일반 문서')
  await page.locator('.doc-title').press('Enter')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+A')
  await page.keyboard.type('[[비밀 제목]] 을 가리킨다')
  const plainId = await currentDocId(page)
  await waitSaved(page)

  await createVault(page)
  await newFolder(page, VAULT_FOLDER)
  const folderId = await folderIdOf(page, VAULT_FOLDER)
  await markLocalFolderE2ee(page, folderId)
  await page.reload()
  await waitBooted(page)

  await clickNewDocInFolder(page, VAULT_FOLDER)
  await unlockVia(unlockDialog(page))
  await expect(unlockDialog(page)).toBeHidden()
  await expect(page.locator('.doc-title')).toBeFocused()
  const secretId = await currentDocId(page)
  await writeTitleAndBody(page, '비밀 제목', '비밀 본문 한 줄')
  await waitSaved(page)

  await gotoDoc(page, plainId)
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()

  return { folderId, secretId, plainId }
}

async function openSettings(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const dialog = page.locator(SETTINGS_DIALOG_SELECTOR)
  await dialog.getByRole('tab', { name: '데이터' }).click()
  return dialog
}

async function unzipDownload(download) {
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return unzipSync(new Uint8Array(Buffer.concat(chunks)))
}

async function readDownloadText(download) {
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf-8')
}

async function openMap(page) {
  await page.getByRole('button', { name: '지도' }).first().click()
  await expect(page.locator('.map-page')).toBeVisible()
  return page.locator('.map-page')
}

async function showList(map) {
  await map.getByRole('button', { name: '목록', exact: true }).click()
}

// ── E14 이미지 — e2e/e2eeAttachments.spec.js 와 같은 방식으로 브라우저가 실제로 디코드할 수 있는 PNG 를 만든다 ──

function crc32(buf) {
  const table = crc32.table ?? (crc32.table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  }))
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function decodablePngBytes(width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const rowBytes = width * 3 + 1
  const raw = Buffer.alloc(rowBytes * height, 0xc8)
  for (let y = 0; y < height; y++) raw[y * rowBytes] = 0
  const idat = zlib.deflateSync(raw)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return Array.from(png)
}

async function pasteFiles(page, { targetSelector = '.cm-content', files }) {
  await page.evaluate(
    ({ targetSelector, files }) => {
      const dt = new DataTransfer()
      for (const f of files) {
        dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.mime }))
      }
      const el = document.querySelector(targetSelector)
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    },
    { targetSelector, files },
  )
}

async function pasteImage(page, bytes) {
  await page.locator('.cm-content').click()
  await pasteFiles(page, { files: [{ bytes, name: 'a.png', mime: 'image/png' }] })
  await expect(page.locator('.md-image-img')).toBeVisible()
}

test.describe('F-409 검색', () => {
  test('F-409 E1 열린 채 검색 — 잠그면 결과가 사라지고 안내가 뜬다, 빈 검색어는 안내 없음', async ({ page }) => {
    await setupDocs(page)

    // '비밀' 만으로는 `일반 문서` 본문의 [[비밀 제목]] 도 걸려 금고 문서만 걸리는 '비밀 본문' 으로 찾는다
    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('비밀 본문')
    await page.waitForTimeout(300)
    await expect(page.getByRole('option')).toHaveCount(1)
    await expect(page.locator('dialog[open] .search-note', { hasText: '금고가 잠겨' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)

    await lockVault(page)

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('비밀 본문')
    await page.waitForTimeout(300)
    await expect(page.getByText('찾는 문서가 없습니다')).toBeVisible()
    await expect(page.locator('dialog[open] .search-note')).toContainText('금고가 잠겨 있어 금고 문서 1개는 찾지 않았습니다')

    await page.locator('.search-input').fill('')
    await page.waitForTimeout(300)
    await expect(page.locator('dialog[open] .search-note', { hasText: '금고가 잠겨' })).toHaveCount(0)
  })

  test('F-409 E2 검색 대화상자를 연 채 자동 잠금 — 열린 채 결과가 사라지고 검색어는 남는다, 다시 열면 다시 찾는다', async ({ page }) => {
    await page.clock.install()
    const { secretId } = await setupDocs(page)

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('비밀 본문')
    await page.clock.runFor(300)
    await expect(page.getByRole('option')).toHaveCount(1)

    await page.clock.fastForward('30:30')

    await expect(page.locator('dialog[open] .search-dialog')).toBeVisible()
    await expect(page.getByRole('option')).toHaveCount(0)
    await expect(page.getByText('찾는 문서가 없습니다')).toBeVisible()
    await expect(page.locator('dialog[open] .search-note')).toContainText('금고가 잠겨 있어 금고 문서 1개는 찾지 않았습니다')
    await expect(page.locator('.search-input')).toHaveValue('비밀 본문')

    await page.keyboard.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)

    await gotoDoc(page, secretId)
    await expect(page.locator('.e2ee-locked-panel')).toBeVisible()
    await unlockVia(page.locator('.e2ee-locked-panel'))
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('비밀 본문')
    await page.clock.runFor(300)
    await expect(page.getByRole('option')).toHaveCount(1)
  })
})

test.describe('F-409 지도', () => {
  test('F-409 E3 지도(목록) — 열림엔 목록에, 연 채 잠그면 끊긴 링크로 바뀌고 발에 안내가 뜬다', async ({ page }) => {
    await setupDocs(page)

    const map = await openMap(page)
    await showList(map)
    await expect(map.locator('.map-list-group h2', { hasText: '끊긴 링크 (0)' })).toBeVisible()
    await expect(map.getByRole('button', { name: '비밀 제목', exact: true })).toBeVisible()

    await lockVaultViaPalette(page)

    await expect(map.locator('.map-page-foot')).toContainText('금고가 잠겨 있어 금고 문서 1개는 지도에 넣지 않았습니다.')
    await expect(map.locator('.map-page-foot')).not.toContainText('공유받은 문서')
    await expect(map.locator('.map-list-group h2', { hasText: '끊긴 링크 (1)' })).toBeVisible()
    await expect(map.getByRole('button', { name: '비밀 제목', exact: true })).toBeVisible()
  })
})

test.describe('F-409 잠근 뒤 평문 흔적', () => {
  test('F-409 E4 검색·지도를 한 번씩 연 뒤 잠그면 page.content() 에 평문이 없다', async ({ page }) => {
    await setupDocs(page)

    await page.keyboard.press('Control+Shift+F')
    await page.locator('.search-input').fill('비밀')
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    await expect(page.locator('dialog[open]')).toHaveCount(0)

    const map = await openMap(page)
    await showList(map)
    await map.getByRole('button', { name: '닫기', exact: true }).click()
    await expect(page.locator('.map-page')).toHaveCount(0)

    await lockVault(page)

    // '비밀 제목' 은 뺀다 — 일반 문서 자신이 손으로 친 [[비밀 제목]] 이 잠근 뒤에도 끊긴 링크 글자로 보인다(E5, 유출이 아니다)
    const html = await page.content()
    expect(html).not.toContain('비밀 본문')
  })
})

test.describe('F-409 위키링크', () => {
  test('F-409 E5 일반 문서의 손으로 친 [[비밀 제목]] — 열림은 이어지고 잠금은 끊긴다', async ({ page }) => {
    await setupDocs(page)
    // 커서가 링크 위(닿음)면 원문(괄호 보임)으로 펼쳐진다(F-129) — 줄 끝으로 옮겨 놓고 본다
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')

    await expect(page.locator('.md-wikilink')).not.toHaveClass(/--missing/)
    await setViewMode(page, 'view')
    await expect(page.locator('.wikilink')).not.toHaveClass(/--missing/)
    await setViewMode(page, 'live')
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')

    await lockVault(page)

    await expect(page.locator('.md-wikilink')).toHaveClass(/--missing/)
    await setViewMode(page, 'view')
    await expect(page.locator('.wikilink')).toHaveClass(/--missing/)
  })
})

test.describe('F-409 자동완성', () => {
  test('F-409 E13 [[ 자동완성 — 일반 문서는 금고 제목을 안 띄우고, 금고 문서 안에서는 둘 다 띄운다', async ({ page }) => {
    const { secretId } = await setupDocs(page)

    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('[[비밀')
    await page.waitForTimeout(300)
    await expect(page.locator('.cm-tooltip-autocomplete')).toHaveCount(0)

    await gotoDoc(page, secretId)
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' [[일반')
    await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('일반 문서')
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+End')
    await page.keyboard.type(' [[비밀')
    await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('비밀 제목')
  })
})

test.describe('F-409 내보내기', () => {
  test('F-409 E14 일반 문서에 복사해 넣은 금고 이미지 줄 — 금고 폴더 자리에만 들어가고 이미지 누락으로 센다', async ({ page }) => {
    const { secretId, plainId } = await setupDocs(page)

    await gotoDoc(page, secretId)
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await pasteImage(page, decodablePngBytes(20, 20))
    await waitSaved(page)
    await setViewMode(page, 'raw')
    const rawText = await page.locator('.cm-content').innerText()
    const match = /attachments\/([0-9a-f]{16})\.(png|webp)/.exec(rawText)
    expect(match).not.toBeNull()
    const [imgLine, id, ext] = match
    await setViewMode(page, 'live')

    await gotoDoc(page, plainId)
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(`\n${imgLine}`)
    await waitSaved(page)

    const dialog = await openSettings(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: '전체 내보내기' }).click(),
    ])
    await expect(page.locator('.notice-message')).toHaveText('이미지 1개를 찾을 수 없어 빼고 내보냈습니다.')

    const unzipped = await unzipDownload(download)
    const names = Object.keys(unzipped)
    expect(names).toContain(`${VAULT_FOLDER}/attachments/${id}.${ext}`)
    expect(names).not.toContain(`attachments/${id}.${ext}`)
  })

  test('F-409 E6 잠긴 채 전체 내보내기 — 빼고 알린다', async ({ page }) => {
    await setupDocs(page)
    await lockVault(page)

    const dialog = await openSettings(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: '전체 내보내기' }).click(),
    ])
    await expect(page.locator('.notice-message')).toHaveText('금고가 잠겨 있어 금고 문서 1개는 빼고 내보냈습니다.')

    const unzipped = await unzipDownload(download)
    const names = Object.keys(unzipped)
    expect(names).not.toContain(`${VAULT_FOLDER}/비밀 제목.md`)
    expect(names).toContain('일반 문서.md')
    const manifest = JSON.parse(Buffer.from(unzipped['manifest.json']).toString('utf-8'))
    expect(manifest.docs.some((d) => d.title === '비밀 제목')).toBe(false)
  })

  test('F-409 E7 열린 채 전체 내보내기 — 평문으로 들어간다', async ({ page }) => {
    await setupDocs(page)

    const dialog = await openSettings(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: '전체 내보내기' }).click(),
    ])
    await expect(page.locator('.notice-message')).toHaveText('문서 2개를 내보냈습니다.')

    const unzipped = await unzipDownload(download)
    const body = Buffer.from(unzipped[`${VAULT_FOLDER}/비밀 제목.md`]).toString('utf-8')
    expect(body).toContain('비밀 본문 한 줄')
  })

  test('F-409 E8a 잠긴 채 금고 폴더 ⋯ → 폴더 내보내기 — D-11, 취소는 아무것도 안 하고 열면 내려받는다', async ({ page }) => {
    await setupDocs(page)
    await lockVault(page)

    const menu1 = await openRowMenu(page, VAULT_FOLDER)
    await menu1.getByRole('menuitem', { name: '폴더 내보내기', exact: true }).click()
    await expect(unlockDialog(page)).toBeVisible()
    const raced = await Promise.race([
      page.waitForEvent('download').then(() => 'download'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 1000)),
    ])
    expect(raced).toBe('timeout')
    await page.keyboard.press('Escape')
    await expect(unlockDialog(page)).toBeHidden()
    await expect(page.locator('.notice-message')).toHaveCount(0)

    const menu2 = await openRowMenu(page, VAULT_FOLDER)
    const downloadPromise = page.waitForEvent('download')
    await menu2.getByRole('menuitem', { name: '폴더 내보내기', exact: true }).click()
    await expect(unlockDialog(page)).toBeVisible()
    await unlockVia(unlockDialog(page))
    await expect(unlockDialog(page)).toBeHidden()
    const download = await downloadPromise

    const unzipped = await unzipDownload(download)
    expect(Object.keys(unzipped)).toContain('비밀 제목.md')
  })

  test('F-409 E8b 잠긴 채 금고 폴더 ⋯ → 옵시디언 볼트로 내보내기 — D-11, 취소는 아무것도 안 하고 열면 내려받는다', async ({ page }) => {
    await setupDocs(page)
    await lockVault(page)

    const menu1 = await openRowMenu(page, VAULT_FOLDER)
    await menu1.getByRole('menuitem', { name: '옵시디언 볼트로 내보내기', exact: true }).click()
    await expect(unlockDialog(page)).toBeVisible()
    const raced = await Promise.race([
      page.waitForEvent('download').then(() => 'download'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 1000)),
    ])
    expect(raced).toBe('timeout')
    await page.keyboard.press('Escape')
    await expect(unlockDialog(page)).toBeHidden()
    await expect(page.locator('.notice-message')).toHaveCount(0)

    const menu2 = await openRowMenu(page, VAULT_FOLDER)
    const downloadPromise = page.waitForEvent('download')
    await menu2.getByRole('menuitem', { name: '옵시디언 볼트로 내보내기', exact: true }).click()
    await expect(unlockDialog(page)).toBeVisible()
    await unlockVia(unlockDialog(page))
    await expect(unlockDialog(page)).toBeHidden()
    const download = await downloadPromise

    const unzipped = await unzipDownload(download)
    expect(Object.keys(unzipped)).toContain('비밀 제목.md')
  })

  test('F-409 E12 열린 금고 문서 — .md·HTML 파일 내보내기 둘 다 내려받고 .md 본문은 평문', async ({ page }) => {
    const { secretId } = await setupDocs(page)
    await gotoDoc(page, secretId)
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()

    await openExportMenu(page)
    const [mdDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: '.md', exact: true }).click(),
    ])
    const mdText = await readDownloadText(mdDownload)
    expect(mdText).toContain('비밀 본문 한 줄')

    await openExportMenu(page)
    const [htmlDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'HTML 파일', exact: true }).click(),
    ])
    expect(htmlDownload.suggestedFilename()).toBeTruthy()
  })
})

test.describe('F-409 공유 메뉴', () => {
  test('F-409 E9 가짜 서버 — 열린 금고 문서는 링크·초대가 비활성, 일반 문서는 그대로', async ({ page }) => {
    const requests = []
    page.on('request', (req) => {
      const url = new URL(req.url())
      if (!/\/link$/.test(url.pathname)) return
      requests.push({ method: req.method(), path: url.pathname })
    })

    const server = await fakeServer(page)
    const now = Date.now()
    server.folders.set('vf1', { id: 'vf1', name: VAULT_FOLDER, parentId: null, createdAt: now, updatedAt: now, e2ee: true })

    await openApp(page)
    const normalDocId = await currentDocId(page)
    await createVault(page)
    await newVaultDoc(page, VAULT_FOLDER)
    await writeTitleAndBody(page, '비밀 제목', '비밀 본문')
    await waitSaved(page)

    requests.length = 0
    await page.getByRole('button', { name: SHARE_BUTTON_LABEL }).click()
    const menu = page.locator('.share-menu-list[data-state="open"]')
    await expect(menu.getByRole('menuitem', { name: '링크 복사', exact: true })).toHaveAttribute('aria-disabled', 'true')
    await expect(menu.getByRole('menuitem', { name: '읽기 전용 링크 복사', exact: true })).toHaveAttribute('aria-disabled', 'true')
    await expect(menu.getByRole('menuitem', { name: '사람 초대…', exact: true })).toHaveAttribute('aria-disabled', 'true')
    await expect(menu.getByRole('menuitem', { name: '마크다운 복사', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
    await expect(menu.getByRole('menuitem', { name: '읽기 전용 링크 끊기', exact: true })).toHaveCount(0)
    await expect(menu.locator('.share-menu-note')).toHaveText('금고 문서는 공유할 수 없습니다.')
    expect(requests.filter((r) => r.method === 'GET')).toHaveLength(0)

    // aria-disabled 는 Playwright 의 "enabled" 판정에 걸려 보통 click() 이 기다리며 막힌다 — force 로 실제 클릭만 보낸다
    await menu.getByRole('menuitem', { name: '읽기 전용 링크 복사', exact: true }).click({ force: true })
    await expect(page.locator('.share-menu-list[data-state="open"]')).toBeVisible()
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0)

    await page.keyboard.press('Escape')
    await gotoDoc(page, normalDocId)
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    await page.getByRole('button', { name: SHARE_BUTTON_LABEL }).click()
    const menu2 = page.locator('.share-menu-list[data-state="open"]')
    await expect(menu2.getByRole('menuitem', { name: '링크 복사', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
    await expect(menu2.locator('.share-menu-note')).toHaveCount(0)
  })
})

test.describe('F-409 잠긴 금고 문서를 연 상태', () => {
  test('F-409 E10 P1 — 상단바 공유·내보내기 버튼이 비활성, 팔레트에 인쇄가 없다', async ({ page }) => {
    const { secretId } = await setupDocs(page)
    await lockVault(page)
    await gotoDoc(page, secretId)
    const panel = page.locator('.e2ee-locked-panel')
    await expect(panel).toBeVisible()
    await panel.getByRole('heading').click()

    await expect(page.getByRole('button', { name: SHARE_BUTTON_LABEL })).toBeDisabled()
    await expect(page.getByRole('button', { name: EXPORT_BUTTON_LABEL, exact: true })).toBeDisabled()

    await page.keyboard.press('Control+p')
    await expect(page.locator('dialog[open] .command-palette')).toBeVisible()
    await expect(page.getByRole('option', { name: 'PDF (A4 인쇄)' })).toHaveCount(0)
  })
})

test.describe('F-409 홈 화면', () => {
  test('F-409 E11 잠긴 채 홈 — 최근 문서에 잠긴 문서, 누르면 P1', async ({ page }) => {
    await setupDocs(page)
    await lockVault(page)

    await page.getByRole('button', { name: `${brand.name} 홈으로` }).click()
    await expect(page.locator('.empty-state')).toBeVisible()
    const lockedItem = page.locator('.empty-state-recent-item').filter({ hasText: '잠긴 문서' })
    await expect(lockedItem).toBeVisible()
    await lockedItem.click()

    await expect(page.locator('.e2ee-locked-panel')).toBeVisible()
  })
})
