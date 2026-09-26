// 계정 삭제 — 설정 `계정` 탭, D-15, 다시 로그인 표지, 이 기기 정리 (specs/features/F-2038.md 9.3 E1~E11)
import { test, expect } from '@playwright/test'
import { openApp, setPrefBeforeLoad } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const SETTINGS = 'dialog[aria-labelledby="settings-title"]'
const D15 = 'dialog[aria-labelledby="account-delete-title"]'
const REAUTH_TEXT = '계정을 삭제하려면 10분 안에 로그인한 상태여야 합니다. 다시 로그인하면 이 창이 다시 열립니다.'
const WARN_OTHER = '다른 계정으로 로그인해 계정 삭제 창을 열지 않았습니다. 지우려던 계정으로 다시 로그인하세요.'

async function openAccountTab(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const settings = page.locator(SETTINGS)
  await settings.getByRole('tab', { name: '계정' }).click()
  return settings
}

async function openD15(page) {
  const settings = await openAccountTab(page)
  await settings.getByRole('button', { name: '계정 삭제…' }).click()
  const dialog = page.locator(D15)
  await expect(dialog).toBeVisible()
  return dialog
}

function confirmButton(dialog) {
  return dialog.getByRole('button', { name: '계정 삭제', exact: true })
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

function putE2eeRows(page, rows) {
  return page.evaluate(
    (rows) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('md-docs')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('e2ee', 'readwrite')
          for (const row of rows) tx.objectStore('e2ee').put(row)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    rows,
  )
}

test.describe('F-2038 E1 계정 탭', () => {
  test('로그인 상태 — 탭 5개, 마지막이 계정, 이메일과 계정 삭제…', async ({ page }) => {
    await fakeServer(page)
    await openApp(page)
    await page.getByRole('button', { name: '설정', exact: true }).click()
    const settings = page.locator(SETTINGS)
    const tabs = settings.locator('[role="tab"]')
    await expect(tabs).toHaveCount(5)
    await expect(tabs.nth(4)).toHaveText('계정')
    await tabs.nth(4).click()
    await expect(settings.locator('.settings-panel')).toContainText('a@b.com 로 로그인했습니다.')
    await expect(settings.getByRole('button', { name: '계정 삭제…' })).toBeEnabled()
  })

  test('로그아웃 상태 — 계정 탭 없음', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: '설정', exact: true }).click()
    await expect(page.locator(SETTINGS).getByRole('tab', { name: '계정' })).toHaveCount(0)
  })
})

test.describe('F-2038 E2 요약과 공유 경고', () => {
  test('개수·용량·공유 경고, 공유 0 이면 경고 없음, 모두 0 이면 빈 문구', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    let dialog = await openD15(page)
    await expect(dialog).toContainText('a@b.com 계정을 지웁니다. 되돌릴 수 없습니다.')
    await expect(dialog.locator('.account-delete-summary li')).toHaveText(['서버 문서 3개', '폴더 1개', '이미지 2개 · 1.5MB'])
    await expect(dialog.locator('.account-delete-shared')).toContainText('공유 중인 문서 1개')

    await dialog.getByRole('button', { name: '취소' }).click()
    await expect(dialog).toBeHidden()
    server.setAccountPreview({ sharedDocs: 0 })
    await page.locator(SETTINGS).getByRole('button', { name: '계정 삭제…' }).click()
    dialog = page.locator(D15)
    await expect(dialog.locator('.account-delete-summary li').first()).toHaveText('서버 문서 3개')
    await expect(dialog.locator('.account-delete-shared')).toHaveCount(0)

    await dialog.getByRole('button', { name: '취소' }).click()
    server.setAccountPreview({ docs: 0, folders: 0, attachments: { count: 0, bytes: 0 } })
    await page.locator(SETTINGS).getByRole('button', { name: '계정 삭제…' }).click()
    await expect(dialog).toContainText('서버에 저장한 문서·폴더·이미지가 없습니다.')
    await expect(dialog.locator('.account-delete-summary')).toHaveCount(0)
  })
})

