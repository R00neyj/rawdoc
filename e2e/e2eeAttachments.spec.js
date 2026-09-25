// 금고 첨부 — 암호 올리기·복호화 표시·잠글 때 거두기 (specs/features/F-406.md 7.2) — 금고는 F-404 화면, 금고 폴더는 F-405 9.2 와 같이 준비한다
import { test, expect } from '@playwright/test'
import zlib from 'node:zlib'
import { openApp as openAppRaw, setPrefBeforeLoad, currentDocId, importMarkdown, setViewMode } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const SETTINGS_DIALOG_SELECTOR = 'dialog[aria-labelledby="settings-title"]'
const PASSWORD = '충분히긴금고암호입니다'
const VAULT_FOLDER = '비밀함'
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const RIFF_BYTES = [0x52, 0x49, 0x46, 0x46]

// 저장 공간 보호 알림(F-118)이 금고 알림과 한 자리를 두고 경쟁하지 않게 미리 꺼 둔다
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

function lockedPanel(page) {
  return page.locator('.e2ee-locked-panel')
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

// 금고 폴더 `⋯` → 새 문서 — 금고가 열려 있으면 곧장 새 문서가 열린다
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

// 로컬 폴더 행에 e2ee: true 를 넣는다 — 금고 폴더를 만드는 화면은 F-407 몫
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

// 로컬: 금고 만들기 → 폴더를 금고 폴더로 → 새로고침(잠김)
async function setupLocalVaultFolder(page) {
  await openApp(page)
  await createVault(page)
  await newFolder(page, VAULT_FOLDER)
  const folderId = await folderIdOf(page, VAULT_FOLDER)
  await markLocalFolderE2ee(page, folderId)
  await page.reload()
  await waitBooted(page)
  return folderId
}

async function unlockVia(container) {
  await container.locator('input[type="password"]').fill(PASSWORD)
  await container.getByRole('button', { name: '열기', exact: true }).click()
}

// 로컬 금고 문서 하나를 만들어 연다(제목·본문은 비워 둔다 — 이 파일은 첨부만 본다)
async function openLocalVaultDoc(page) {
  await setupLocalVaultFolder(page)
  await clickNewDocInFolder(page, VAULT_FOLDER)
  await unlockVia(unlockDialog(page))
  await expect(unlockDialog(page)).toBeHidden()
  await expect(page.locator('.doc-title')).toBeFocused()
  return currentDocId(page)
}

// 서버: 가짜 서버 md-docs 폴더 맵에 금고 폴더를 직접 넣는다 (F-405 9.2 와 같은 방식)
function seedVaultFolder(server, id = 'vf1') {
  const now = Date.now()
  server.folders.set(id, { id, name: VAULT_FOLDER, parentId: null, createdAt: now, updatedAt: now, e2ee: true })
  return id
}

// 요청 몸통(JSON) + 첨부 PUT 의 원 바이트를 모은다 — GET 은 뺀다(첨부 GET 은 collectAttachmentGets 가 본다)
function collectRequests(page) {
  const list = []
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (!url.pathname.startsWith('/api/')) return
    if (req.method() === 'GET') return
    let body
    try {
      body = req.postDataJSON()
    } catch {
      body = undefined
    }
    let bodyBytes
    if (url.pathname.startsWith('/api/attachments/')) {
      const buf = req.postDataBuffer()
      bodyBytes = buf ? Array.from(buf) : undefined
    }
    list.push({ method: req.method(), path: url.pathname, search: url.search, body, bodyBytes })
  })
  return list
}

// 첨부 GET 요청만 따로 모은다(E5 — 다른 기기 흉내)
function collectAttachmentGets(page) {
  const list = []
  page.on('request', (req) => {
    if (req.method() !== 'GET') return
    const url = new URL(req.url())
    if (!url.pathname.startsWith('/api/attachments/')) return
    list.push({ path: url.pathname, search: url.search })
  })
  return list
}

// md-remote attachments 캐시에서 id 로 찾아 지운다(다른 기기에는 이 캐시가 없는 상황을 흉내)
async function deleteRemoteAttachment(page, id) {
  await page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-remote')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('attachments')) {
            db.close()
            return resolve()
          }
          const tx = db.transaction('attachments', 'readwrite')
          const store = tx.objectStore('attachments')
          const cursorReq = store.openCursor()
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result
            if (!cursor) return
            if (cursor.value.id === id) cursor.delete()
            cursor.continue()
          }
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    id,
  )
}

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

