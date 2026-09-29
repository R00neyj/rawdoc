// 푸시 — 설정 `계정` 탭 `이 기기에서 푸시 받기`·부팅 다시 알리기·push-open (specs/features/F-2110.md 9.2 E1·E2)
import { test, expect } from '@playwright/test'
import { openApp } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'
import { installFakePush } from './fixtures/fakePush.js'

const SETTINGS = 'dialog[aria-labelledby="settings-title"]'
const DAY_MS = 86_400_000

async function openAccountTab(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const settings = page.locator(SETTINGS)
  await settings.getByRole('tab', { name: '계정' }).click()
  return settings
}

function puts(server) {
  return server.pushRequests().filter((r) => r.method === 'PUT' && r.path === '/api/push/subscription')
}

test('F-2110 E1 켜기·다시 알리기·끄기', async ({ page }) => {
  const server = await fakeServer(page)
  await installFakePush(page)
  await openApp(page)

  const settings = await openAccountTab(page)
  const toggle = settings.getByRole('switch', { name: '이 기기에서 푸시 받기' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  expect(puts(server)).toHaveLength(1)
  const put = puts(server)[0].body
  expect(put.endpoint).toBe('https://fcm.googleapis.com/fcm/send/e2e-fake')
  expect(typeof put.keys.p256dh).toBe('string')
  expect(typeof put.keys.auth).toBe('string')
  expect(await page.evaluate(() => localStorage.getItem('md.push'))).toBe('u1')

  await settings.getByRole('button', { name: '테스트 알림 보내기' }).click()
  await expect.poll(() => server.pushRequests().filter((r) => r.path === '/api/push/test').length).toBe(1)
  await expect(page.getByText('테스트 알림을 보냈습니다. 몇 초 안에 오지 않으면 기기의 알림 설정을 확인하세요.')).toBeVisible()

  await page.reload()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  await page.waitForTimeout(2000)
  expect(puts(server)).toHaveLength(1)
  const settings2 = await openAccountTab(page)
  const toggle2 = settings2.getByRole('switch', { name: '이 기기에서 푸시 받기' })
  await expect(toggle2).toHaveAttribute('aria-checked', 'true')

  await page.evaluate((ms) => localStorage.setItem('md.pushSyncedAt', String(Date.now() - ms)), 8 * DAY_MS)
  await page.reload()
  await expect.poll(() => puts(server).length).toBe(2)

  await page.evaluate(() => localStorage.setItem('md.pushSyncedAt', ''))
  await page.reload()
  await expect.poll(() => puts(server).length).toBe(3)

  const settings3 = await openAccountTab(page)
  const toggle3 = settings3.getByRole('switch', { name: '이 기기에서 푸시 받기' })
  await toggle3.click()
  await expect(toggle3).toHaveAttribute('aria-checked', 'false')
  const dels = server.pushRequests().filter((r) => r.method === 'DELETE')
  expect(dels).toHaveLength(1)
  expect(dels[0].body.endpoint).toBe('https://fcm.googleapis.com/fcm/send/e2e-fake')
  expect(await page.evaluate(() => localStorage.getItem('md.push'))).toBe('')

  await page.reload()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  const settings4 = await openAccountTab(page)
  await expect(settings4.getByRole('switch', { name: '이 기기에서 푸시 받기' })).toHaveAttribute('aria-checked', 'false')
  expect(puts(server)).toHaveLength(3)
})

test('F-2110 E2 push-open 이 문서로 옮긴다', async ({ page }) => {
  const server = await fakeServer(page)
  const now = Date.now()
  const mk = (id, title) => ({ id, title, content: `# ${title}\n`, lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: now, updatedAt: now })
  server.docs.set('docA', mk('docA', '문서 에이'))
  server.docs.set('docB', mk('docB', '문서 비'))
  await page.goto('/#/d/docA')
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()

  const send = (data) => page.evaluate((d) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: d })), data)
  const title = page.locator('.doc-title')

  await send({ type: 'push-open', url: '/#/d/docB' })
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/d/docB')
  await expect(title).toHaveValue('문서 비')

  for (const data of [
    { type: 'push-open', url: '/' },
    { type: 'push-open', url: '/#/' },
    { type: 'push-open', url: '//evil.com' },
    { type: 'other', url: '/#/d/docA' },
  ]) {
    await send(data)
  }
  await page.waitForTimeout(1000)
  expect(await page.evaluate(() => location.hash)).toBe('#/d/docB')

  server.docs.set('docC', mk('docC', '문서 씨'))
  await send({ type: 'push-open', url: '/#/d/docC' })
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/d/docC')
  await expect(title).toHaveValue('문서 씨')
})
