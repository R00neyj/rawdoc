// 첫 로딩 스켈레톤 (specs/features/F-2015.md 14.2)
import { test, expect } from '@playwright/test'
import { rectOf } from './helpers.js'

const MAIN_JS_PATTERN = /\/assets\/index-[^/]+\.js$/

function makeGate() {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}

async function holdMainJs(page) {
  const gate = makeGate()
  await page.route(MAIN_JS_PATTERN, async (route) => {
    await gate.promise
    await route.continue()
  })
  return gate.release
}

async function holdApiMe(page) {
  const gate = makeGate()
  await page.route('**/api/me', async (route) => {
    await gate.promise
    await route.continue()
  })
  return gate.release
}

test('F-2015 A1~A3 인계 — 겹침 노드가 그대로 남고 ready 에서 함께 걷힌다', async ({ page }) => {
  const releaseJs = await holdMainJs(page)
  const releaseApiMe = await holdApiMe(page)

  await page.goto('/', { waitUntil: 'commit' })

  // A1
  await expect(page.locator('#boot-skeleton')).toBeVisible()
  expect(await page.locator('#root > *').count()).toBe(0)
  await expect(page.getByRole('status', { name: '불러오는 중…' })).toHaveCount(1)

  await page.locator('#boot-skeleton').evaluate((el) => el.setAttribute('data-probe', '1'))
  const sidebarBefore = await rectOf(page.locator('.boot-skeleton-sidebar'))
  const topbarBefore = await rectOf(page.locator('.boot-skeleton-topbar'))

  // A2
  releaseJs()
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.locator('#boot-skeleton[data-probe="1"]')).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('.app-shell')).toHaveAttribute('inert', '')
  const sidebarAfter = await rectOf(page.locator('.boot-skeleton-sidebar'))
  const topbarAfter = await rectOf(page.locator('.boot-skeleton-topbar'))
  expect(sidebarAfter).toEqual(sidebarBefore)
  expect(topbarAfter).toEqual(topbarBefore)

  // A3
  releaseApiMe()
  await expect(page.locator('.empty-state')).toBeVisible()
  await expect(page.locator('#boot-skeleton')).toHaveCount(0)
  await expect(page.locator('.app-shell')).not.toHaveAttribute('aria-busy', 'true')
  const inertAttr = await page.locator('.app-shell').evaluate((el) => el.getAttribute('inert'))
  expect(inertAttr).toBeNull()
})

// F-2015 A5·A6(부팅 중 사이드바 폭 360·48)과 A10a·A10b(스켈레톤 애니메이션 유무)는 시각 값이라 e2e 에서 뺐다 — specs/human-checks.md (2026-09-25 e2e 경량화)

test('F-2015 A9 F-136 막힘 — 스켈레톤을 걷고 문구를 보인다', async ({ page, context }) => {
  const blocker = await context.newPage()
  await blocker.goto('/manifest.webmanifest')
  await blocker.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs', 1)
        req.onsuccess = () => resolve(null)
        req.onerror = () => reject(req.error)
      }),
  )

  await page.goto('/')
  await expect(page.locator('.boot-blocked-notice')).toHaveText(
    '다른 창에서 이 앱이 열려 있습니다. 그 창을 닫거나 새로 고치면 계속됩니다.',
  )
  await expect(page.locator('#boot-skeleton')).toHaveCount(0)
  await expect(page.locator('.app-shell')).toHaveAttribute('inert', '')

  await blocker.close()
})