// 브라우저가 실제로 디코드할 수 있는 완전한 PNG(naturalWidth 확인용) — e2e/image.spec.js 와 같은 방식
function decodablePngBytes(width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  const rowBytes = width * 3 + 1
  const raw = Buffer.alloc(rowBytes * height, 0xc8)
  for (let y = 0; y < height; y++) raw[y * rowBytes] = 0 // 필터 없음
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

// md-docs attachments 행을 모두 읽는다(blob 은 바이트 배열로 바꿔서)
async function readAttachmentRows(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('attachments', 'readonly')
          const getAllReq = tx.objectStore('attachments').getAll()
          getAllReq.onsuccess = async () => {
            const rows = getAllReq.result
            const out = []
            for (const r of rows) {
              const buf = await r.blob.arrayBuffer()
              out.push({ id: r.id, ext: r.ext, mime: r.mime, e2ee: r.e2ee ?? false, bytes: Array.from(new Uint8Array(buf)) })
            }
            resolve(out)
          }
          getAllReq.onerror = () => reject(getAllReq.error)
        }
      }),
  )
}

async function fetchRejects(page, url) {
  return page.evaluate((url) => fetch(url).then(() => false).catch(() => true), url)
}

test.describe('F-406 로컬 금고 첨부', () => {
  test('F-406 E1·E2·E3 올리면 봉투로 저장, 새로고침 뒤 다시 열어도 보이고, 잠그면 사라지고 주소가 거부된다', async ({ page }) => {
    await openLocalVaultDoc(page)
    await pasteImage(page, decodablePngBytes(200, 100))

    const img = page.locator('.md-image-img')
    expect(await img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0)
    const src = await img.getAttribute('src')
    expect(src.startsWith('blob:')).toBe(true)

    await expect(page.locator('.statusbar-save')).toContainText('저장됨')
    const rows = await readAttachmentRows(page)
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row.e2ee).toBe(true)
    expect(row.bytes[0]).toBe(1)
    expect(row.bytes.slice(0, 8)).not.toEqual(PNG_SIGNATURE)
    expect(row.bytes.slice(0, 4)).not.toEqual(RIFF_BYTES)

    // 원문 모드로 바꿔도 attachments/{id}.{ext} 줄이 그대로 보인다 — 장식이 원문을 바꾸지 않는다
    await setViewMode(page, 'raw')
    const rawText = await page.locator('.cm-content').innerText()
    const match = new RegExp(`attachments/${row.id}\\.(png|webp)`).exec(rawText)
    expect(match).not.toBeNull()

    // E2 — 새로고침 → 잠긴 문서 패널에서 금고를 열면 같은 이미지가 다시 뜬다 (라이브 모드로 되돌려야 위젯이 보인다)
    await setViewMode(page, 'live')
    await expect(page.locator('.md-image-img')).toBeVisible()
    await page.reload()
    await waitBooted(page)
    await unlockVia(lockedPanel(page))
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    // 커서가 이미지 블록 범위 안(문서를 열면 기본 1행 1열)이면 원문 그대로 보인다 — 블록 밖으로 옮긴다(F-157 2.1 커서 규칙)
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    const img2 = page.locator('.md-image-img')
    await expect(img2).toBeVisible()
    await expect.poll(() => img2.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0)
    const src2 = await img2.getAttribute('src')

    // E3 — 상태바로 잠그면 이미지가 사라지고, 적어 둔 주소는 fetch 가 거부된다
    await page.locator('.statusbar-e2ee').click()
    await expect(page.locator('.md-image-img')).toHaveCount(0)
    expect(await fetchRejects(page, src2)).toBe(true)
  })

  test('F-406 E7 금고 문서를 떠나면(사이드바에서 다른 문서를 엶) 그 주소는 거둬진다', async ({ page }) => {
    await setupLocalVaultFolder(page)
    const plainId = await importMarkdown(page, { name: '다른문서.md', content: '# 다른 문서\n\n본문\n' })

    await clickNewDocInFolder(page, VAULT_FOLDER)
    await unlockVia(unlockDialog(page))
    await expect(unlockDialog(page)).toBeHidden()
    await pasteImage(page, decodablePngBytes(80, 60))
    const src = await page.locator('.md-image-img').getAttribute('src')

    await docLink(page, plainId).click()
    await expect.poll(() => currentDocId(page)).toBe(plainId)
    expect(await fetchRejects(page, src)).toBe(true)
  })

  test('F-406 E8 보기 모드에도 이미지가 뜨고, 잠그면 그 주소는 거둬진다', async ({ page }) => {
    await openLocalVaultDoc(page)
    await pasteImage(page, decodablePngBytes(80, 60))

    await setViewMode(page, 'view')
    const viewImg = page.locator('.content-area .viewer img[data-attachment]')
    await expect(viewImg).toBeVisible()
    const src = await viewImg.getAttribute('src')

    await page.locator('.statusbar-e2ee').click()
    await expect(lockedPanel(page)).toBeVisible()
    expect(await fetchRejects(page, src)).toBe(true)
  })
})

