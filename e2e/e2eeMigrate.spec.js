// 금고 로그인 이관 — E9 알림·D-14·adopt·rewrap (specs/features/F-408.md 7.2)
import { test, expect } from '@playwright/test'
import zlib from 'node:zlib'
import { openApp as openAppRaw, setPrefBeforeLoad, currentDocId, importMarkdown, waitSaved } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const SETTINGS_DIALOG_SELECTOR = 'dialog[aria-labelledby="settings-title"]'
const PASSWORD_A = '로그인전금고암호입니다요'
const PASSWORD_B = '계정금고암호입니다요다름'
const WRONG_PASSWORD = '틀린금고암호입니다요이건'
const LOGGED_OUT = { status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }

// 저장 공간 보호 알림(F-118)이 E9 와 같은 한 자리를 두고 경쟁하지 않게 미리 꺼 둔다 (e2eeDocs.spec.js 와 같다)
async function openApp(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openAppRaw(page)
}

function notice(page) {
  return page.locator('.notice:not([inert])')
}

// 로그인 전환 직후 — 계정에 아직 문서가 없으면 빈 상태, 새로고침으로 금고가 다시 잠기면 잠금 패널이 뜬다(e2eeDocs.spec.js 와 같다)
async function waitBooted(page) {
  await expect(
    page.locator('.cm-host .cm-editor').or(page.locator('.empty-state')).or(page.locator('.e2ee-locked-panel')),
  ).toBeVisible()
}

function migrateDialog(page) {
  return page.locator('dialog[aria-labelledby="e2ee-migrate-title"]')
}

function convertDialog(page) {
  return page.locator('dialog[open] .e2ee-convert-dialog')
}

function createDialog(page) {
  return page.locator('dialog[aria-labelledby="e2ee-create-title"]')
}

function docRow(page, id) {
  return page.locator('.sidebar .tree-row').filter({ has: page.locator(`a[href="#/d/${id}"]`) })
}

function folderRow(page, name) {
  return page.locator('.sidebar .tree-row').filter({ has: page.getByRole('button', { name, exact: true }) })
}

async function openMenuOf(page, row) {
  await row.hover()
  await row.locator('button[aria-label$=" 메뉴"]').click()
  return page.locator('.item-menu-list:not([inert])')
}

async function newFolder(page, name) {
  await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
  const input = page.locator('.tree-rename-input')
  await expect(input).toBeFocused()
  await input.fill(name)
  await input.press('Enter')
  await expect(folderRow(page, name)).toBeVisible()
}

async function typeIntoEditor(page, text) {
  await page.locator('.cm-content').click()
  await page.keyboard.type(text)
}

async function convertFromMenu(page, row, label = '금고로 옮기기…') {
  const menu = await openMenuOf(page, row)
  await menu.getByRole('menuitem', { name: label, exact: true }).click()
  await expect(convertDialog(page)).toBeVisible()
}

async function completeCreateVault(page, password) {
  const create = createDialog(page)
  await expect(create).toBeVisible()
  await create.locator('input[aria-labelledby="e2ee-create-password-label"]').fill(password)
  await create.locator('input[aria-labelledby="e2ee-create-confirm-label"]').fill(password)
  await create.getByRole('button', { name: '다음' }).click()
  await create.getByLabel('복구 코드를 안전한 곳에 보관했습니다').check()
  await create.getByRole('button', { name: '금고 만들기' }).click()
  await expect(create).toBeHidden()
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

// 브라우저가 실제로 디코드할 수 있는 PNG (e2eeConvert.spec.js 와 같은 방식)
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

// md-docs attachments 행을 모두 읽는다(blob 은 바이트 배열로 바꿔서, e2eeAttachments.spec.js 와 같은 방식)
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

// 요청 몸통(JSON) + 첨부 PUT 원 바이트를 모은다 (e2eeAttachments.spec.js 와 같은 방식)
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
    let bodyBytes
    if (url.pathname.startsWith('/api/attachments/')) {
      const buf = req.postDataBuffer()
      bodyBytes = buf ? Array.from(buf) : undefined
    }
    list.push({ method: req.method(), path: url.pathname, search: url.search, body, bodyBytes })
  })
  return list
}

