// 금고로 옮기기·빼기 — 메뉴·D-9·D-10·진행 알림·쓰기 순서 (specs/features/F-407.md 9.2) — 금고는 F-404 화면, 서버는 fakeServer, 실시간은 fakeDocRoom
import { test, expect } from '@playwright/test'
import zlib from 'node:zlib'
import { openApp as openAppRaw, setPrefBeforeLoad, currentDocId, importMarkdown, setViewMode } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { createFakeDocRoom } from './fixtures/fakeDocRoom.js'

const PASSWORD = '충분히긴금고암호입니다'
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/
const D9_SERVER_BODY = '을(를) 암호화해 금고에 넣습니다. 공유 링크와 초대는 끊깁니다. 다른 기기에서 열어 둔 편집 중 저장되지 않은 내용은 사라질 수 있습니다.'
const E5 = '금고로 옮기거나 빼려면 인터넷에 연결해야 합니다.'
const E6 = '문서가 너무 커서 금고에 넣을 수 없습니다(금고 문서는 약 750KB까지).'
const E42 = '금고 폴더 안의 문서는 폴더째 빼야 합니다. 폴더의 ⋯ 메뉴에서 금고에서 빼기…를 고르세요.'
const LIVE_GONE = '이 문서가 삭제되었거나 접근할 수 없게 되었습니다.'
const OUTBOX_RATE_NOTICE = '요청이 많아 잠시 쉬었다가 이어서 저장합니다.'

// 저장 공간 보호 알림(F-118)이 금고 알림과 한 자리를 두고 경쟁하지 않게 미리 꺼 둔다. 알림 글은 모두 기록한다(잠깐 뜬 것도 보려고)
async function openApp(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await recordNotices(page)
  await openAppRaw(page)
}

async function recordNotices(page) {
  await page.addInitScript(() => {
    const seen = []
    Object.defineProperty(window, 'e2eNoticeLog', { value: seen })
    const observe = () => {
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('.notice-message')) {
          const text = el.textContent ?? ''
          if (text && seen[seen.length - 1] !== text) seen.push(text)
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
    }
    if (document.body) observe()
    else document.addEventListener('DOMContentLoaded', observe)
  })
}

function noticeLog(page) {
  return page.evaluate(() => [...window.e2eNoticeLog])
}

function notice(page) {
  return page.locator('.notice:not([inert]) .notice-message')
}

function convertDialog(page) {
  return page.locator('dialog[open] .e2ee-convert-dialog')
}

function unlockDialog(page) {
  return page.locator('dialog[aria-labelledby="e2ee-unlock-title"]')
}

// D-8 금고 만들기 — 옮기기를 누르면 금고가 없을 때 뜬다
async function completeCreateVault(page) {
  const create = page.locator('dialog[aria-labelledby="e2ee-create-title"]')
  await expect(create).toBeVisible()
  await create.locator('input[aria-labelledby="e2ee-create-password-label"]').fill(PASSWORD)
  await create.locator('input[aria-labelledby="e2ee-create-confirm-label"]').fill(PASSWORD)
  await create.getByRole('button', { name: '다음' }).click()
  await create.getByLabel('복구 코드를 안전한 곳에 보관했습니다').check()
  await create.getByRole('button', { name: '금고 만들기' }).click()
  await expect(create).toBeHidden()
}

function folderRow(page, name) {
  return page.locator('.sidebar .tree-row').filter({ has: page.getByRole('button', { name, exact: true }) })
}

function docRow(page, id) {
  return page.locator('.sidebar .tree-row').filter({ has: page.locator(`a[href="#/d/${id}"]`) })
}

async function openMenuOf(page, row) {
  await row.hover()
  await row.locator('button[aria-label$=" 메뉴"]').click()
  return page.locator('.item-menu-list:not([inert])')
}

async function expandFolder(page, name) {
  const toggle = page.getByRole('button', { name: `${name} 펼치기`, exact: true })
  if (await toggle.count()) await toggle.click()
}

