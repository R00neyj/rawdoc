// 부팅 — 계정 확인 전에 캐시 셸 먼저 (specs/features/F-2134.md 8장)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, waitSaved } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const L5 = '이 계정은 운영자가 쓰기를 막았습니다. 문서 읽기와 내보내기만 할 수 있습니다.'

// /api/me 를 붙잡는다 — release() 면 fakeServer 응답, release(401) 이면 그 뒤로 계속 401
async function holdApiMe(page) {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const handler = async (route) => {
    const status = await gate
    if (status === 401) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' })
    return route.fallback()
  }
  await page.route('**/api/me', handler)
  return { release, unroute: () => page.unroute('**/api/me', handler) }
}

async function newDoc(page, name) {
  const id = await importMarkdown(page, { name: `${name}.md`, content: `${name}\n` })
  await waitSaved(page)
  return id
}

function docLink(page, name) {
  return page.locator('.sidebar').getByRole('link', { name, exact: true })
}

function docLinkById(page, id) {
  return page.locator(`.sidebar a[href="#/d/${id}"]`)
}

async function expectShellReady(page) {
  await expect(page.locator('.app-shell')).not.toHaveAttribute('aria-busy', 'true')
}

// 로그인 상태로 한 번 부팅해 A·B 를 캐시에 채운다 (8장 공통)
async function bootWithCache(page) {
  const server = await fakeServer(page)
  await openApp(page)
  const aId = await newDoc(page, 'A')
  const bId = await newDoc(page, 'B')
  await expect.poll(() => server.docs.has(aId) && server.docs.has(bId)).toBe(true)
  return { server, aId, bId }
}

async function createDocDuringHold(page) {
  const before = await currentDocId(page)
  await page.getByRole('button', { name: '새 문서' }).first().click()
  await expect.poll(() => currentDocId(page)).not.toBe(before)
  return currentDocId(page)
}

function idbRows(page, dbName, storeName) {
  return page.evaluate(
    ({ dbName, storeName }) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.close()
            return resolve([])
          }
          const r = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
          r.onsuccess = () => {
            db.close()
            resolve(r.result)
          }
          r.onerror = () => reject(r.error)
        }
      }),
    { dbName, storeName },
  )
}

test('F-2134 E1 /api/me 가 붙잡힌 동안 캐시 셸이 뜨고, 그 사이 만든 문서는 확인 뒤에야 서버로 나간다', async ({ page }) => {
  const { server } = await bootWithCache(page)
  const hold = await holdApiMe(page)
  await page.reload()

  await expectShellReady(page)
  await expect(docLink(page, 'A')).toBeVisible()
  await expect(docLink(page, 'B')).toBeVisible()
  const writesBefore = server.writeRequests().length

  const cId = await createDocDuringHold(page)
  await expect(docLinkById(page, cId)).toBeVisible()
  // 확인 전 멈춤이 없으면 이 사이에 POST 가 나간다
  await page.waitForTimeout(500)
  expect(server.writeRequests().length).toBe(writesBefore)
  expect(server.docs.has(cId)).toBe(false)

  hold.release()
  await expect.poll(() => server.docs.has(cId)).toBe(true)
  expect(server.writeRequests().slice(writesBefore).some((w) => w.method === 'POST' && w.path === '/api/docs')).toBe(true)

  await page.reload()
  await expectShellReady(page)
  await expect(docLinkById(page, cId)).toBeVisible()
})

test('F-2134 E2 붙잡힌 동안 만든 문서는 401 이면 새로고침 뒤 로그아웃 상태로, 보낼 목록에 남았다가 다시 로그인하면 나간다', async ({ page }) => {
  const { server } = await bootWithCache(page)
  const hold = await holdApiMe(page)
  await page.reload()
  await expectShellReady(page)
  await expect(docLink(page, 'A')).toBeVisible()
  const writesBefore = server.writeRequests().length

  const dId = await createDocDuringHold(page)
  await expect(docLinkById(page, dId)).toBeVisible()

  const reloaded = page.waitForEvent('load')
  hold.release(401)
  await reloaded
  await expectShellReady(page)
  expect(await page.evaluate(() => localStorage.getItem('md.account'))).toBe('')
  await expect(docLink(page, 'A')).toHaveCount(0)
  await expect(docLink(page, 'B')).toHaveCount(0)
  await expect(docLinkById(page, dId)).toHaveCount(0)
  expect(server.writeRequests().length).toBe(writesBefore)
  const outbox = await idbRows(page, 'md-remote', 'outbox')
  expect(outbox.some((e) => e.userId === 'u1' && e.type === 'createDoc' && e.docId === dId)).toBe(true)

  await hold.unroute()
  await page.reload()
  await expectShellReady(page)
  await expect(docLinkById(page, dId)).toBeVisible()
  await expect.poll(() => server.docs.has(dId)).toBe(true)
})

test('F-2134 E3 막힌 계정으로 문서 주소를 붙잡은 채 열면, 풀린 뒤 L5·읽기 전용이고 쓰기 요청이 없다', async ({ page }) => {
  const { server, aId } = await bootWithCache(page)
  await page.evaluate((id) => history.replaceState(null, '', `#/d/${id}`), aId)
  server.setMe({ blocked: true })
  const hold = await holdApiMe(page)
  const writesBefore = server.writeRequests().length
  await page.reload()
  await expectShellReady(page)

  hold.release()
  await expect(page.locator('.notice-message')).toHaveText(L5)
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')
  expect(await currentDocId(page)).toBe(aId)
  expect(server.writeRequests().length).toBe(writesBefore)
})
