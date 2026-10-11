// 후원 알림 띠 주기 — 때가 된 부팅에 띄우고, 후원하기는 1년·닫기는 30일 쉰다 (small 2026-10-11)
import { test, expect } from '@playwright/test'
import { openApp, setPrefBeforeLoad } from './helpers.js'

const MESSAGE = '광고·구독 없이 운영합니다. 도움이 됐다면 후원을 고려해 주세요.'
const DAY = 86_400_000

// setPrefBeforeLoad 는 새로고침마다 다시 써서 한 번만 넣는다 — 첫 부팅이 7일 뒤로 잡은 값을 "지금 때"로 덮고 다시 부팅
async function bootDue(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openApp(page)
  await page.evaluate(() => window.localStorage.setItem('md.donatePromptAt', '1'))
  await page.reload()
  const notice = page.locator('.notice').filter({ hasText: MESSAGE })
  await expect(notice).toBeVisible({ timeout: 10_000 })
  return notice
}

async function storedAt(page) {
  return Number(await page.evaluate(() => window.localStorage.getItem('md.donatePromptAt')))
}

async function expectNoNoticeAfterBoot(page) {
  await page.reload()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  await page.waitForTimeout(4_000)
  await expect(page.locator('.notice').filter({ hasText: MESSAGE })).toHaveCount(0)
}

test('small 후원 C1 때가 된 부팅에 알림 띠 — 후원하기는 대화상자를 열고 1년 뒤로 미룬다', async ({ page }) => {
  const notice = await bootDue(page)
  const before = Date.now()
  await notice.getByRole('button', { name: '후원하기' }).click()

  const dialog = page.locator('dialog[open]')
  await expect(dialog.getByRole('heading', { name: '후원하기' })).toBeVisible()
  const qr = dialog.getByRole('img', { name: '토스 송금 QR' })
  await expect.poll(() => qr.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)
  await expect(notice).toHaveCount(0)
  const at = await storedAt(page)
  expect(at - before).toBeGreaterThanOrEqual(365 * DAY)
  expect(at - Date.now()).toBeLessThanOrEqual(365 * DAY)

  await expectNoNoticeAfterBoot(page)
})

test('small 후원 C2 알림 닫기는 30일 뒤로 미루고 다음 부팅에 다시 뜨지 않는다', async ({ page }) => {
  const notice = await bootDue(page)
  const before = Date.now()
  await notice.getByRole('button', { name: '알림 닫기' }).click()
  await expect(notice).toHaveCount(0)
  const at = await storedAt(page)
  expect(at - before).toBeGreaterThanOrEqual(30 * DAY)
  expect(at - Date.now()).toBeLessThanOrEqual(30 * DAY)

  await expectNoNoticeAfterBoot(page)
})
