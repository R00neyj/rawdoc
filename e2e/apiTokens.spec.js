// API 토큰 대화상자 (specs/features/F-222.md 2.4, 3장 A3~A5)
import { test, expect } from '@playwright/test'
import { openApp } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

test.describe('F-222 A3 대화상자 — 만들기·복사·사용 예', () => {
  test('이름 입력 → 만들기 → 원문·복사·사용 예, 목록에 prefix 행. 닫고 다시 열면 원문 없음', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await fakeServer(page)
    await openApp(page)

    await page.getByRole('button', { name: '계정' }).click()
    await page.getByRole('menuitem', { name: 'API 토큰' }).click()

    const dialog = page.locator('.dialog[open]')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('아직 만든 토큰이 없습니다.')).toBeVisible()

    await dialog.locator('.api-token-name-input').fill('교안 자동 업로드')
    await dialog.getByRole('button', { name: '토큰 만들기' }).click()

    const valueInput = dialog.locator('.api-token-value')
    await expect(valueInput).toHaveValue(/^rd_/)
    const tokenValue = await valueInput.inputValue()

    await expect(dialog.getByText('이 토큰은 지금만 볼 수 있습니다. 안전한 곳에 보관하세요.')).toBeVisible()
    await expect(dialog.locator('.api-token-example')).toContainText('curl -H "Authorization: Bearer')
    await expect(dialog.locator('.api-token-example')).toContainText('/v1/docs')

    await dialog.getByRole('button', { name: '복사' }).click()
    await expect(dialog.getByRole('button', { name: '복사됨' })).toBeVisible()

    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe(tokenValue)

    await expect(dialog.locator('.api-token-row')).toHaveCount(1)
    await expect(dialog.locator('.api-token-row')).toContainText('교안 자동 업로드')
    await expect(dialog.locator('.api-token-prefix')).toContainText('rd_')

    // 닫고 다시 열면 원문이 사라진다
    await dialog.getByRole('button', { name: '닫기' }).click()
    await expect(dialog).toBeHidden()

    await page.getByRole('button', { name: '계정' }).click()
    await page.getByRole('menuitem', { name: 'API 토큰' }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.api-token-value')).toHaveCount(0)
    await expect(dialog.locator('.api-token-row')).toHaveCount(1)
  })
})

test.describe('F-222 A4 폐기', () => {
  test('폐기 → 확인 폐기 → 행이 사라지고 DELETE 요청 1회', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)

    await page.getByRole('button', { name: '계정' }).click()
    await page.getByRole('menuitem', { name: 'API 토큰' }).click()
    const dialog = page.locator('.dialog[open]')

    await dialog.locator('.api-token-name-input').fill('삭제될 토큰')
    await dialog.getByRole('button', { name: '토큰 만들기' }).click()
    await expect(dialog.locator('.api-token-row')).toHaveCount(1)

    let deleteCount = 0
    await page.route(/\/api\/tokens\/[^/]+$/, async (route) => {
      if (route.request().method() === 'DELETE') deleteCount += 1
      return route.fallback()
    })

    const row = dialog.locator('.api-token-row').first()
    await row.getByRole('button', { name: '폐기' }).click()
    await expect(row.getByText('폐기하면 이 토큰을 쓰는 스크립트가 멈춥니다.')).toBeVisible()
    await row.getByRole('button', { name: '폐기' }).click()

    await expect(dialog.locator('.api-token-row')).toHaveCount(0)
    await expect.poll(() => deleteCount).toBe(1)
    expect([...server.apiTokens.values()].every((t) => t.revokedAt)).toBe(true)
  })
})

test.describe('F-222 A5 로그아웃 상태', () => {
  test('계정 메뉴에 API 토큰 항목이 없다', async ({ page }) => {
    await page.route('**/api/me', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthenticated"}' }),
    )
    await openApp(page)
    await page.getByRole('button', { name: '계정' }).click()
    await expect(page.getByRole('menuitem', { name: 'API 토큰' })).toHaveCount(0)
  })
})