async function newFolder(page, name) {
  await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
  const input = page.locator('.tree-rename-input')
  await expect(input).toBeFocused()
  await input.fill(name)
  await input.press('Enter')
  await expect(folderRow(page, name)).toBeVisible()
}

function serverDoc(id, { title, content = '', folderId = null, updatedAt = Date.now() }) {
  return { id, title, content, lineEnding: 'lf', folderId, pinnedAt: null, version: 1, createdAt: updatedAt, updatedAt }
}

function serverFolder(id, name, parentId = null) {
  const now = Date.now()
  return { id, name, parentId, createdAt: now, updatedAt: now }
}

// 이 페이지가 보낸 GET 아닌 /api 요청 — 첨부 PUT·DELETE 는 가짜 서버 writeRequests 에 없으므로 여기서 본다
function collectRequests(page) {
  const list = []
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (!url.pathname.startsWith('/api/') || req.method() === 'GET') return
    let body
    try {
      body = req.postDataJSON()
    } catch {
      body = undefined
    }
    list.push({ method: req.method(), path: url.pathname, search: url.search, body })
  })
  return list
}

function isConvertWrite(r) {
  return (
    (r.method === 'PUT' && /^\/api\/docs\/[^/]+\/e2ee$/.test(r.path)) ||
    (r.method === 'PUT' && /^\/api\/folders\/[^/]+$/.test(r.path) && r.body && typeof r.body.e2ee === 'boolean') ||
    /^\/api\/attachments\//.test(r.path)
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

// 브라우저가 실제로 디코드할 수 있는 PNG (e2eeAttachments.spec.js 와 같은 방식)
function decodablePng(width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const rowBytes = width * 3 + 1
  const raw = Buffer.alloc(rowBytes * height, 0xc8)
  for (let y = 0; y < height; y++) raw[y * rowBytes] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

async function pasteImage(page, bytes) {
  await page.locator('.cm-content').first().click()
  await page.evaluate((bytes) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], 'a.png', { type: 'image/png' }))
    document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  }, Array.from(bytes))
  await expect(page.locator('.md-image-img')).toBeVisible()
}

function readIdb(page, dbName, storeName, key) {
  return page.evaluate(
    ({ dbName, storeName, key }) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction(storeName, 'readonly')
          const r = key === null ? tx.objectStore(storeName).getAll() : tx.objectStore(storeName).get(key)
          r.onsuccess = () => {
            db.close()
            resolve(r.result ?? null)
          }
          r.onerror = () => reject(r.error)
        }
      }),
    { dbName, storeName, key },
  )
}

// 서버 저장소 첫 화면 — 새 문서(루트)가 열린 채로 둔다. 심은 문서는 사이드바에서만 다룬다
async function openServerApp(page, seed) {
  const server = await fakeServer(page)
  for (const f of seed.folders ?? []) server.folders.set(f.id, f)
  for (const d of seed.docs ?? []) server.docs.set(d.id, d)
  for (const [key, a] of Object.entries(seed.attachments ?? {})) server.attachments.set(key, a)
  const requests = collectRequests(page)
  await openApp(page)
  return { server, requests }
}

async function convertFromMenu(page, row, label = '금고로 옮기기…') {
  const menu = await openMenuOf(page, row)
  await menu.getByRole('menuitem', { name: label, exact: true }).click()
  await expect(convertDialog(page)).toBeVisible()
}