test.describe('F-406 서버 금고 첨부', () => {
  test('F-406 E4·E5·E6 서버에는 e2ee 봉투로 PUT, 다른 기기에서도 힌트로 받고, 일반 문서에는 새지 않는다', async ({ page }) => {
    const server = await fakeServer(page)
    seedVaultFolder(server)
    const requests = collectRequests(page)
    const attGets = collectAttachmentGets(page)
    await openApp(page)
    await createVault(page)
    const vaultDocId = await newVaultDoc(page)

    await pasteImage(page, decodablePngBytes(200, 100))
    await expect.poll(() => requests.filter((r) => r.method === 'PUT' && r.path.startsWith('/api/attachments/')).length).toBe(1)
    const put = requests.find((r) => r.method === 'PUT' && r.path.startsWith('/api/attachments/'))
    const m = /^\/api\/attachments\/([0-9a-f]{16})\.(png|jpg|gif|webp)$/.exec(put.path)
    expect(m).not.toBeNull()
    const [, attId, ext] = m
    const search = new URLSearchParams(put.search)
    expect(search.get('e2ee')).toBe('1')
    const w = Number(search.get('w'))
    const h = Number(search.get('h'))
    expect(Number.isInteger(w)).toBe(true)
    expect(w).toBeGreaterThanOrEqual(1)
    expect(Number.isInteger(h)).toBe(true)
    expect(h).toBeGreaterThanOrEqual(1)
    expect(put.bodyBytes[0]).toBe(1)
    expect(put.bodyBytes.slice(0, 8)).not.toEqual(PNG_SIGNATURE)

    const record = server.attachments.get(`${attId}.${ext}`)
    expect(record.e2ee).toBe(true)
    await expect(page.locator('.md-image-img')).toBeVisible()
    await expect(page.locator('.statusbar-save')).toContainText('저장됨')

    // E5 — 다른 기기 흉내: 로컬 캐시(md-remote attachments) 행을 지우고 새로고침 → 금고 열기 → 힌트로 GET 한 번
    await deleteRemoteAttachment(page, attId)
    await page.reload()
    await waitBooted(page)
    await unlockVia(lockedPanel(page))
    await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
    // 커서가 이미지 블록 범위 안(문서를 열면 기본 1행 1열)이면 원문 그대로 보인다 — 블록 밖으로 옮긴다(F-157 2.1 커서 규칙)
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')

    await expect.poll(() => attGets.filter((g) => g.path === `/api/attachments/${attId}.${ext}`).length).toBe(1)
    expect(attGets.find((g) => g.path === `/api/attachments/${attId}.${ext}`).search).not.toContain('doc=')
    const img = page.locator('.md-image-img')
    await expect(img).toBeVisible()
    await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0)

    // E6 — 금고가 열린 채로 일반 문서에 같은 이미지를 넣으면 자리 표시만 뜬다(F-157 A8 과 같은 방식). 새 문서는 지금 연 문서의 폴더로 들어가므로 루트 문서(사용법)로 먼저 옮긴다
    await page.locator('.sidebar').getByRole('tree').getByRole('link', { name: '사용법', exact: true }).click()
    await expect.poll(() => currentDocId(page)).not.toBe(vaultDocId)
    const plainId = await importMarkdown(page, {
      name: '일반.md',
      content: `본문\n\n<div align="center">\n  <img src="attachments/${attId}.${ext}" alt="없음" width="100">\n</div>\n`,
    })
    // 정말로 금고 밖(자물쇠 없음)에 생겼는지 먼저 확인
    await expect(docRow(page, plainId).locator('.tree-e2ee-icon')).toHaveCount(0)
    // 커서가 블록 범위 밖에 있어야 자리 표시가 보인다(F-157 A8 과 같은 방식)
    await page.locator('.cm-content .cm-line', { hasText: '본문' }).click()
    await expect(page.locator('.md-image-missing-text')).toHaveText('이미지를 찾을 수 없습니다')
    expect(await page.locator('.md-image-img').count()).toBe(0)
  })
})
