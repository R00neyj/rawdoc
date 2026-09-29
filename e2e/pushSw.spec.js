// 서비스 워커 푸시 처리기 — 빌드 산출물과 CDP 푸시 → 알림 (specs/features/F-3004.md 7.2)
import { test, expect } from '@playwright/test'

// 이 파일만 서비스 워커를 켠다 — 다른 e2e 는 playwright.config.js 의 block 그대로
test.use({ serviceWorkers: 'allow' })

const DOC_ID = '0b8f2a3e-6a4c-4f7e-9d1a-2f3b4c5d6e7f'
const valid = {
  v: 1,
  title: 'a@x.com님이 멘션했습니다',
  body: '"회의록" · 이번 주 검토',
  tag: `doc:${DOC_ID}`,
  url: `/#/d/${DOC_ID}/c/t1`,
}

test('F-3004 E1 빌드 산출물 — sw.js 가 push-sw.js 를 먼저 부르고 precache 에 넣는다', async ({ page }) => {
  const sw = await page.request.get('/sw.js')
  expect(sw.status()).toBe(200)
  const swBody = await sw.text()
  const importAt = swBody.indexOf('importScripts("/push-sw.js")')
  expect(importAt).toBeGreaterThanOrEqual(0)
  expect(importAt).toBeLessThan(swBody.indexOf('precacheAndRoute'))
  expect([...swBody.matchAll(/url:"([^"]+)"/g)].map((m) => m[1])).toContain('push-sw.js')

  const push = await page.request.get('/push-sw.js')
  expect(push.status()).toBe(200)
  const pushBytes = await push.body()
  expect(pushBytes.length).toBeLessThanOrEqual(4096)
  expect(pushBytes.toString('utf-8')).not.toMatch(/^\s*(import|export)\s/m)

  const badge = await page.request.get('/icons/badge-96.png')
  expect(badge.status()).toBe(200)
  expect(badge.headers()['content-type']).toContain('image/png')
})

test('F-3004 E2 푸시가 알림이 된다 — 같은 tag 는 바꿔 끼우고 틀린 본문은 대체 알림', async ({ page, context }) => {
  await context.grantPermissions(['notifications'])
  await page.goto('/sw.js')
  const origin = new URL(page.url()).origin
  const cdp = await context.newCDPSession(page)
  const registrations = []
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => registrations.push(...e.registrations))
  await cdp.send('ServiceWorker.enable')
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
  })
  await expect.poll(() => registrations.find((r) => r.scopeURL.startsWith(origin) && !r.isDeleted)).toBeTruthy()
  const { registrationId } = registrations.find((r) => r.scopeURL.startsWith(origin) && !r.isDeleted)

  const deliver = (data) => cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data })
  const notifications = () =>
    page.evaluate(async () =>
      (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({
        title: n.title,
        body: n.body,
        tag: n.tag,
        badge: n.badge,
        data: n.data,
      })),
    )

  await deliver(JSON.stringify(valid))
  await expect.poll(async () => (await notifications()).length).toBe(1)
  const [first] = await notifications()
  expect(first).toMatchObject({ title: valid.title, body: valid.body, tag: valid.tag, data: { url: valid.url } })
  expect(first.badge.endsWith('/icons/badge-96.png')).toBe(true)

  await deliver(JSON.stringify({ ...valid, title: '"회의록"에 새 댓글 2개' }))
  await expect.poll(async () => (await notifications()).map((n) => n.title)).toEqual(['"회의록"에 새 댓글 2개'])

  await deliver('not json')
  await expect.poll(async () => (await notifications()).length).toBe(2)
  expect(await notifications()).toContainEqual(
    expect.objectContaining({ title: '새 알림', tag: 'fallback', data: { url: '/' } }),
  )
})
