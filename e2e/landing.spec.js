// F-271 루트 랜딩과 첫 방문 판정 — preview 는 워커가 없어 mockLanding 으로 '/' 첫 요청만 랜딩으로 바꿔친다 (10장, 9.2)
import { test, expect } from '@playwright/test'
import { mockLanding, setPrefBeforeLoad } from './helpers.js'

test('F-271 A6 첫 방문 — 랜딩만 보이고 앱으로 넘어가지 않는다', async ({ page }) => {
  await mockLanding(page)
  await page.goto('/')
  // 히어로(#demo)는 F-239 §2.1 에 따라 assets/welcome-demo.js 가 뜨면 실제 편집기로 바꿔 낀다(demo-host).
  // 그 결과 정적 <h1> 은 사라지지만 같은 문구가 편집기 첫 줄로 그대로 보이므로, 역할이 아니라 텍스트로 확인한다
  await expect(page.getByText(/원문 그대로 쓰는/).first()).toBeVisible({ timeout: 10_000 })
  // 실제 앱 에디터(.cm-host)와 랜딩 데모(.cm-host.demo-host)는 같은 클래스를 쓴다 — demo-host 를 뺀 쪽으로 앱 미전환을 확인한다
  await expect(page.locator('.cm-host:not(.demo-host)')).toHaveCount(0)
  await expect(page.locator('.empty-state')).toHaveCount(0)
  await expect(page.locator('.cookie-escape a[href="/?app=1"]')).toBeHidden()
})

test('F-271 A7 기존 사용자 키(md.firstRunDone) 가 있으면 랜딩에 머무르지 않고 앱이 뜬다', async ({ page }) => {
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await mockLanding(page)
  await page.goto('/')
  await expect(page.locator('.cm-host .cm-editor, .empty-state')).toBeVisible({ timeout: 10_000 })

  const landingDone = await page.evaluate(() => localStorage.getItem('md.landingDone'))
  expect(landingDone).toBe('1')
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'md_app')?.value).toBe('1')
})

test('F-271 A8 앱 해시가 붙어 있으면 랜딩에 막히지 않고 앱으로 간다', async ({ page }) => {
  await mockLanding(page)
  await page.goto('/#/help')
  await expect(page).toHaveURL(/#\/help$/)

  const landingDone = await page.evaluate(() => localStorage.getItem('md.landingDone'))
  expect(landingDone).toBe('1')
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'md_app')?.value).toBe('1')
})

test('F-271 A9 로그인 없이 사용 클릭 시 앱이 뜨고 두 값이 생긴다', async ({ page }) => {
  await mockLanding(page)
  await page.goto('/')
  await page.locator('[data-cta="enter"]').first().click()
  await expect(page.locator('.cm-host .cm-editor, .empty-state')).toBeVisible({ timeout: 10_000 })

  const landingDone = await page.evaluate(() => localStorage.getItem('md.landingDone'))
  expect(landingDone).toBe('1')
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'md_app')?.value).toBe('1')
})

test('F-271 A10 앱 부팅 시 두 값을 쓴다 (랜딩을 거치지 않아도 다음부터 앱)', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.cm-host .cm-editor, .empty-state')).toBeVisible({ timeout: 10_000 })

  const landingDone = await page.evaluate(() => localStorage.getItem('md.landingDone'))
  expect(landingDone).toBe('1')
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'md_app')?.value).toBe('1')
})

test('F-271 A11 쿠키가 차단된 브라우저 — 되돌이는 1회, 탈출구 링크가 보인다', async ({ page }) => {
  // document.cookie 쓰기를 무시하게 덮어 쿠키 차단 브라우저를 흉내 낸다
  await page.addInitScript(() => {
    Object.defineProperty(document, 'cookie', { get: () => '', set: () => {} })
  })
  await setPrefBeforeLoad(page, 'md.landingDone', '1')
  await mockLanding(page)
  await mockLanding(page) // reload 로 인한 두 번째 요청도 랜딩이어야 되돌이를 확인할 수 있다

  await page.goto('/')
  await expect(page.locator('.cookie-escape a[href="/?app=1"]')).toBeVisible()
  const reloaded = await page.evaluate(() => sessionStorage.getItem('md.landingReloaded'))
  expect(reloaded).toBe('1')
})