// 로컬 금고 문서 2개(이미지 든 것 하나, 금고 폴더 안 하나)를 로그아웃 상태에서 만든다
async function buildLocalVault(page, password) {
  const id1 = await importMarkdown(page, { name: '금고전1.md', content: '비밀 문서 하나\n' })
  await page.locator('.cm-content .cm-line').last().click()
  await pasteImage(page, decodablePng(30, 15))
  await expect(page.locator('.statusbar-save')).toHaveText('저장됨', { timeout: 10_000 })
  await convertFromMenu(page, docRow(page, id1))
  await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
  await completeCreateVault(page, password)
  await expect(notice(page).locator('.notice-message')).toContainText('금고로 옮겼습니다', { timeout: 10_000 })

  await newFolder(page, '비밀함')
  const menu = await openMenuOf(page, folderRow(page, '비밀함'))
  const before = await currentDocId(page)
  await menu.getByRole('menuitem', { name: '새 문서', exact: true }).click()
  await expect.poll(() => currentDocId(page)).not.toBe(before)
  const id2 = await currentDocId(page)
  await page.locator('.doc-title').fill('금고전2')
  await typeIntoEditor(page, '폴더 안 비밀\n')
  await waitSaved(page)
  await convertFromMenu(page, folderRow(page, '비밀함'))
  await convertDialog(page).getByRole('button', { name: '옮기기', exact: true }).click()
  await expect(notice(page).locator('.notice-message')).toContainText('금고로 옮겼습니다', { timeout: 20_000 })
  return { id1, id2 }
}

async function openSettingsE2ee(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const dialog = page.locator(SETTINGS_DIALOG_SELECTOR)
  await dialog.getByRole('tab', { name: '금고' }).click()
  return dialog
}

// 계정 금고를 미리 하나 만들어 그 키 묶음만 얻어 온다 — 본 테스트 페이지와는 다른 컨텍스트다 (E6·E7)
async function captureAccountBundle(browser, password) {
  const page = await browser.newPage()
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  const server = await fakeServer(page)
  await openAppRaw(page)
  const dialog = await openSettingsE2ee(page)
  await dialog.getByRole('button', { name: '금고 만들기…' }).click()
  await completeCreateVault(page, password)
  const bundle = server.getE2eeKeys()
  await page.close()
  return bundle
}

test.describe('F-408 E1·E2 알림 — 나중에는 기억하지 않는다', () => {
  test('로그인하면 E9 알림이 뜨고 나중에를 누르면 다음 부팅에 다시 묻는다', async ({ page }) => {
    await page.route('**/api/me', (route) => route.fulfill(LOGGED_OUT))
    await openApp(page)
    await buildLocalVault(page, PASSWORD_A)

    const requests = collectRequests(page)
    await fakeServer(page)
    await page.reload()
    await waitBooted(page)

    await expect(notice(page).locator('.notice-message')).toHaveText(
      '이 브라우저에 로그인 전 금고 문서 2개가 있습니다. 금고 암호를 입력하면 계정 금고로 옮깁니다.',
    )
    await expect(notice(page).getByRole('button', { name: '옮기기' })).toBeVisible()
    await expect(notice(page).getByRole('button', { name: '나중에' })).toBeVisible()
    await page.waitForTimeout(4500)
    await expect(notice(page).locator('.notice-message')).toBeVisible() // info 지만 자동으로 안 사라진다
    expect(requests.some((r) => r.path === '/api/e2ee/keys')).toBe(false)
    expect(requests.some((r) => r.path === '/api/docs' && r.body?.e2eeKey)).toBe(false)

    await notice(page).getByRole('button', { name: '나중에' }).click()
    await expect(notice(page)).toHaveCount(0)
    expect(requests).toHaveLength(0)

    await page.reload()
    await waitBooted(page)
    await expect(notice(page).locator('.notice-message')).toContainText('로그인 전 금고 문서 2개가 있습니다')
  })
})

