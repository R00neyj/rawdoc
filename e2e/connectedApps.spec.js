// 설정 `계정` 묶음의 연결된 앱 — 목록·끊기·초점·실패·오프라인 (specs/features/F-2148.md 3장 E1~E3)
import { test, expect } from '@playwright/test'
import { openApp, setPrefBeforeLoad, resetBrowserState } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const SETTINGS = 'dialog[aria-labelledby="settings-title"]'

function app(id, name) {
  return { id, name, host: 'example.com', createdAt: Date.now() - 86_400_000, lastUsedAt: null }
}

async function openAppsTab(page) {
  const settings = page.locator(SETTINGS)
  if (!(await settings.isVisible())) await page.getByRole('button', { name: '설정', exact: true }).click()
  await settings.getByRole('tab', { name: '계정' }).click()
  return settings
}

test.describe('F-2148 연결된 앱 탭', () => {
  test('F-2148 E1 가운데 끊기 → 행 2·초점·다시 열어도 2', async ({ page }) => {
    const server = await fakeServer(page)
    server.setConnectedApps([app('a1', '앱 하나'), app('a2', '앱 둘'), app('a3', '앱 셋')])
    await openApp(page)
    const settings = await openAppsTab(page)
    const rows = settings.locator('.connected-app-row')
    await expect(rows).toHaveCount(3)
    await settings.getByRole('button', { name: '앱 둘 연결 끊기' }).click()
    await expect(rows).toHaveCount(2)
    expect(server.connectedAppsLog().filter((e) => e.method === 'DELETE')).toEqual([{ method: 'DELETE', id: 'a2' }])
    await expect(settings.getByRole('button', { name: '앱 셋 연결 끊기' })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()
    await openAppsTab(page)
    await expect(settings.locator('.connected-app-row')).toHaveCount(2)
  })

  test('F-2148 E2 404 → 빈 상태·초점, 500 → 행 유지·실패 문구', async ({ page }) => {
    test.setTimeout(60000)
    await test.step('404 는 이미 끊긴 것으로 보고 행을 뺀다', async () => {
      const server = await fakeServer(page)
      server.setConnectedApps([app('a1', '앱 하나')])
      await openApp(page)
      const settings = await openAppsTab(page)
      server.failConnectedApps({ status: 404, times: 1 })
      await settings.getByRole('button', { name: '앱 하나 연결 끊기' }).click()
      await expect(settings.locator('.connected-app-row')).toHaveCount(0)
      await expect(settings.locator('.connected-apps-empty')).toHaveText('연결된 앱이 없습니다')
      await expect(settings.locator('.connected-apps-empty')).toBeFocused()
    })
    await test.step('500 은 행을 남기고 문구를 띄운다', async () => {
      await resetBrowserState(page)
      const server = await fakeServer(page)
      server.setConnectedApps([app('a1', '앱 하나')])
      await openApp(page)
      const settings = await openAppsTab(page)
      await expect(settings.locator('.connected-app-row')).toHaveCount(1)
      server.failConnectedApps({ status: 500, times: 1 })
      await settings.getByRole('button', { name: '앱 하나 연결 끊기' }).click()
      await expect(settings.getByRole('alert')).toHaveText('연결을 끊지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.')
      await expect(settings.locator('.connected-app-row')).toHaveCount(1)
      await expect(settings.getByRole('button', { name: '앱 하나 연결 끊기' })).toBeEnabled()
    })
  })

  test('F-2148 E3 불러오기 실패 → 다시 시도, 오프라인은 요청 없음', async ({ page }) => {
    test.setTimeout(60000)
    await test.step('첫 GET 500 → 실패 문구 → 다시 시도 → 목록', async () => {
      const server = await fakeServer(page)
      server.setConnectedApps([app('a1', '앱 하나')])
      server.failConnectedApps({ status: 500, times: 1 })
      await openApp(page)
      const settings = await openAppsTab(page)
      await expect(settings).toContainText('연결된 앱을 불러오지 못했습니다.')
      await settings.getByRole('button', { name: '다시 시도' }).click()
      await expect(settings.locator('.connected-app-row')).toHaveCount(1)
      expect(server.connectedAppsLog().filter((e) => e.method === 'GET')).toHaveLength(2)
    })
    await test.step('오프라인으로 열면 GET 0번', async () => {
      await resetBrowserState(page)
      const server = await fakeServer(page)
      server.setOffline(true)
      await page.route('**/api/me', (route) => route.abort('internetdisconnected'))
      await setPrefBeforeLoad(page, 'md.account', JSON.stringify({ id: 'u1', email: 'a@b.com' }))
      await openApp(page)
      const settings = await openAppsTab(page)
      await expect(settings).toContainText('온라인일 때 연결된 앱을 볼 수 있습니다')
      expect(server.connectedAppsLog()).toEqual([])
    })
  })
})
