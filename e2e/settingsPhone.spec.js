// 휴대폰 폭 설정 전체화면 1·2뎁스 (specs/features/F-2114.md 5장)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, setPrefBeforeLoad, waitTransitionEnd } from './helpers.js'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

const dlgOf = (page) => page.locator('dialog[aria-labelledby="settings-title"]')
const navState = (page) => page.evaluate(() => ({ hash: location.hash, navIdx: history.state?.navIdx, settings: history.state?.settings }))

async function setup(page) {
  await setPrefBeforeLoad(page, 'md.firstRunDone', '1')
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openApp(page)
  const idA = await importMarkdown(page, { name: 'a.md', content: '가 본문\n' })
  const idB = await importMarkdown(page, { name: 'b.md', content: '나 본문\n' })
  const before = await navState(page)
  await page.getByRole('button', { name: '사이드바 열기' }).tap()
  const sidebar = page.locator('.sidebar')
  await expect(sidebar).toHaveAttribute('data-state', 'open')
  await waitTransitionEnd(sidebar)
  await sidebar.getByRole('button', { name: '설정', exact: true }).tap()
  await expect(dlgOf(page)).toHaveAttribute('open', '')
  return { idA, idB, before }
}

test('F-2114 E1 기록 뒤로가 2뎁스 → 1뎁스 → 닫힘 → 이전 문서', async ({ page }) => {
  const { idA, idB, before } = await setup(page)
  await expect(page.locator('#settings-title')).toHaveText('설정')
  expect((await navState(page)).settings).toBe('list')

  await dlgOf(page).locator('button.settings-row[data-tab="editor"]').tap()
  await expect(page.locator('#settings-title')).toHaveText('편집기')
  await expect(page.locator('#indent-label')).toBeVisible()
  await expect(dlgOf(page).getByRole('button', { name: '뒤로' })).toBeFocused()
  expect((await navState(page)).settings).toBe('editor')

  await page.goBack()
  await expect(page.locator('#settings-title')).toHaveText('설정')
  await expect(dlgOf(page).locator('button.settings-row[data-tab="editor"]')).toBeFocused()
  await expect(dlgOf(page)).toHaveAttribute('open', '')

  await page.goBack()
  await expect(dlgOf(page)).not.toHaveAttribute('open', '')
  const after = await navState(page)
  expect(after.hash).toBe(before.hash)
  expect(after.navIdx).toBe(before.navIdx)
  expect(await currentDocId(page)).toBe(idB)

  await page.goBack()
  await expect.poll(() => currentDocId(page)).toBe(idA)
})

test('F-2114 E2 2뎁스에서 값 저장, 닫기는 쌓은 만큼 되감고 앞으로 가기는 1뎁스를 다시 연다', async ({ page }) => {
  const { before } = await setup(page)
  await dlgOf(page).locator('button.settings-row[data-tab="screen"]').tap()
  await dlgOf(page).getByRole('radiogroup', { name: '테마' }).getByRole('radio', { name: '다크' }).tap()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('md.theme'))).toBe('dark')
  await expect(page.locator('#settings-title')).toHaveText('화면')

  await dlgOf(page).getByRole('button', { name: '닫기' }).tap()
  await expect(dlgOf(page)).not.toHaveAttribute('open', '')
  await expect.poll(async () => (await navState(page)).navIdx).toBe(before.navIdx)

  await page.goForward()
  await expect(dlgOf(page)).toHaveAttribute('open', '')
  await expect(page.locator('#settings-title')).toHaveText('설정')
  await page.goBack()
  await expect(dlgOf(page)).not.toHaveAttribute('open', '')
})

test('F-2114 E3 Escape 는 2뎁스 → 1뎁스 → 닫힘', async ({ page }) => {
  const { before } = await setup(page)
  await dlgOf(page).locator('button.settings-row[data-tab="editor"]').tap()
  await expect(page.locator('#settings-title')).toHaveText('편집기')

  await page.keyboard.press('Escape')
  await expect(dlgOf(page)).toHaveAttribute('open', '')
  await expect(page.locator('#settings-title')).toHaveText('설정')

  await page.keyboard.press('Escape')
  await expect(dlgOf(page)).not.toHaveAttribute('open', '')
  await expect.poll(async () => (await navState(page)).navIdx).toBe(before.navIdx)
})
