// 로컬 저장소 휴지통 (small 2026-10-16, specs/wireframes/local-trash-flow.html) — 저장소 규칙은 단위 테스트가, 여기는 새로고침을 넘는 결과만 본다
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, setPrefBeforeLoad } from './helpers.js'

async function deleteDoc(page, name) {
  const row = page.locator('.tree-row').filter({ hasText: name })
  await row.hover()
  await row.locator('.item-menu-btn').click()
  await row.getByRole('menuitem', { name: '삭제' }).click()
  const dialog = page.locator('dialog[open]')
  await expect(dialog).toContainText(`"${name}" 을(를) 휴지통으로 옮길까요? 30일 뒤 영구히 지워집니다.`)
  await dialog.getByRole('button', { name: '삭제', exact: true }).click()
  await expect(page.locator('.tree-row').filter({ hasText: name })).toHaveCount(0)
}

async function openTrash(page) {
  await page.locator('.sidebar').getByRole('button', { name: '휴지통', exact: true }).click()
  await expect(page.locator('.trash-page')).toBeVisible()
}

test.describe('로컬 휴지통', () => {
  test.beforeEach(async ({ page }) => {
    await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  })

  test('local-trash E1 지운 로컬 문서는 새로고침 뒤에도 휴지통에 있고, 복원하면 새로고침 뒤에도 목록에 돌아와 있다', async ({ page }) => {
    await openApp(page)
    const keepId = await importMarkdown(page, { name: '남길문서.md', content: '남길문서\n' })
    const goneId = await importMarkdown(page, { name: '지울문서.md', content: '지울문서\n' })
    await deleteDoc(page, '지울문서')

    await page.reload()
    await expect(page.locator(`.sidebar a[href="#/d/${keepId}"]`)).toBeVisible()
    await expect(page.locator(`.sidebar a[href="#/d/${goneId}"]`)).toHaveCount(0)
    await openTrash(page)
    const row = page.locator('.trash-row').filter({ hasText: '지울문서' })
    await expect(row).toContainText('(최상위) · 오늘 · 30일 남음')
    await expect(row).not.toContainText('지움')
    await row.getByRole('button', { name: '복원', exact: true }).click()

    await expect(page.locator('.notice-message')).toHaveText('"지울문서" 을(를) 복원했습니다.')
    await expect(page.locator('.trash-row')).toHaveCount(0)
    await expect(page.locator(`.sidebar a[href="#/d/${goneId}"]`)).toBeVisible()
    await page.reload()
    await expect(page.locator(`.sidebar a[href="#/d/${goneId}"]`)).toBeVisible()
    await expect(page.locator(`.sidebar a[href="#/d/${keepId}"]`)).toBeVisible()
  })

  test('local-trash E2 휴지통에서 영구 삭제한 로컬 문서는 새로고침 뒤에도 목록·휴지통 어디에도 없다', async ({ page }) => {
    await openApp(page)
    const keepId = await importMarkdown(page, { name: '남길문서.md', content: '남길문서\n' })
    const goneId = await importMarkdown(page, { name: '지울문서.md', content: '지울문서\n' })
    await deleteDoc(page, '지울문서')

    await openTrash(page)
    await page.locator('.trash-row').filter({ hasText: '지울문서' }).getByRole('button', { name: '영구 삭제', exact: true }).click()
    const dialog = page.locator('dialog[open]')
    await expect(dialog).toContainText('"지울문서" 을(를) 영구히 지울까요? 되돌릴 수 없습니다.')
    await dialog.getByRole('button', { name: '영구 삭제', exact: true }).click()
    await expect(page.locator('.notice-message')).toHaveText('"지울문서" 을(를) 영구히 지웠습니다.')
    await expect(page.locator('.trash-page .shares-empty')).toHaveText('휴지통이 비어 있습니다.')

    await page.reload()
    await expect(page.locator(`.sidebar a[href="#/d/${keepId}"]`)).toBeVisible()
    await expect(page.locator(`.sidebar a[href="#/d/${goneId}"]`)).toHaveCount(0)
    await openTrash(page)
    await expect(page.locator('.trash-page .shares-empty')).toHaveText('휴지통이 비어 있습니다.')
  })
})