test.describe('F-2038 E3 확인 입력', () => {
  test('입력 전·삭 → 비활성, 삭제 → 활성', async ({ page }) => {
    await fakeServer(page)
    await openApp(page)
    const dialog = await openD15(page)
    const input = dialog.getByRole('textbox', { name: '계속하려면 삭제를 입력하세요' })
    await expect(input).toBeFocused()
    await expect(confirmButton(dialog)).toBeDisabled()
    await input.fill('삭')
    await expect(confirmButton(dialog)).toBeDisabled()
    await input.fill('삭제')
    await expect(confirmButton(dialog)).toBeEnabled()
  })
})

test.describe('F-2038 E4 삭제 성공', () => {
  test('DELETE 한 번, /?app=1, 완료 알림, 이 기기의 계정 사본만 지움', async ({ page }) => {
    const server = await fakeServer(page)
    // 저장 공간 보호 경고(F-118, warn)가 로컬 부팅에서 알림 자리를 선점한다 — info 는 warn 을 밀어내지 못한다 (e2eeDocs.spec.js 와 같은 이유)
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
    await openApp(page)
    await expect.poll(async () => (await idbRows(page, 'md-remote', 'docs')).filter((r) => r.userId === 'u1').length).toBeGreaterThan(0)
    await putE2eeRows(page, [
      { id: 'local', bundle: 'x', updatedAt: 1 },
      { id: 'account:u1', bundle: 'y', rev: 1, updatedAt: 1 },
    ])

    const dialog = await openD15(page)
    await dialog.getByRole('textbox', { name: '계속하려면 삭제를 입력하세요' }).fill('삭제')
    await confirmButton(dialog).click()

    await page.waitForURL((url) => url.pathname === '/' && url.search === '?app=1' && url.hash === '')
    await expect(page.locator('.notice--info .notice-message')).toHaveText('계정을 삭제했습니다.')
    expect(server.accountRequests().delete).toBe(1)
    const stored = await page.evaluate(() => window.localStorage.getItem('md.account'))
    expect(stored === '' || stored === null).toBe(true)
    expect((await idbRows(page, 'md-remote', 'docs')).filter((r) => r.userId === 'u1')).toHaveLength(0)
    expect((await idbRows(page, 'md-docs', 'e2ee')).map((r) => r.id)).toEqual(['local'])
    expect(await page.evaluate(() => sessionStorage.getItem('md.accountDelete'))).toBeNull()
  })
})

test.describe('F-2038 E5 다시 로그인', () => {
  test('fresh false → reauth 문구, 다시 로그인… 은 표지를 남기고 /login?…&reauth=1 로', async ({ page }) => {
    const server = await fakeServer(page)
    server.setAccountPreview({ fresh: false })
    let loginUrl = null
    await page.route('**/login?*', (route) => {
      loginUrl = route.request().url()
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>login</p>' })
    })
    await openApp(page)
    const hash = await page.evaluate(() => location.hash)
    const dialog = await openD15(page)
    await expect(dialog).toContainText(REAUTH_TEXT)
    await expect(confirmButton(dialog)).toHaveCount(0)
    await dialog.getByRole('button', { name: '다시 로그인…' }).click()
    await expect.poll(() => loginUrl).not.toBeNull()
    const url = new URL(loginUrl)
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('return')).toBe(hash)
    expect(url.searchParams.get('reauth')).toBe('1')
    const marker = JSON.parse(await page.evaluate(() => sessionStorage.getItem('md.accountDelete')))
    expect(marker).toMatchObject({ step: 'resume', userId: 'u1' })
    expect(typeof marker.at).toBe('number')
  })
})

test.describe('F-2038 E6·E7 돌아온 뒤', () => {
  test('E6 같은 계정 표지 → 설정 없이 D-15 가 열리고 표지는 지워짐', async ({ page }) => {
    await fakeServer(page)
    await page.addInitScript(() => {
      if (!window.name.includes('f2038-e6')) {
        window.name = 'f2038-e6'
        sessionStorage.setItem('md.accountDelete', JSON.stringify({ step: 'resume', userId: 'u1', at: Date.now() }))
      }
    })
    await page.goto('/')
    const dialog = page.locator(D15)
    await expect(dialog).toBeVisible()
    await expect(page.locator(SETTINGS)).toBeHidden()
    await expect(confirmButton(dialog)).toBeVisible()
    expect(await page.evaluate(() => sessionStorage.getItem('md.accountDelete'))).toBeNull()
  })

  test('E7 다른 계정 표지 → D-15 없음, 경고', async ({ page }) => {
    await fakeServer(page)
    await page.addInitScript(() => {
      if (!window.name.includes('f2038-e7')) {
        window.name = 'f2038-e7'
        sessionStorage.setItem('md.accountDelete', JSON.stringify({ step: 'resume', userId: 'other', at: Date.now() }))
      }
    })
    await page.goto('/')
    await expect(page.locator('.notice--warn .notice-message')).toHaveText(WARN_OTHER)
    await expect(page.locator(D15)).toBeHidden()
    expect(await page.evaluate(() => sessionStorage.getItem('md.accountDelete'))).toBeNull()
  })
})

