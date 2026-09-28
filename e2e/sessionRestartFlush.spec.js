// 세션 재시작 전 대기 저장 flush (리뷰 A2 후속) — 편집기를 내리기 전에 700ms 안의 마지막 입력을 저장한다
import { test, expect } from '@playwright/test'
import { openApp as openAppRaw, setPrefBeforeLoad, currentDocId } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const SETTINGS_DIALOG_SELECTOR = 'dialog[aria-labelledby="settings-title"]'
const PASSWORD = '충분히긴금고암호입니다'
const VAULT_FOLDER = '비밀함'

async function openApp(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openAppRaw(page)
}

async function createVault(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const dialog = page.locator(SETTINGS_DIALOG_SELECTOR)
  await dialog.getByRole('tab', { name: '금고' }).click()
  await dialog.getByRole('button', { name: '금고 만들기…' }).click()
  const create = page.locator('dialog[aria-labelledby="e2ee-create-title"]')
  await create.locator('input[aria-labelledby="e2ee-create-password-label"]').fill(PASSWORD)
  await create.locator('input[aria-labelledby="e2ee-create-confirm-label"]').fill(PASSWORD)
  await create.getByRole('button', { name: '다음' }).click()
  await create.getByLabel('복구 코드를 안전한 곳에 보관했습니다').check()
  await create.getByRole('button', { name: '금고 만들기' }).click()
  await expect(create).toBeHidden()
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')
}

async function newVaultDoc(page) {
  const before = await currentDocId(page)
  const label = page.getByRole('button', { name: VAULT_FOLDER, exact: true })
  const row = page.locator('.sidebar .tree-row').filter({ has: label })
  await row.hover()
  await row.getByRole('button', { name: `${VAULT_FOLDER} 메뉴` }).click()
  await page.locator('.item-menu-list:not([inert])').getByRole('menuitem', { name: '새 문서', exact: true }).click()
  await expect.poll(() => currentDocId(page)).not.toBe(before)
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  return currentDocId(page)
}

test.describe('리뷰 A2 세션 재시작 전 저장', () => {
  test('리뷰 A2 금고 문서 입력 직후 다른 탭이 금고에서 빼면 마지막 입력이 서버에 남는다', async ({ page }) => {
    await page.clock.install()
    const server = await fakeServer(page)
    const now0 = Date.now()
    server.folders.set('vf1', { id: 'vf1', name: VAULT_FOLDER, parentId: null, createdAt: now0, updatedAt: now0, e2ee: true })
    await openApp(page)
    await createVault(page)
    const docId = await newVaultDoc(page)
    await page.locator('.doc-title').fill('비밀 제목')
    await page.locator('.doc-title').press('Enter')
    await page.locator('.cm-content').click()
    await page.keyboard.type('첫 줄')
    await expect(page.locator('.statusbar-save')).toContainText('저장됨')
    await page.clock.fastForward(11_000)
    await expect.poll(() => server.docs.get(docId)?.version).toBe(2)

    // 700ms 저장 타이머가 돌기 전에 목록 다시 읽기(250ms)가 세션을 다시 시작하도록 시계를 멈춘다
    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(now + 50)
    await page.keyboard.press('End')
    await page.keyboard.type(' 둘째')

    // 다른 탭이 금고에서 뺀 상태 — 평문·최상위·버전 증가
    const doc = server.docs.get(docId)
    delete doc.e2eeKey
    delete doc.attachmentRefs
    Object.assign(doc, { title: '비밀 제목', content: '첫 줄', folderId: null, version: doc.version + 1, updatedAt: Date.now() })
    const listed = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/docs' && r.request().method() === 'GET')
    await page.evaluate(() => {
      const channel = new BroadcastChannel('md-tabs')
      channel.postMessage({ kind: 'docs-changed', tabId: 'other-tab' })
      channel.close()
    })
    await page.clock.runFor(300)
    await listed
    await page.waitForTimeout(1_000)

    await page.clock.resume()
    await page.clock.fastForward(11_000)
    await expect.poll(() => server.docs.get(docId)?.content, { timeout: 10_000 }).toBe('첫 줄 둘째')
  })
})
