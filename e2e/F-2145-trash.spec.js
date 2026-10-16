// 휴지통 화면 S-10 (specs/features/F-2145.md 6장 E1~E3)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, waitSaved } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

async function newDoc(page, server, name) {
  const id = await importMarkdown(page, { name: `${name}.md`, content: `${name}\n` })
  await waitSaved(page)
  await expect.poll(() => server.docs.has(id)).toBe(true)
  return id
}

async function deleteDoc(page, name) {
  const row = page.locator('.tree-row').filter({ hasText: name })
  await row.hover()
  await row.locator('.item-menu-btn').click()
  await row.getByRole('menuitem', { name: '삭제' }).click()
  const dialog = page.locator('dialog[open]')
  await expect(dialog).toContainText('휴지통으로 옮길까요? 30일 뒤 영구히 지워집니다.')
  await dialog.getByRole('button', { name: '삭제', exact: true }).click()
  await expect(page.locator('.tree-row').filter({ hasText: name })).toHaveCount(0)
}

async function openTrash(page) {
  await page.locator('.sidebar').getByRole('button', { name: '휴지통', exact: true }).click()
  await expect(page.locator('.trash-page')).toBeVisible()
}

test.describe('F-2145 휴지통 화면', () => {
  test('F-2145 E1 지우기 → 휴지통 행 → 복원하면 사이드바에 돌아오고 새로고침 뒤에도 있다', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    const keepId = await newDoc(page, server, '남길문서')
    const goneId = await newDoc(page, server, '지울문서')
    await deleteDoc(page, '지울문서')
    expect(server.docs.has(goneId)).toBe(false)
    expect(server.trash.has(goneId)).toBe(true)

    await openTrash(page)
    const row = page.locator('.trash-row').filter({ hasText: '지울문서' })
    await expect(row).toContainText('(최상위)')
    await expect(row).toContainText('앱에서 지움')
    await expect(row).toContainText('30일 남음')
    await row.getByRole('button', { name: '복원', exact: true }).click()

    await expect(page.locator('.notice-message')).toHaveText('"지울문서" 을(를) 복원했습니다.')
    await expect(page.locator('.trash-row')).toHaveCount(0)
    expect(server.docs.has(goneId)).toBe(true)
    await expect(page.locator(`.sidebar a[href="#/d/${goneId}"]`)).toBeVisible()
    await page.reload()
    await expect(page.locator(`.sidebar a[href="#/d/${goneId}"]`)).toBeVisible()
    await expect(page.locator(`.sidebar a[href="#/d/${keepId}"]`)).toBeVisible()
  })

  test('F-2145 E2 영구 삭제 확인(취소가 기본 포커스)과 휴지통 비우기가 가짜 서버 휴지통을 비운다', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    await newDoc(page, server, '하나')
    await newDoc(page, server, '둘')
    await newDoc(page, server, '셋')
    await deleteDoc(page, '하나')
    await deleteDoc(page, '둘')
    await deleteDoc(page, '셋')
    await openTrash(page)
    await expect(page.locator('.trash-row')).toHaveCount(3)

    await page.locator('.trash-row').filter({ hasText: '하나' }).getByRole('button', { name: '영구 삭제', exact: true }).click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog.getByRole('button', { name: '취소', exact: true })).toBeFocused()
    await dialog.getByRole('button', { name: '영구 삭제', exact: true }).click()
    await expect(page.locator('.notice-message')).toHaveText('"하나" 을(를) 영구히 지웠습니다.')
    await expect(page.locator('.trash-row')).toHaveCount(2)
    expect(server.trash.size).toBe(2)

    await page.getByRole('button', { name: '휴지통 비우기', exact: true }).click()
    await expect(page.locator('dialog[open]')).toContainText('휴지통의 문서 2개를 모두 영구히 지울까요? 되돌릴 수 없습니다.')
    await page.locator('dialog[open]').getByRole('button', { name: '비우기', exact: true }).click()
    await expect(page.locator('.notice-message')).toHaveText('문서 2개를 영구히 지웠습니다.')
    await expect(page.locator('.trash-page .shares-empty')).toHaveText('휴지통이 비어 있습니다.')
    expect(server.trash.size).toBe(0)
  })

  test('F-2145 E3 휴지통 문서의 공개 링크는 삭제된 문서, 내 휴지통 문서 해시는 휴지통 열기 알림', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    await newDoc(page, server, '남길문서')
    const goneId = await newDoc(page, server, '지울문서')
    await deleteDoc(page, '지울문서')

    await page.goto(`/#/d/${goneId}`)
    await expect(page.locator('.notice-message')).toHaveText('휴지통에 있는 문서입니다. 복원하면 열 수 있습니다.')
    await page.locator('.notice').getByRole('button', { name: '휴지통 열기', exact: true }).click()
    await expect(page.locator('.trash-page .trash-row')).toHaveCount(1)

    await page.route('**/pub/docs/**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"deleted"}' }),
    )
    await page.goto('/#/p/tok123')
    await expect(page.locator('.public-view-notice')).toHaveText('삭제된 문서입니다.')
  })
})