test.describe('F-2038 E8·E9 삭제 실패', () => {
  test('E8 500 → 잠시 뒤 문구, 대화상자 그대로·버튼 다시 활성. network → 연결 문구', async ({ page }) => {
    const server = await fakeServer(page)
    server.setAccountDeleteRule({ status: 500, body: { error: 'internal' } })
    await openApp(page)
    const dialog = await openD15(page)
    await dialog.getByRole('textbox', { name: '계속하려면 삭제를 입력하세요' }).fill('삭제')
    await confirmButton(dialog).click()
    await expect(dialog.getByRole('alert')).toHaveText('계정을 삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
    await expect(dialog).toBeVisible()
    await expect(confirmButton(dialog)).toBeEnabled()

    server.setAccountDeleteRule('network')
    await confirmButton(dialog).click()
    await expect(dialog.getByRole('alert')).toHaveText('계정을 삭제하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.')
    expect(server.accountRequests().delete).toBe(2)
  })

  test('E9 403 reauth_required → reauth 상태', async ({ page }) => {
    const server = await fakeServer(page)
    server.setAccountDeleteRule({ status: 403, body: { error: 'reauth_required', freshMinutes: 10 } })
    await openApp(page)
    const dialog = await openD15(page)
    await dialog.getByRole('textbox', { name: '계속하려면 삭제를 입력하세요' }).fill('삭제')
    await confirmButton(dialog).click()
    await expect(dialog).toContainText(REAUTH_TEXT)
    await expect(dialog.getByRole('button', { name: '다시 로그인…' })).toBeVisible()
  })
})

test.describe('F-2038 E10 오프라인', () => {
  test('저장된 계정 + 오프라인 → 계정 탭은 보이고 계정 삭제… 비활성', async ({ page }) => {
    const server = await fakeServer(page)
    server.setOffline(true)
    await page.route('**/api/me', (route) => route.abort('internetdisconnected'))
    await setPrefBeforeLoad(page, 'md.account', JSON.stringify({ id: 'u1', email: 'a@b.com' }))
    await openApp(page)
    const settings = await openAccountTab(page)
    await expect(settings.getByRole('button', { name: '계정 삭제…' })).toBeDisabled()
    await expect(settings.locator('.settings-panel')).toContainText('온라인일 때 계정을 삭제할 수 있습니다')
  })
})

test.describe('F-2038 E11 닫기', () => {
  test('Esc·취소로 닫히고 초점은 계정 삭제… 로. 삭제하는 중에는 Esc 로 닫히지 않는다', async ({ page }) => {
    await fakeServer(page)
    await openApp(page)
    const settings = await openAccountTab(page)
    const opener = settings.getByRole('button', { name: '계정 삭제…' })

    await opener.click()
    let dialog = page.locator(D15)
    await expect(confirmButton(dialog)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
    await expect(settings).toBeVisible()

    await opener.click()
    dialog = page.locator(D15)
    await dialog.getByRole('button', { name: '취소' }).click()
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()

    let release = null
    await page.route('**/api/account', (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback()
      release = () => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"internal"}' })
    })
    await opener.click()
    await dialog.getByRole('textbox', { name: '계속하려면 삭제를 입력하세요' }).fill('삭제')
    await confirmButton(dialog).click()
    await expect(dialog.getByRole('button', { name: '삭제하는 중…' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: '삭제하는 중…' })).toBeVisible()
    await expect.poll(() => release !== null).toBe(true)
    await release()
    await expect(dialog.getByRole('alert')).toBeVisible()
  })
})