test.describe('F-408 E3·E4·E5 계정 금고 없음(adopt)', () => {
  test('로컬 금고 암호로 계정 금고가 그대로 생기고, 다음 부팅엔 묻지 않으며, 평문이 오가지 않는다', async ({ page }) => {
    await page.route('**/api/me', (route) => route.fulfill(LOGGED_OUT))
    await openApp(page)
    const { id1, id2 } = await buildLocalVault(page, PASSWORD_A)
    const localAttachmentsBefore = await readAttachmentRows(page)
    expect(localAttachmentsBefore).toHaveLength(1)

    const requests = collectRequests(page)
    const server = await fakeServer(page)
    await page.reload()
    await waitBooted(page)

    await notice(page).getByRole('button', { name: '옮기기' }).click()
    const dialog = migrateDialog(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.e2ee-migrate-note')).toHaveText(
      '계정에 아직 금고가 없어 이 금고가 그대로 계정 금고가 됩니다. 금고 암호와 복구 코드도 그대로 씁니다.',
    )

    const passwordInput = dialog.locator('input[aria-labelledby="e2ee-migrate-password-label"]')
    await passwordInput.fill(WRONG_PASSWORD)
    await dialog.getByRole('button', { name: '옮기기', exact: true }).click()
    await expect(dialog.locator('.e2ee-error')).toHaveText('암호가 맞지 않습니다.')
    expect(requests).toHaveLength(0)

    await passwordInput.fill('')
    await passwordInput.fill(PASSWORD_A)
    await dialog.getByRole('button', { name: '옮기기', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(notice(page).locator('.notice-message')).toContainText('계정 금고에 넣었습니다', { timeout: 20_000 })

    // E3 — PUT /api/e2ee/keys 한 번, baseRev 0, 로컬 행과 같은 bundle
    const putKeys = requests.filter((r) => r.path === '/api/e2ee/keys' && r.method === 'PUT')
    expect(putKeys).toHaveLength(1)
    expect(putKeys[0].body.baseRev).toBe(0)
    const localRow = await readIdb(page, 'md-docs', 'e2ee', 'local')
    expect(putKeys[0].body.bundle).toBe(localRow.bundle)

    await expect.poll(() => server.docs.size).toBe(2)
    const localDocs = await readIdb(page, 'md-docs', 'docs', null)
    const localVaultDocs = localDocs.filter((d) => d.e2eeKey !== undefined)
    expect(localVaultDocs).toHaveLength(2)
    for (const doc of localVaultDocs) {
      const serverDoc = server.docs.get(doc.id)
      expect(serverDoc).toBeTruthy()
      expect(serverDoc.title).toBe(doc.title)
      expect(serverDoc.content).toBe(doc.content)
      expect(serverDoc.e2eeKey).toBe(doc.e2eeKey)
    }

    const serverAttachment = [...server.attachments.values()].find((a) => a.mime === 'image/png')
    expect(serverAttachment).toBeTruthy()
    expect(Array.from(serverAttachment.bytes)).toEqual(localAttachmentsBefore[0].bytes)

    // 사이드바에 복호화된 제목(금고가 열렸다)
    await expect(page.getByText('금고전1').first()).toBeVisible()
    await expect(page.getByText('금고전2').first()).toBeVisible()

    // E5 — 평문이 어느 요청 몸통에도 없다
    const secrets = ['비밀 문서 하나', '폴더 안 비밀', PASSWORD_A]
    for (const r of requests) {
      const json = JSON.stringify(r.body ?? null)
      for (const s of secrets) expect(json).not.toContain(s)
    }
    const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    for (const r of requests) {
      if (!r.bodyBytes) continue
      let found = false
      for (let i = 0; i + pngHeader.length <= r.bodyBytes.length; i++) {
        if (pngHeader.every((b, j) => r.bodyBytes[i + j] === b)) {
          found = true
          break
        }
      }
      expect(found).toBe(false)
    }

    // E4 — 새로고침해도 다시 묻지 않고, 로컬 행에 migratedTo 가 남는다
    await page.reload()
    await waitBooted(page)
    await expect(page.locator('.notice-message', { hasText: '로그인 전 금고 문서' })).toHaveCount(0)
    const rowAfter = await readIdb(page, 'md-docs', 'e2ee', 'local')
    expect(rowAfter.migratedTo).toEqual(['u1'])
    const localDocsAfter = await readIdb(page, 'md-docs', 'docs', null)
    expect(localDocsAfter.filter((d) => d.id === id1 || d.id === id2)).toHaveLength(2) // 로컬 사본은 지우지 않는다
  })
})

test.describe('F-408 E6·E7 계정 금고 있음(rewrap)', () => {
  test('E6 두 암호가 다르면 D-14 2단계를 거친다', async ({ page, browser }) => {
    const bundle = await captureAccountBundle(browser, PASSWORD_B)

    await page.route('**/api/me', (route) => route.fulfill(LOGGED_OUT))
    await openApp(page)
    await buildLocalVault(page, PASSWORD_A)
    const localAttachmentsBefore = await readAttachmentRows(page)

    const requests = collectRequests(page)
    const server = await fakeServer(page)
    server.setE2eeKeys(bundle)
    await page.reload()
    await waitBooted(page)

    await notice(page).getByRole('button', { name: '옮기기' }).click()
    const dialog = migrateDialog(page)
    await expect(dialog.locator('.e2ee-migrate-note')).toHaveText('계정 금고에 넣습니다. 계정 금고의 암호와 복구 코드는 바뀌지 않습니다.')
    await dialog.locator('input[aria-labelledby="e2ee-migrate-password-label"]').fill(PASSWORD_A)
    await dialog.getByRole('button', { name: '옮기기', exact: true }).click()

    await expect(dialog.locator('h2')).toHaveText('계정 금고 열기')
    await dialog.locator('input[aria-labelledby="e2ee-migrate-step2-password-label"]').fill(PASSWORD_B)
    await dialog.getByRole('button', { name: '열기', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(notice(page).locator('.notice-message')).toContainText('계정 금고에 넣었습니다', { timeout: 20_000 })

    // 2.1 공통 앞부분 2번이 "있나 보고 만들기" 를 시도해 409 를 받는다 — 계정 묶음 자체는 바뀌지 않는다
    const putKeys = requests.filter((r) => r.path === '/api/e2ee/keys' && r.method === 'PUT')
    expect(putKeys).toHaveLength(1)
    expect(server.getE2eeKeys().bundle).toBe(bundle.bundle)

    await expect.poll(() => server.docs.size).toBe(2)
    const localDocs = (await readIdb(page, 'md-docs', 'docs', null)).filter((d) => d.e2eeKey !== undefined)
    for (const doc of localDocs) {
      const serverDoc = server.docs.get(doc.id)
      expect(serverDoc.title).toBe(doc.title)
      expect(serverDoc.content).toBe(doc.content)
      expect(serverDoc.e2eeKey).not.toBe(doc.e2eeKey)
    }

    const serverAttachment = [...server.attachments.values()].find((a) => a.mime === 'image/png')
    const localBytes = localAttachmentsBefore[0].bytes
    const serverBytes = Array.from(serverAttachment.bytes)
    expect(serverBytes[0]).toBe(localBytes[0])
    expect(serverBytes.slice(41)).toEqual(localBytes.slice(41))
    expect(serverBytes.slice(1, 41)).not.toEqual(localBytes.slice(1, 41))

    await expect(page.getByText('금고전1').first()).toBeVisible()
  })

  test('E7 두 암호가 같으면 2단계 없이 끝난다', async ({ page, browser }) => {
    const bundle = await captureAccountBundle(browser, PASSWORD_A)

    await page.route('**/api/me', (route) => route.fulfill(LOGGED_OUT))
    await openApp(page)
    await buildLocalVault(page, PASSWORD_A)

    const requests = collectRequests(page)
    const server = await fakeServer(page)
    server.setE2eeKeys(bundle)
    await page.reload()
    await waitBooted(page)

    await notice(page).getByRole('button', { name: '옮기기' }).click()
    const dialog = migrateDialog(page)
    await dialog.locator('input[aria-labelledby="e2ee-migrate-password-label"]').fill(PASSWORD_A)
    await dialog.getByRole('button', { name: '옮기기', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(notice(page).locator('.notice-message')).toContainText('계정 금고에 넣었습니다', { timeout: 20_000 })

    expect(requests.filter((r) => r.path === '/api/e2ee/keys' && r.method === 'PUT')).toHaveLength(1)
    expect(server.getE2eeKeys().bundle).toBe(bundle.bundle)
    await expect.poll(() => server.docs.size).toBe(2)
  })

  test('E8 2단계에서 나중에를 누르면 아무것도 쓰지 않고 다음 부팅에 다시 묻는다', async ({ page, browser }) => {
    const bundle = await captureAccountBundle(browser, PASSWORD_B)

    await page.route('**/api/me', (route) => route.fulfill(LOGGED_OUT))
    await openApp(page)
    await buildLocalVault(page, PASSWORD_A)

    const requests = collectRequests(page)
    const server = await fakeServer(page)
    server.setE2eeKeys(bundle)
    await page.reload()
    await waitBooted(page)

    await notice(page).getByRole('button', { name: '옮기기' }).click()
    const dialog = migrateDialog(page)
    await dialog.locator('input[aria-labelledby="e2ee-migrate-password-label"]').fill(PASSWORD_A)
    await dialog.getByRole('button', { name: '옮기기', exact: true }).click()
    await expect(dialog.locator('h2')).toHaveText('계정 금고 열기')
    await dialog.getByRole('button', { name: '나중에', exact: true }).click()
    await expect(dialog).toBeHidden()

    // 1단계 제출이 "있나 보고 만들기" 시도 한 번을 보낸다(409) — 그 밖엔 아무것도 쓰지 않는다(2.4)
    expect(requests).toHaveLength(1)
    expect(server.getE2eeKeys().bundle).toBe(bundle.bundle)
    expect(server.docs.size).toBe(0)
    expect(server.attachments.size).toBe(0)
    expect(notice(page)).toHaveCount(0)

    await page.reload()
    await waitBooted(page)
    await expect(notice(page).locator('.notice-message')).toContainText('로그인 전 금고 문서 2개가 있습니다')
  })
})

test.describe('F-408 E9 오프라인', () => {
  test('D-14 를 연 뒤 오프라인이면 저장하지 못했다는 오류가 뜨고 대화상자는 열린 채로 남는다', async ({ page }) => {
    await page.route('**/api/me', (route) => route.fulfill(LOGGED_OUT))
    await openApp(page)
    await buildLocalVault(page, PASSWORD_A)

    const server = await fakeServer(page)
    await page.reload()
    await waitBooted(page)

    await notice(page).getByRole('button', { name: '옮기기' }).click()
    const dialog = migrateDialog(page)
    server.setOffline(true)
    await dialog.locator('input[aria-labelledby="e2ee-migrate-password-label"]').fill(PASSWORD_A)
    await dialog.getByRole('button', { name: '옮기기', exact: true }).click()
    await expect(dialog.locator('.e2ee-error')).toHaveText('인터넷에 연결되어 있지 않아 저장하지 못했습니다. 연결한 뒤 다시 누르세요.')
    await expect(dialog).toBeVisible()

    const cachedDocs = (await readIdb(page, 'md-remote', 'docs', null)) ?? []
    expect(cachedDocs.filter((d) => d.e2eeKey !== undefined)).toHaveLength(0)
  })
})