test.describe('F-407 로컬 금고로 옮기기', () => {
  test('F-407 E1 문서 옮기기 — 로컬 D-9, 첫 초점 취소, D-8 뒤 끝 알림·자물쇠·봉투 행', async ({ page }) => {
    await openApp(page)
    const id = await importMarkdown(page, { name: '옮길 메모.md', content: '# 제목\n\n비밀 본문\n' })
    await convertFromMenu(page, docRow(page, id))
    const dialog = convertDialog(page)
    await expect(dialog.locator('h2')).toHaveText('금고로 옮기기')
    await expect(dialog).toContainText('이 브라우저의 금고')
    await expect(dialog.locator('.e2ee-backup-notice')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '취소', exact: true })).toBeFocused()

    await dialog.getByRole('button', { name: '옮기기', exact: true }).click()
    await completeCreateVault(page)
    await expect(notice(page)).toHaveText('"옮길 메모"을(를) 금고로 옮겼습니다.')
    await expect(docRow(page, id).locator('.tree-e2ee-icon')).toBeVisible()

    const row = await readIdb(page, 'md-docs', 'docs', id)
    expect(row.title).toMatch(BASE64_RE)
    expect(row.content).toMatch(BASE64_RE)
    expect(row.content).not.toContain('비밀')
    expect(row.e2eeKey).toHaveLength(56)
  })

  test('F-407 E2 이미지 든 문서 — 새 암호 첨부 행, 옛 평문 행 없음, 줄의 id 만 바뀌고 이미지가 보인다', async ({ page }) => {
    await openApp(page)
    const id = await importMarkdown(page, { name: '그림.md', content: '그림 문서\n\n' })
    await page.locator('.cm-content .cm-line').last().click()
    await pasteImage(page, decodablePng(40, 20))
    await expect(page.locator('.statusbar-save')).toHaveText('저장됨', { timeout: 10_000 })
    const before = await readIdb(page, 'md-docs', 'attachments', null)
    expect(before).toHaveLength(1)
    const old = before[0]

    await convertFromMenu(page, docRow(page, id))
    await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
    await completeCreateVault(page)
    await expect(notice(page)).toHaveText('"그림"을(를) 금고로 옮겼습니다.')

    const after = await readIdb(page, 'md-docs', 'attachments', null)
    expect(after.map((a) => a.id)).not.toContain(old.id)
    expect(after).toHaveLength(1)
    expect(after[0].e2ee).toBe(true)
    expect(after[0].ext).toBe(old.ext)

    await setViewMode(page, 'raw')
    await expect(page.locator('.cm-content')).toContainText(`attachments/${after[0].id}.${old.ext}`)
    await expect(page.locator('.cm-content')).not.toContainText(old.id)
    await setViewMode(page, 'live')
    await page.locator('.cm-content .cm-line', { hasText: '그림 문서' }).click()
    const img = page.locator('.md-image-img')
    await expect(img).toBeVisible()
    await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0)
  })

  test('F-407 E9 로컬 저장소에서는 오프라인이어도 비활성이 아니다', async ({ page, context }) => {
    await openApp(page)
    const id = await importMarkdown(page, { name: '로컬.md', content: '본문\n' })
    await context.setOffline(true)
    const menu = await openMenuOf(page, docRow(page, id))
    await expect(menu.getByRole('menuitem', { name: '금고로 옮기기…', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
    await context.setOffline(false)
  })

  test('F-407 E10 너무 큰 문서 — 문서 메뉴 E6, 든 폴더 E33, D-9 없음', async ({ page }) => {
    await openApp(page)
    await newFolder(page, '큰 폴더')
    const menu = await openMenuOf(page, folderRow(page, '큰 폴더'))
    const before = await currentDocId(page)
    await menu.getByRole('menuitem', { name: '새 문서', exact: true }).click()
    await expect.poll(() => currentDocId(page)).not.toBe(before)
    const line = 'abcdefghijklmnopqrstuvwxyz0123456789AB'
    expect(line).toHaveLength(38)
    const id = await importMarkdown(page, { name: '큰 문서.md', content: `${line}\n`.repeat(20_000) })
    await expect(docRow(page, id)).toBeVisible()

    const docMenu = await openMenuOf(page, docRow(page, id))
    await docMenu.getByRole('menuitem', { name: '금고로 옮기기…', exact: true }).click()
    await expect(notice(page)).toHaveText(E6)
    await expect(convertDialog(page)).toHaveCount(0)

    const folderMenu = await openMenuOf(page, folderRow(page, '큰 폴더'))
    await folderMenu.getByRole('menuitem', { name: '금고로 옮기기…', exact: true }).click()
    await expect(notice(page)).toContainText('금고에 넣을 수 없는 문서가 1개 있어 폴더를 옮기지 않았습니다.')
    await expect(convertDialog(page)).toHaveCount(0)
  })
})

test.describe('F-407 서버 금고로 옮기기', () => {
  test('F-407 E3 서버 문서 — F-400 본문·백업 안내, PUT /e2ee 한 번, 두 번째 D-9 에는 백업 안내 없음', async ({ page }) => {
    const { requests } = await openServerApp(page, {
      docs: [serverDoc('sd1', { title: '서버 메모', content: '서버 본문\n' }), serverDoc('sd2', { title: '둘째 메모', content: '둘째\n' })],
    })
    await convertFromMenu(page, docRow(page, 'sd1'))
    const dialog = convertDialog(page)
    await expect(dialog).toContainText(`"서버 메모"${D9_SERVER_BODY}`)
    await expect(dialog.locator('.e2ee-backup-notice')).toBeVisible()
    await dialog.getByRole('button', { name: '옮기기', exact: true }).click()
    await completeCreateVault(page)
    await expect(notice(page)).toHaveText('"서버 메모"을(를) 금고로 옮겼습니다.')

    const puts = requests.filter((r) => r.method === 'PUT' && r.path === '/api/docs/sd1/e2ee')
    expect(puts).toHaveLength(1)
    expect(puts[0].body.e2eeKey).toHaveLength(56)
    expect(puts[0].body.title).toMatch(BASE64_RE)
    expect(puts[0].body.content).toMatch(BASE64_RE)
    expect(await page.evaluate(() => localStorage.getItem('md.e2eeBackupNotice'))).toBe('1')

    await convertFromMenu(page, docRow(page, 'sd2'))
    await expect(convertDialog(page).locator('.e2ee-backup-notice')).toHaveCount(0)
    await convertDialog(page).getByRole('button', { name: '취소', exact: true }).click()
  })

  test('F-407 E4 평문 이미지 — 암호 PUT → 문서 PUT(새 id 참조) → 옛 첨부 DELETE, 옛 첨부 upload 없음', async ({ page }) => {
    const oldId = '00000000000000a1'
    const png = decodablePng(20, 10)
    const { requests } = await openServerApp(page, {
      docs: [serverDoc('sd1', { title: '그림 메모', content: `그림\n\n![](attachments/${oldId}.png)\n` })],
      attachments: { [`${oldId}.png`]: { mime: 'image/png', bytes: png, width: 20, height: 10 } },
    })
    await convertFromMenu(page, docRow(page, 'sd1'))
    await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
    await completeCreateVault(page)
    await expect(notice(page)).toHaveText('"그림 메모"을(를) 금고로 옮겼습니다.')

    const writes = requests.filter(isConvertWrite)
    expect(writes.map((r) => `${r.method} ${r.path.replace(/[0-9a-f]{16}/, 'ID')}`)).toEqual([
      'PUT /api/attachments/ID.png',
      'PUT /api/docs/sd1/e2ee',
      'DELETE /api/attachments/ID.png',
    ])
    const newId = /([0-9a-f]{16})/.exec(writes[0].path)[1]
    expect(newId).not.toBe(oldId)
    expect(writes[0].search).toContain('e2ee=1')
    expect(writes[1].body.attachmentRefs).toEqual([newId])
    expect(writes[2].path).toBe(`/api/attachments/${oldId}.png`)
    expect(requests.filter((r) => r.method === 'PUT' && r.path === `/api/attachments/${oldId}.png`)).toHaveLength(0)
  })

  test('F-407 E11 빼기 — 잠근 뒤 D-11 먼저, D-10 에 진짜 제목, 평문 PUT → 문서 PUT(키 null) → 옛 암호 첨부 DELETE', async ({ page }) => {
    const oldId = '00000000000000b1'
    const png = decodablePng(20, 10)
    const { requests } = await openServerApp(page, {
      docs: [serverDoc('sd1', { title: '뺄 메모', content: `뺄 본문\n\n![](attachments/${oldId}.png)\n` })],
      attachments: { [`${oldId}.png`]: { mime: 'image/png', bytes: png, width: 20, height: 10 } },
    })
    await convertFromMenu(page, docRow(page, 'sd1'))
    await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
    await completeCreateVault(page)
    await expect(notice(page)).toHaveText('"뺄 메모"을(를) 금고로 옮겼습니다.')
    const vaultId = /([0-9a-f]{16})/.exec(requests.filter(isConvertWrite)[0].path)[1]

    await page.locator('.statusbar-e2ee').click()
    await expect(page.locator('.statusbar-e2ee')).toHaveCount(0)
    const writesBefore = requests.length

    const menu = await openMenuOf(page, docRow(page, 'sd1'))
    await menu.getByRole('menuitem', { name: '금고에서 빼기…', exact: true }).click()
    await expect(unlockDialog(page)).toBeVisible()
    await unlockDialog(page).locator('input[type="password"]').fill(PASSWORD)
    await unlockDialog(page).getByRole('button', { name: '열기', exact: true }).click()
    await expect(convertDialog(page)).toContainText('"뺄 메모"을(를) 복호화해 일반 문서로 저장합니다. 서버가 내용을 읽을 수 있게 됩니다.')
    await convertDialog(page).getByRole('button', { name: '빼기', exact: true }).click()
    await expect(notice(page)).toHaveText('"뺄 메모"을(를) 금고에서 뺐습니다.')

    const writes = requests.slice(writesBefore).filter(isConvertWrite)
    expect(writes.map((r) => `${r.method} ${r.path.replace(/[0-9a-f]{16}/, 'ID')}`)).toEqual([
      'PUT /api/attachments/ID.png',
      'PUT /api/docs/sd1/e2ee',
      'DELETE /api/attachments/ID.png',
    ])
    expect(writes[0].search).toBe('')
    expect(writes[1].body.e2eeKey).toBeNull()
    expect(writes[1].body.title).toBe('뺄 메모')
    expect(writes[1].body.content).toContain('뺄 본문')
    expect(writes[2].path).toBe(`/api/attachments/${vaultId}.png`)
    await expect(docRow(page, 'sd1').locator('.tree-e2ee-icon')).toHaveCount(0)
  })

  test('F-407 E5 폴더 — N1 문장, 깊은 폴더부터, 쓰기 사이 ≥ 550ms, 끝 알림', async ({ page }) => {
    const t = Date.now()
    const { server } = await openServerApp(page, {
      folders: [serverFolder('fa', '바깥'), serverFolder('fb', '안쪽', 'fa')],
      docs: [
        serverDoc('b1', { title: '안1', folderId: 'fb', updatedAt: t - 1000 }),
        serverDoc('b2', { title: '안2', folderId: 'fb', updatedAt: t - 2000 }),
        serverDoc('a1', { title: '밖1', folderId: 'fa', updatedAt: t - 3000 }),
      ],
    })
    await convertFromMenu(page, folderRow(page, '바깥'))
    await expect(convertDialog(page).locator('.e2ee-convert-note').first()).toHaveText('폴더 안 문서 3개와 하위 폴더 1개를 함께 옮깁니다.')
    await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
    await completeCreateVault(page)
    await expect(notice(page)).toHaveText('"바깥" 폴더를 금고로 옮겼습니다(문서 3개).', { timeout: 20_000 })

    const writes = server.writeRequests().filter((w) => /\/e2ee$/.test(w.path) || /^\/api\/folders\/[^/]+$/.test(w.path))
    expect(writes.map((w) => w.path)).toEqual([
      '/api/docs/b1/e2ee',
      '/api/docs/b2/e2ee',
      '/api/folders/fb',
      '/api/docs/a1/e2ee',
      '/api/folders/fa',
    ])
    for (let i = 1; i < writes.length; i++) expect(writes[i].at - writes[i - 1].at).toBeGreaterThanOrEqual(550)
    expect(server.folders.get('fa').e2ee).toBe(true)
    expect(server.folders.get('fb').e2ee).toBe(true)
  })

  test('F-407 E6 멈춤·이어 옮기기 — 둘째 PUT 500 에서 멈추고, 다시 누르면 남은 것만', async ({ page }) => {
    const t = Date.now()
    const { server } = await openServerApp(page, {
      folders: [serverFolder('fa', '바깥'), serverFolder('fb', '안쪽', 'fa')],
      docs: [
        serverDoc('b1', { title: '안1', folderId: 'fb', updatedAt: t - 1000 }),
        serverDoc('b2', { title: '안2', folderId: 'fb', updatedAt: t - 2000 }),
        serverDoc('a1', { title: '밖1', folderId: 'fa', updatedAt: t - 3000 }),
      ],
    })
    let e2eePuts = 0
    server.failWrites({ match: ({ method, path }) => method === 'PUT' && /\/e2ee$/.test(path) && ++e2eePuts === 2, status: 500, body: { error: 'internal' }, times: 1 })
    await convertFromMenu(page, folderRow(page, '바깥'))
    await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
    await completeCreateVault(page)
    await expect(notice(page)).toHaveText('1/3개를 옮기고 멈췄습니다. 다시 누르면 남은 것부터 이어 옮깁니다. 저장하지 못했습니다.', { timeout: 20_000 })

    await convertFromMenu(page, folderRow(page, '바깥'))
    await expect(convertDialog(page).locator('.e2ee-convert-note').first()).toHaveText('폴더 안 문서 2개와 하위 폴더 1개를 함께 옮깁니다.')
    await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
    await expect(notice(page)).toHaveText('"바깥" 폴더를 금고로 옮겼습니다(문서 2개).', { timeout: 20_000 })
    expect(server.folders.get('fa').e2ee).toBe(true)
    expect(server.folders.get('fb').e2ee).toBe(true)
    for (const id of ['a1', 'b1', 'b2']) expect(server.docs.get(id).e2eeKey).toHaveLength(56)
  })

  test('F-407 E7 429 minute — 진행 알림이 2초 쉬었다가 같은 PUT 을 다시 보내 끝낸다, outbox 쪽 알림 없음', async ({ page }) => {
    const { server } = await openServerApp(page, { docs: [serverDoc('sd1', { title: '느린 메모', content: '본문\n' })] })
    server.failWrites({
      match: ({ method, path }) => method === 'PUT' && /\/e2ee$/.test(path),
      status: 429,
      body: { error: 'rate_limited', scope: 'minute', limit: 120, retryAfter: 2 },
      headers: { 'Retry-After': '2' },
      times: 1,
    })
    await convertFromMenu(page, docRow(page, 'sd1'))
    await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
    await completeCreateVault(page)
    await expect(notice(page)).toHaveText('"느린 메모"을(를) 금고로 옮겼습니다.', { timeout: 15_000 })
    const log = await noticeLog(page)
    expect(log.some((m) => m.endsWith('요청이 많아 2초 쉬었다가 이어 갑니다.'))).toBe(true)
    expect(log).not.toContain(OUTBOX_RATE_NOTICE)
    expect(server.writeRequests().filter((w) => w.path === '/api/docs/sd1/e2ee')).toHaveLength(2)
  })

  test('F-407 E8 429 day — 멈춤 + R2, PUT 을 다시 보내지 않는다', async ({ page }) => {
    const { server } = await openServerApp(page, { docs: [serverDoc('sd1', { title: '한도 메모', content: '본문\n' })] })
    server.failWrites({
      match: ({ method, path }) => method === 'PUT' && /\/e2ee$/.test(path),
      status: 429,
      body: { error: 'rate_limited', scope: 'day', limit: 5000, retryAfter: 3600 },
      headers: { 'Retry-After': '3600' },
      times: 1,
    })
    await convertFromMenu(page, docRow(page, 'sd1'))
    await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
    await completeCreateVault(page)
    await expect(notice(page)).toContainText('0/1개를 옮기고 멈췄습니다. 다시 누르면 남은 것부터 이어 옮깁니다. 오늘 저장 한도에 닿았습니다.')
    await expect(notice(page)).toContainText('부터 다시 누를 수 있습니다.')
    await page.waitForTimeout(1500)
    expect(server.writeRequests().filter((w) => w.path === '/api/docs/sd1/e2ee')).toHaveLength(1)
  })

  test('F-407 E9 오프라인 — 항목 aria-disabled, 누르면 E5, D-9 없음', async ({ page, context }) => {
    const { server } = await openServerApp(page, { docs: [serverDoc('sd1', { title: '끊긴 메모', content: '본문\n' })] })
    await expect(docRow(page, 'sd1')).toBeVisible()
    server.setOffline(true)
    await context.setOffline(true)
    const menu = await openMenuOf(page, docRow(page, 'sd1'))
    const item = menu.getByRole('menuitem', { name: '금고로 옮기기…', exact: true })
    await expect(item).toHaveAttribute('aria-disabled', 'true')
    // aria-disabled 도 눌린다(F-407 3.4) — Playwright 는 aria-disabled 를 비활성으로 보고 기다리므로 강제로 누른다
    await item.click({ force: true })
    await expect(notice(page)).toHaveText(E5)
    await expect(convertDialog(page)).toHaveCount(0)
    await context.setOffline(false)
  })

  test('F-407 E12 폴더 빼기 — 바깥부터 끄고 문서들, 안쪽 폴더 메뉴엔 없음, 안쪽 문서는 비활성 + E42', async ({ page }) => {
    const t = Date.now()
    const { requests } = await openServerApp(page, {
      folders: [serverFolder('fa', '바깥'), serverFolder('fb', '안쪽', 'fa')],
      docs: [serverDoc('b1', { title: '안1', folderId: 'fb', updatedAt: t - 1000 }), serverDoc('a1', { title: '밖1', folderId: 'fa', updatedAt: t - 2000 })],
    })
    await convertFromMenu(page, folderRow(page, '바깥'))
    await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
    await completeCreateVault(page)
    await expect(notice(page)).toHaveText('"바깥" 폴더를 금고로 옮겼습니다(문서 2개).', { timeout: 20_000 })

    await expandFolder(page, '바깥')
    await expandFolder(page, '안쪽')
    const innerMenu = await openMenuOf(page, folderRow(page, '안쪽'))
    await expect(innerMenu.getByRole('menuitem', { name: '금고에서 빼기…', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    const docMenu = await openMenuOf(page, docRow(page, 'b1'))
    const disabledItem = docMenu.getByRole('menuitem', { name: '금고에서 빼기…', exact: true })
    await expect(disabledItem).toHaveAttribute('aria-disabled', 'true')
    await disabledItem.click({ force: true })
    await expect(notice(page)).toHaveText(E42)

    const before = requests.length
    await convertFromMenu(page, folderRow(page, '바깥'), '금고에서 빼기…')
    await convertDialog(page).getByRole('button', { name: '빼기', exact: true }).click()
    await expect(notice(page)).toHaveText('"바깥" 폴더를 금고에서 뺐습니다(문서 2개).', { timeout: 20_000 })
    const writes = requests.slice(before).filter(isConvertWrite)
    expect(writes.slice(0, 2).map((r) => [r.path, r.body.e2ee])).toEqual([
      ['/api/folders/fa', false],
      ['/api/folders/fb', false],
    ])
    expect(writes.slice(2).map((r) => r.path).sort()).toEqual(['/api/docs/a1/e2ee', '/api/docs/b1/e2ee'])
  })

  test('F-407 E14 멈추기 — 진행 알림의 멈추기, 그 뒤 PUT /e2ee 가 더 나가지 않는다', async ({ page }) => {
    const t = Date.now()
    const { server } = await openServerApp(page, {
      folders: [serverFolder('fa', '다섯')],
      docs: [1, 2, 3, 4, 5].map((n) => serverDoc(`d${n}`, { title: `문서${n}`, folderId: 'fa', updatedAt: t - n * 1000 })),
    })
    await convertFromMenu(page, folderRow(page, '다섯'))
    await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
    await completeCreateVault(page)
    await expect(notice(page)).toContainText('금고로 옮기는 중…')
    await page.locator('.notice:not([inert])').getByRole('button', { name: '멈추기', exact: true }).click()
    await expect(page.locator('.notice--info .notice-message')).toContainText('개를 옮기고 멈췄습니다. 다시 누르면 남은 것부터 이어 옮깁니다.')
    const count = server.writeRequests().filter((w) => /\/e2ee$/.test(w.path)).length
    expect(count).toBeLessThan(5)
    await page.waitForTimeout(1500)
    expect(server.writeRequests().filter((w) => /\/e2ee$/.test(w.path))).toHaveLength(count)
  })
})

test.describe('F-407 실시간 문서 옮기기', () => {
  test('F-407 E13 지금 열린 실시간 문서 — 친 글까지 봉투에 담기고, 사라짐 알림·새 소켓 없이 다시 열린다', async ({ page }) => {
    const room = createFakeDocRoom()
    const server = await fakeServer(page)
    await room.install(page.context())
    await page.route(/\/api\/docs\/[^/]+\/lock(\?.*)?$/, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ expiresAt: Date.now() + 60_000 }) })
        : route.fulfill({ status: 204 }),
    )
    const base = '첫 줄\n'
    server.docs.set('live1', serverDoc('live1', { title: '실시간 메모', content: base }))
    room.seed('live1', { title: '실시간 메모', content: base })
    const requests = collectRequests(page)
    await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await recordNotices(page)
    await page.goto('/#/d/live1')
    await expect(page.locator('.cm-content').first()).toContainText('첫 줄')

    await page.locator('.cm-content .cm-line', { hasText: '첫 줄' }).first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' 방금 친 글')
    await expect.poll(() => room.content('live1')).toBe('첫 줄 방금 친 글\n')
    await convertFromMenu(page, docRow(page, 'live1'))
    // 옮기기 전 연결 수 — 옮긴 뒤 새 소켓이 열리지 않아야 한다
    const attempts = room.attempts('live1')
    await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
    await completeCreateVault(page)
    await expect(notice(page)).toHaveText('"실시간 메모"을(를) 금고로 옮겼습니다.')

    const put = requests.find((r) => r.method === 'PUT' && r.path === '/api/docs/live1/e2ee')
    const typed = '첫 줄 방금 친 글\n'
    const minEnvelope = 4 * Math.ceil((Buffer.byteLength(typed, 'utf-8') + 29) / 3)
    expect(put.body.content.length).toBeGreaterThanOrEqual(minEnvelope)
    await expect(page.locator('.cm-content').first()).toContainText('첫 줄 방금 친 글')
    await page.waitForTimeout(1000)
    expect(room.attempts('live1')).toBe(attempts)
    const log = await noticeLog(page)
    expect(log.some((m) => m.startsWith(LIVE_GONE))).toBe(false)
  })
})
